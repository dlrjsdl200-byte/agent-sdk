import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { getAddress, recoverTypedDataAddress } from "viem";

import {
  authorizationTypes,
  buildAuthorizationFromNormalized,
  encodePaymentForWire,
  HEADER_NAMES,
  normalizeRequirement,
  parsePaymentRequiredResponse,
  readSettleResponse,
  resolveChainIdFromNetworkString,
  selectRequirement,
  signAuthorizationNormalized,
  toCaip2,
  type PaymentPayloadV2,
  type PaymentRequiredV2,
  type PaymentRequirementsV2,
} from "../src/payment.js";

const TEST_PRIVATE_KEY =
  "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
const TEST_ADDRESS = privateKeyToAccount(TEST_PRIVATE_KEY).address;
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

/**
 * Minimal fixture mirroring the live MGO `Payment-Required` header
 * (api.mgo.chain-ops.xyz/gas/basic) captured 2026-04-14. Extensions stripped.
 */
const MGO_REQUIRED_V2: PaymentRequiredV2 = {
  x402Version: 2,
  error: "Payment required",
  resource: {
    url: "http://api.mgo.chain-ops.xyz/gas/basic",
    description: "MGO Basic — 4-chain gas comparison",
    mimeType: "",
  },
  accepts: [
    {
      scheme: "exact",
      network: "eip155:8453",
      amount: "1000",
      asset: USDC_BASE,
      payTo: "0x665bab4c46a6ae3f755e71793e5685bc6c47dd7a",
      maxTimeoutSeconds: 300,
      extra: { name: "USD Coin", version: "2" },
    },
  ],
};

function encodeHeaderValue(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64");
}

// ---------------------------------------------------------------------------
// CAIP-2 network resolution
// ---------------------------------------------------------------------------

describe("resolveChainIdFromNetworkString", () => {
  it("parses CAIP-2 eip155 strings", () => {
    expect(resolveChainIdFromNetworkString("eip155:8453")).toBe(8453);
    expect(resolveChainIdFromNetworkString("eip155:84532")).toBe(84532);
  });

  it("parses V1 loose network names", () => {
    expect(resolveChainIdFromNetworkString("base")).toBe(8453);
    expect(resolveChainIdFromNetworkString("base-sepolia")).toBe(84532);
    expect(resolveChainIdFromNetworkString("optimism")).toBe(10);
    expect(resolveChainIdFromNetworkString("arbitrum")).toBe(42161);
  });

  it("returns null for non-eip155 or unknown", () => {
    expect(resolveChainIdFromNetworkString("solana:mainnet")).toBeNull();
    expect(resolveChainIdFromNetworkString("ethereum")).toBeNull();
    expect(resolveChainIdFromNetworkString("eip155:abc")).toBeNull();
  });

  it("toCaip2 round-trips with resolveChainIdFromNetworkString", () => {
    expect(resolveChainIdFromNetworkString(toCaip2("base"))).toBe(8453);
    expect(resolveChainIdFromNetworkString(toCaip2("optimism"))).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// normalizeRequirement — V1 and V2 both collapse to the same shape
// ---------------------------------------------------------------------------

describe("normalizeRequirement", () => {
  it("normalizes a V2 MGO requirement", () => {
    const norm = normalizeRequirement(MGO_REQUIRED_V2.accepts[0]);
    expect(norm).not.toBeNull();
    expect(norm!.version).toBe(2);
    expect(norm!.chainId).toBe(8453);
    expect(norm!.amount).toBe(1000n);
    expect(norm!.asset).toBe(getAddress(USDC_BASE));
    expect(norm!.payTo).toBe(getAddress("0x665bab4c46a6ae3f755e71793e5685bc6c47dd7a"));
    expect(norm!.extra.name).toBe("USD Coin");
    expect(norm!.extra.version).toBe("2");
  });

  it("normalizes a V1 requirement", () => {
    const norm = normalizeRequirement({
      scheme: "exact",
      network: "base",
      maxAmountRequired: "5000",
      resource: "https://x",
      description: "y",
      mimeType: "application/json",
      payTo: "0x000000000000000000000000000000000000dead",
      maxTimeoutSeconds: 120,
      asset: USDC_BASE,
      extra: { name: "USD Coin", version: "2" },
    });
    expect(norm).not.toBeNull();
    expect(norm!.version).toBe(1);
    expect(norm!.chainId).toBe(8453);
    expect(norm!.amount).toBe(5000n);
  });

  it("returns null for unrecognized scheme", () => {
    const req = { ...MGO_REQUIRED_V2.accepts[0], scheme: "weird" as unknown as "exact" };
    expect(normalizeRequirement(req)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parsePaymentRequiredResponse — real MGO V2 header
// ---------------------------------------------------------------------------

describe("parsePaymentRequiredResponse", () => {
  it("reads a V2 Payment-Required header", () => {
    const headerValue = encodeHeaderValue(MGO_REQUIRED_V2);
    const headers = new Map<string, string>([["payment-required", headerValue]]);
    const getHeader = (name: string) => headers.get(name.toLowerCase()) ?? null;

    const parsed = parsePaymentRequiredResponse(getHeader, null);
    expect(parsed).not.toBeNull();
    expect(parsed!.x402Version).toBe(2);
    expect(parsed!.accepts[0].scheme).toBe("exact");
    expect((parsed as PaymentRequiredV2).resource.url).toBe(
      "http://api.mgo.chain-ops.xyz/gas/basic",
    );
  });

  it("falls back to V1 body when no header present", () => {
    const getHeader = () => null;
    const body = {
      x402Version: 1,
      accepts: [
        {
          scheme: "exact",
          network: "base",
          maxAmountRequired: "1000",
          resource: "https://x",
          description: "d",
          mimeType: "application/json",
          payTo: "0x0000000000000000000000000000000000000000",
          maxTimeoutSeconds: 60,
          asset: USDC_BASE,
        },
      ],
    };
    const parsed = parsePaymentRequiredResponse(getHeader, body);
    expect(parsed?.x402Version).toBe(1);
  });

  it("returns null when neither is present", () => {
    expect(parsePaymentRequiredResponse(() => null, null)).toBeNull();
    expect(parsePaymentRequiredResponse(() => null, { foo: "bar" })).toBeNull();
  });

  it("ignores garbage header and falls back to body", () => {
    const getHeader = (n: string) =>
      n.toLowerCase() === "payment-required" ? "!!!not-base64!!!" : null;
    const parsed = parsePaymentRequiredResponse(getHeader, null);
    expect(parsed).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// selectRequirement — network + cap
// ---------------------------------------------------------------------------

describe("selectRequirement", () => {
  it("picks the MGO V2 requirement on base", () => {
    const picked = selectRequirement(MGO_REQUIRED_V2.accepts, { agentNetwork: "base" });
    expect(picked?.chainId).toBe(8453);
    expect(picked?.amount).toBe(1000n);
  });

  it("rejects when agent network mismatches", () => {
    const picked = selectRequirement(MGO_REQUIRED_V2.accepts, { agentNetwork: "optimism" });
    expect(picked).toBeNull();
  });

  it("respects maxPrice cap", () => {
    const picked = selectRequirement(MGO_REQUIRED_V2.accepts, {
      agentNetwork: "base",
      maxPrice: 500n,
    });
    expect(picked).toBeNull();
    const ok = selectRequirement(MGO_REQUIRED_V2.accepts, {
      agentNetwork: "base",
      maxPrice: 10_000n,
    });
    expect(ok?.amount).toBe(1000n);
  });
});

// ---------------------------------------------------------------------------
// Full sign + encode round-trip for V2 (real MGO fixture)
// ---------------------------------------------------------------------------

describe("V2 sign + encodePaymentForWire", () => {
  it("produces a Payment-Signature header whose signature recovers to signer", async () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    const norm = normalizeRequirement(MGO_REQUIRED_V2.accepts[0])!;
    const auth = buildAuthorizationFromNormalized(account.address, norm);
    const signature = await signAuthorizationNormalized(account, auth, norm);

    const wire = encodePaymentForWire(norm, auth, signature, MGO_REQUIRED_V2.resource);

    // Header name is V2
    expect(wire.headerName).toBe(HEADER_NAMES.v2.paymentSignature);

    // Decode and inspect
    const decoded = JSON.parse(Buffer.from(wire.headerValue, "base64").toString("utf-8")) as PaymentPayloadV2;
    expect(decoded.x402Version).toBe(2);
    expect(decoded.accepted.amount).toBe("1000");
    expect((decoded.accepted as PaymentRequirementsV2).network).toBe("eip155:8453");
    expect(decoded.resource?.url).toBe("http://api.mgo.chain-ops.xyz/gas/basic");

    // Signature is mathematically valid against the EIP-712 domain we used
    const recovered = await recoverTypedDataAddress({
      domain: {
        name: "USD Coin",
        version: "2",
        chainId: 8453,
        verifyingContract: getAddress(USDC_BASE) as `0x${string}`,
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
    expect(getAddress(recovered)).toBe(getAddress(TEST_ADDRESS));
  });

  it("emits the V1 X-PAYMENT header when given a V1 requirement", () => {
    const norm = normalizeRequirement({
      scheme: "exact",
      network: "base",
      maxAmountRequired: "1000",
      resource: "https://x",
      description: "d",
      mimeType: "application/json",
      payTo: "0x0000000000000000000000000000000000000000",
      maxTimeoutSeconds: 60,
      asset: USDC_BASE,
      extra: { name: "USD Coin", version: "2" },
    })!;
    const auth = buildAuthorizationFromNormalized(TEST_ADDRESS, norm);
    const wire = encodePaymentForWire(norm, auth, ("0x" + "11".repeat(65)) as `0x${string}`);
    expect(wire.headerName).toBe(HEADER_NAMES.v1.paymentSignature);
  });
});

// ---------------------------------------------------------------------------
// readSettleResponse — works with either header name
// ---------------------------------------------------------------------------

describe("readSettleResponse", () => {
  const receipt = {
    success: true,
    transaction: "0xdeadbeef" as const,
    network: "eip155:8453",
    payer: TEST_ADDRESS,
  };
  const encoded = Buffer.from(JSON.stringify(receipt)).toString("base64");

  it("reads Payment-Response (V2)", () => {
    const get = (n: string) => (n.toLowerCase() === "payment-response" ? encoded : null);
    expect(readSettleResponse(get)).toEqual(receipt);
  });

  it("reads X-Payment-Response (V1)", () => {
    const get = (n: string) => (n.toLowerCase() === "x-payment-response" ? encoded : null);
    expect(readSettleResponse(get)).toEqual(receipt);
  });

  it("returns null when no response header is present", () => {
    expect(readSettleResponse(() => null)).toBeNull();
  });
});
