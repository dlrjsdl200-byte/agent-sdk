import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { getAddress, recoverTypedDataAddress } from "viem";

import {
  authorizationTypes,
  buildAuthorization,
  createNonce,
  decodePaymentResponseHeader,
  encodePaymentHeader,
  selectPaymentRequirements,
  signAuthorization,
  type PaymentPayload,
  type PaymentRequirements,
} from "../src/payment.js";
import { CHAINS } from "../src/chains.js";

// Deterministic test key — NEVER use for real funds.
const TEST_PRIVATE_KEY =
  "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
const TEST_ADDRESS = privateKeyToAccount(TEST_PRIVATE_KEY).address;

// USDC on Base mainnet
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

function makeReq(overrides: Partial<PaymentRequirements> = {}): PaymentRequirements {
  return {
    scheme: "exact",
    network: "base",
    maxAmountRequired: "10000", // $0.01 USDC (6dp)
    resource: "https://api.example.com/data",
    description: "premium data",
    mimeType: "application/json",
    payTo: "0x000000000000000000000000000000000000dEaD",
    maxTimeoutSeconds: 300,
    asset: USDC_BASE,
    extra: { name: "USD Coin", version: "2" },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// selectPaymentRequirements
// ---------------------------------------------------------------------------

describe("selectPaymentRequirements", () => {
  it("picks the first matching exact/network entry", () => {
    const picked = selectPaymentRequirements(
      [
        makeReq({ network: "optimism" }),
        makeReq({ network: "base", maxAmountRequired: "5000" }),
        makeReq({ network: "base", maxAmountRequired: "20000" }),
      ],
      "base",
    );
    expect(picked?.maxAmountRequired).toBe("5000");
  });

  it("filters out entries above maxPrice cap", () => {
    const picked = selectPaymentRequirements(
      [
        makeReq({ maxAmountRequired: "50000" }),
        makeReq({ maxAmountRequired: "1000" }),
      ],
      "base",
      5000n,
    );
    expect(picked?.maxAmountRequired).toBe("1000");
  });

  it("returns null when all entries exceed the cap", () => {
    const picked = selectPaymentRequirements(
      [makeReq({ maxAmountRequired: "10000" })],
      "base",
      5000n,
    );
    expect(picked).toBeNull();
  });

  it("returns null when no network matches", () => {
    const picked = selectPaymentRequirements(
      [makeReq({ network: "optimism" })],
      "base",
    );
    expect(picked).toBeNull();
  });

  it("ignores non-'exact' schemes", () => {
    const weird = [
      { ...makeReq(), scheme: "weird" as unknown as "exact" },
      makeReq(),
    ];
    const picked = selectPaymentRequirements(weird, "base");
    expect(picked?.scheme).toBe("exact");
  });
});

// ---------------------------------------------------------------------------
// createNonce
// ---------------------------------------------------------------------------

describe("createNonce", () => {
  it("produces a 32-byte 0x-prefixed hex string", () => {
    const nonce = createNonce();
    expect(nonce).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("does not repeat across 100 calls", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(createNonce());
    expect(seen.size).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// buildAuthorization
// ---------------------------------------------------------------------------

describe("buildAuthorization", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-17T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("backs validAfter by 600s and sets validBefore to now+maxTimeoutSeconds", () => {
    const req = makeReq({ maxTimeoutSeconds: 300 });
    const auth = buildAuthorization(TEST_ADDRESS, req);

    const now = Math.floor(new Date("2026-04-17T12:00:00Z").getTime() / 1000);
    expect(Number(auth.validAfter)).toBe(now - 600);
    expect(Number(auth.validBefore)).toBe(now + 300);
  });

  it("checksums from and to addresses", () => {
    const req = makeReq({ payTo: "0x000000000000000000000000000000000000dead" });
    const auth = buildAuthorization(TEST_ADDRESS.toLowerCase(), req);
    expect(auth.from).toBe(getAddress(TEST_ADDRESS));
    expect(auth.to).toBe(getAddress("0x000000000000000000000000000000000000dead"));
  });

  it("copies value verbatim (no rounding or scaling)", () => {
    const req = makeReq({ maxAmountRequired: "123456789" });
    const auth = buildAuthorization(TEST_ADDRESS, req);
    expect(auth.value).toBe("123456789");
  });
});

// ---------------------------------------------------------------------------
// signAuthorization — real EIP-712 with a known key
// ---------------------------------------------------------------------------

describe("signAuthorization", () => {
  it("produces a signature recoverable to the signer address", async () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    const req = makeReq();
    const auth = buildAuthorization(account.address, req);

    const signature = await signAuthorization(account, auth, req, "base");

    const recovered = await recoverTypedDataAddress({
      domain: {
        name: req.extra!.name as string,
        version: req.extra!.version as string,
        chainId: CHAINS.base.id,
        verifyingContract: getAddress(req.asset) as `0x${string}`,
      },
      types: authorizationTypes,
      primaryType: "TransferWithAuthorization",
      message: {
        from: auth.from as `0x${string}`,
        to: auth.to as `0x${string}`,
        value: BigInt(auth.value),
        validAfter: BigInt(auth.validAfter),
        validBefore: BigInt(auth.validBefore),
        nonce: auth.nonce,
      },
      signature,
    });

    expect(getAddress(recovered)).toBe(getAddress(account.address));
  });

  it("throws when extra.name is missing", async () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    const req = makeReq({ extra: { version: "2" } }); // no name
    const auth = buildAuthorization(account.address, req);

    await expect(signAuthorization(account, auth, req, "base")).rejects.toThrow(
      /extra\.name.*required/i,
    );
  });

  it("throws when extra.version is missing", async () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    const req = makeReq({ extra: { name: "USD Coin" } });
    const auth = buildAuthorization(account.address, req);

    await expect(signAuthorization(account, auth, req, "base")).rejects.toThrow(
      /extra\.name.*required/i,
    );
  });
});

// ---------------------------------------------------------------------------
// encodePaymentHeader / decodePaymentResponseHeader
// ---------------------------------------------------------------------------

describe("payment header encoding", () => {
  it("encodes a PaymentPayload to base64 JSON", () => {
    const payload: PaymentPayload = {
      x402Version: 1,
      scheme: "exact",
      network: "base",
      payload: {
        signature: ("0x" + "ab".repeat(65)) as `0x${string}`,
        authorization: {
          from: TEST_ADDRESS,
          to: TEST_ADDRESS,
          value: "10000",
          validAfter: "1000",
          validBefore: "2000",
          nonce: ("0x" + "cd".repeat(32)) as `0x${string}`,
        },
      },
    };
    const header = encodePaymentHeader(payload);

    const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf-8"));
    expect(decoded).toEqual(payload);
  });

  it("decodePaymentResponseHeader parses a settlement receipt", () => {
    const receipt = {
      success: true,
      transaction: "0xdeadbeef",
      network: "base",
      payer: TEST_ADDRESS,
    };
    const header = Buffer.from(JSON.stringify(receipt)).toString("base64");
    expect(decodePaymentResponseHeader(header)).toEqual(receipt);
  });

  it("decodePaymentResponseHeader returns null for null / garbage", () => {
    expect(decodePaymentResponseHeader(null)).toBeNull();
    expect(decodePaymentResponseHeader("not-base64!!!")).toBeNull();
  });
});
