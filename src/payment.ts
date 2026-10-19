/**
 * x402 "exact" scheme — EVM payment types, encoding, and EIP-3009 signing.
 *
 * Supports both V1 and V2 of the x402 protocol. The differences are wire-level
 * only — the EIP-3009 `TransferWithAuthorization` signature is identical, so
 * callers normalize requirements into a single internal shape and we branch
 * only on encoding + header names.
 *
 * V1 vs V2 summary (verified against coinbase/x402 main branch):
 *
 * | aspect           | V1                          | V2                              |
 * | ---------------- | --------------------------- | ------------------------------- |
 * | 402 location     | JSON body                   | `Payment-Required` header b64   |
 * | amount field     | `maxAmountRequired`         | `amount`                        |
 * | network format   | loose string e.g. `"base"`  | CAIP-2 e.g. `"eip155:8453"`     |
 * | resource info    | inside each requirement     | top-level `resource: {url,…}`   |
 * | request header   | `X-PAYMENT`                 | `Payment-Signature`             |
 * | response header  | `X-PAYMENT-RESPONSE`        | `Payment-Response`              |
 * | payload wrapper  | `{x402Version,scheme,network,payload}` | `{x402Version,accepted,payload}` |
 *
 * Source of truth for field names + wire format:
 *   - V1 legacy: github.com/coinbase/x402 typescript/packages/legacy/x402/src
 *   - V2 core:   github.com/coinbase/x402 typescript/packages/core/src
 */

import { getAddress, toHex, type Hex, type LocalAccount } from "viem";
import { webcrypto as nodeWebcrypto } from "node:crypto";

import { CHAINS } from "./chains.js";
import type { SupportedNetwork } from "./types.js";

// ---------------------------------------------------------------------------
// Protocol constants
// ---------------------------------------------------------------------------

export const X402_VERSION_V1 = 1;
export const X402_VERSION_V2 = 2;
export const X402_VERSION = X402_VERSION_V1; // back-compat export

/** EIP-712 `TransferWithAuthorization` types — EIP-3009 verbatim. */
export const authorizationTypes = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

// ---------------------------------------------------------------------------
// V1 types (legacy — MGO is on V2 but the facilitator still accepts V1)
// ---------------------------------------------------------------------------

export type X402NetworkName = string;

export interface PaymentRequirementsV1 {
  scheme: "exact";
  network: X402NetworkName;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  outputSchema?: Record<string, unknown>;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra?: { name?: string; version?: string; [k: string]: unknown };
}

export interface PaymentRequiredV1 {
  x402Version: 1;
  error?: string;
  accepts: PaymentRequirementsV1[];
}

// ---------------------------------------------------------------------------
// V2 types
// ---------------------------------------------------------------------------

export interface ResourceInfo {
  url: string;
  description?: string;
  mimeType?: string;
}

export interface PaymentRequirementsV2 {
  scheme: "exact";
  network: string; // CAIP-2 e.g. "eip155:8453"
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: { name?: string; version?: string; [k: string]: unknown };
}

export interface PaymentRequiredV2 {
  x402Version: 2;
  error?: string;
  resource: ResourceInfo;
  accepts: PaymentRequirementsV2[];
  extensions?: Record<string, unknown>;
}

// Discriminated union
export type PaymentRequirements = PaymentRequirementsV1 | PaymentRequirementsV2;
export type PaymentRequired = PaymentRequiredV1 | PaymentRequiredV2;

// Back-compat export name
export type X402ResourceResponse = PaymentRequired;

// ---------------------------------------------------------------------------
// Normalized internal shape — what signing/UX actually cares about
// ---------------------------------------------------------------------------

/**
 * A version-agnostic view of a single payment requirement.
 * The four fields we need for signing + UX: chainId, asset, payTo, amount.
 */
export interface NormalizedRequirement {
  version: 1 | 2;
  scheme: "exact";
  chainId: number;
  /** Original network string as-emitted by the server (for echoing back). */
  networkString: string;
  amount: bigint;
  asset: `0x${string}`;
  payTo: `0x${string}`;
  maxTimeoutSeconds: number;
  extra: { name?: string; version?: string } & Record<string, unknown>;
  /** Preserve the raw requirement so we can reconstruct the V2 `accepted` field. */
  raw: PaymentRequirements;
}

// ---------------------------------------------------------------------------
// EIP-3009 authorization (same for V1 and V2)
// ---------------------------------------------------------------------------

export interface ExactEvmAuthorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
}

export interface ExactEvmPayload {
  signature: Hex;
  authorization: ExactEvmAuthorization;
}

/** Old V1 wire-format wrapper — what the V1 `X-PAYMENT` header encodes. */
export interface PaymentPayloadV1 {
  x402Version: 1;
  scheme: "exact";
  network: string;
  payload: ExactEvmPayload;
}

/** V2 wire-format wrapper — `Payment-Signature` header encodes this. */
export interface PaymentPayloadV2 {
  x402Version: 2;
  resource?: ResourceInfo;
  accepted: PaymentRequirementsV2;
  payload: ExactEvmPayload;
  extensions?: Record<string, unknown>;
}

export type PaymentPayload = PaymentPayloadV1 | PaymentPayloadV2;

// ---------------------------------------------------------------------------
// Network resolution
// ---------------------------------------------------------------------------

/** SDK network → chain id. */
const CHAIN_ID_BY_NETWORK: Record<SupportedNetwork, number> = {
  base: 8453,
  "base-sepolia": 84532,
  optimism: 10,
  arbitrum: 42161,
};

/** chain id → SDK network string (for internal use). */
const NETWORK_BY_CHAIN_ID: Record<number, SupportedNetwork> = Object.fromEntries(
  Object.entries(CHAIN_ID_BY_NETWORK).map(([k, v]) => [v, k]),
) as Record<number, SupportedNetwork>;

/**
 * Parse an x402 network string into a numeric EVM chain id.
 * Accepts:
 *   - CAIP-2: "eip155:8453" (V2)
 *   - Loose V1 names: "base", "base-sepolia", "optimism", "arbitrum"
 *
 * Returns `null` if the string is unrecognized (non-EVM, unknown chain).
 */
export function resolveChainIdFromNetworkString(network: string): number | null {
  // CAIP-2
  if (network.includes(":")) {
    const [namespace, reference] = network.split(":");
    if (namespace !== "eip155") return null;
    const n = Number(reference);
    return Number.isFinite(n) ? n : null;
  }
  // V1 loose name
  if (network in CHAIN_ID_BY_NETWORK) {
    return CHAIN_ID_BY_NETWORK[network as SupportedNetwork];
  }
  return null;
}

/** Encode a SupportedNetwork as a V2 CAIP-2 string. */
export function toCaip2(network: SupportedNetwork): string {
  return `eip155:${CHAIN_ID_BY_NETWORK[network]}`;
}

/** Resolve a chainId to a SupportedNetwork if it matches one. */
export function networkFromChainId(chainId: number): SupportedNetwork | null {
  return NETWORK_BY_CHAIN_ID[chainId] ?? null;
}

// Kept for back-compat with existing tests
export function toX402NetworkName(network: SupportedNetwork): string {
  return network;
}
export function networkMatches(a: string, b: SupportedNetwork): boolean {
  const idA = resolveChainIdFromNetworkString(a);
  const idB = CHAIN_ID_BY_NETWORK[b];
  return idA !== null && idA === idB;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/** Normalize any V1 or V2 requirement into the internal shape. */
export function normalizeRequirement(req: PaymentRequirements): NormalizedRequirement | null {
  if (req.scheme !== "exact") return null;
  const chainId = resolveChainIdFromNetworkString(req.network);
  if (chainId === null) return null;

  // This SDK signs EIP-3009 TransferWithAuthorization only. Newer x402 servers
  // can ask for a Permit2 transfer instead (`extra.assetTransferMethod`), which
  // needs a different signature: skip those entries rather than sign garbage.
  const method = (req.extra as { assetTransferMethod?: string } | undefined)?.assetTransferMethod;
  if (method && method !== "eip3009") return null;

  const isV2 = "amount" in req;
  const amountStr = isV2 ? req.amount : req.maxAmountRequired;

  // Malformed 402s (bad address, non-numeric amount) are "not compatible", not a crash.
  let amount: bigint;
  let asset: `0x${string}`;
  let payTo: `0x${string}`;
  try {
    amount = BigInt(amountStr);
    asset = getAddress(req.asset) as `0x${string}`;
    payTo = getAddress(req.payTo) as `0x${string}`;
  } catch {
    return null;
  }
  if (amount < 0n) return null;

  return {
    version: isV2 ? 2 : 1,
    scheme: "exact",
    chainId,
    networkString: req.network,
    amount,
    asset,
    payTo,
    maxTimeoutSeconds: Number.isFinite(req.maxTimeoutSeconds) ? req.maxTimeoutSeconds : 300,
    extra: { ...(req.extra ?? {}) },
    raw: req,
  };
}

// ---------------------------------------------------------------------------
// Requirement selection
// ---------------------------------------------------------------------------

export interface SelectOptions {
  agentNetwork: SupportedNetwork;
  maxPrice?: bigint;
}

/**
 * Pick the first requirement the agent can satisfy: same chain, "exact" scheme,
 * price within cap. Returns the normalized form ready for signing.
 */
export function selectRequirement(
  accepts: PaymentRequirements[],
  { agentNetwork, maxPrice }: SelectOptions,
): NormalizedRequirement | null {
  const targetChainId = CHAIN_ID_BY_NETWORK[agentNetwork];
  for (const req of accepts) {
    const norm = normalizeRequirement(req);
    if (!norm) continue;
    if (norm.chainId !== targetChainId) continue;
    if (maxPrice !== undefined && norm.amount > maxPrice) continue;
    return norm;
  }
  return null;
}

/**
 * V1 back-compat: the older name, filters the raw V1 array and returns the
 * raw V1 entry. Still used by existing tests.
 */
export function selectPaymentRequirements(
  accepts: PaymentRequirements[],
  agentNetwork: SupportedNetwork,
  maxPrice?: bigint,
): PaymentRequirementsV1 | null {
  const norm = selectRequirement(accepts, { agentNetwork, maxPrice });
  if (!norm || norm.version !== 1) {
    // Scan for a V1 match (tests always pass V1 data today)
    const targetChainId = CHAIN_ID_BY_NETWORK[agentNetwork];
    for (const r of accepts) {
      if (r.scheme !== "exact") continue;
      if (!("maxAmountRequired" in r)) continue;
      const id = resolveChainIdFromNetworkString(r.network);
      if (id !== targetChainId) continue;
      if (maxPrice !== undefined && BigInt(r.maxAmountRequired) > maxPrice) continue;
      return r;
    }
    return null;
  }
  return norm.raw as PaymentRequirementsV1;
}

// ---------------------------------------------------------------------------
// Nonce + authorization
// ---------------------------------------------------------------------------

export function createNonce(): Hex {
  const bytes = new Uint8Array(32);
  // Node 18 has no global `crypto` without a flag; fall back to node:crypto.
  // DOM `Crypto` and node's `webcrypto` types differ slightly; both expose getRandomValues.
  const webcrypto = ((globalThis as { crypto?: unknown }).crypto ?? nodeWebcrypto) as {
    getRandomValues<T extends Uint8Array>(array: T): T;
  };
  webcrypto.getRandomValues(bytes);
  return toHex(bytes);
}

/**
 * Build an unsigned authorization from a normalized requirement + payer.
 * validAfter = now - 600, validBefore = now + maxTimeoutSeconds.
 */
export function buildAuthorizationFromNormalized(
  from: string,
  norm: NormalizedRequirement,
): ExactEvmAuthorization {
  const now = Math.floor(Date.now() / 1000);
  return {
    from: getAddress(from),
    to: norm.payTo,
    value: norm.amount.toString(),
    validAfter: BigInt(now - 600).toString(),
    validBefore: BigInt(now + norm.maxTimeoutSeconds).toString(),
    nonce: createNonce(),
  };
}

/** V1 back-compat overload (existing tests). */
export function buildAuthorization(
  from: string,
  req: PaymentRequirements,
): ExactEvmAuthorization {
  const norm = normalizeRequirement(req);
  if (!norm) {
    throw new Error("[agent-sdk] buildAuthorization: unrecognized requirement");
  }
  return buildAuthorizationFromNormalized(from, norm);
}

// ---------------------------------------------------------------------------
// EIP-712 signing — identical across V1 and V2
// ---------------------------------------------------------------------------

/**
 * Sign EIP-3009 `TransferWithAuthorization` for USDC.
 *
 * The domain is constructed from the normalized requirement: name/version come
 * from `extra`, chainId from the resolved network, verifyingContract from the
 * asset address. Any drift in these fields produces an invalid signature
 * that the facilitator will reject — and in the worst case burns a nonce.
 *
 * @throws when `extra.name` / `extra.version` are missing
 */
export async function signAuthorizationNormalized(
  account: LocalAccount,
  auth: ExactEvmAuthorization,
  norm: NormalizedRequirement,
): Promise<Hex> {
  const name = norm.extra.name;
  const version = norm.extra.version;
  if (typeof name !== "string" || typeof version !== "string") {
    throw new Error(
      "[agent-sdk] signAuthorization: paymentRequirements.extra.name and .version " +
        "are required for EIP-712 signing of USDC TransferWithAuthorization. The " +
        "resource server must include these in its 402 response.",
    );
  }

  if (!account.signTypedData) {
    throw new Error("[agent-sdk] signAuthorization: account does not support signTypedData");
  }

  return account.signTypedData({
    domain: {
      name,
      version,
      chainId: norm.chainId,
      verifyingContract: norm.asset,
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
  });
}

/** V1 back-compat signature (existing tests). */
export async function signAuthorization(
  account: LocalAccount,
  auth: ExactEvmAuthorization,
  req: PaymentRequirements,
  _agentNetwork: SupportedNetwork,
): Promise<Hex> {
  const norm = normalizeRequirement(req);
  if (!norm) throw new Error("[agent-sdk] signAuthorization: bad requirement");
  return signAuthorizationNormalized(account, auth, norm);
}

// ---------------------------------------------------------------------------
// Wire encoding — version-specific
// ---------------------------------------------------------------------------

function base64Encode(s: string): string {
  if (typeof Buffer !== "undefined") return Buffer.from(s, "utf-8").toString("base64");
  return btoa(unescape(encodeURIComponent(s)));
}
function base64Decode(s: string): string {
  if (typeof Buffer !== "undefined") return Buffer.from(s, "base64").toString("utf-8");
  return decodeURIComponent(escape(atob(s)));
}

/** HTTP header names per version. */
export const HEADER_NAMES = {
  v1: {
    paymentSignature: "X-PAYMENT",
    paymentRequired: null, // V1 uses body
    paymentResponse: "X-PAYMENT-RESPONSE",
  },
  v2: {
    paymentSignature: "Payment-Signature",
    paymentRequired: "Payment-Required",
    paymentResponse: "Payment-Response",
  },
} as const;

/**
 * Build the version-correct wire payload and encode it as a base64 header value.
 * Returns both the header name to use and the encoded value.
 */
export function encodePaymentForWire(
  norm: NormalizedRequirement,
  authorization: ExactEvmAuthorization,
  signature: Hex,
  resource?: ResourceInfo,
): { headerName: string; headerValue: string; payload: PaymentPayload } {
  if (norm.version === 2) {
    const payload: PaymentPayloadV2 = {
      x402Version: 2,
      resource,
      accepted: norm.raw as PaymentRequirementsV2,
      payload: { signature, authorization },
    };
    return {
      headerName: HEADER_NAMES.v2.paymentSignature,
      headerValue: base64Encode(JSON.stringify(payload)),
      payload,
    };
  }
  const payload: PaymentPayloadV1 = {
    x402Version: 1,
    scheme: "exact",
    network: norm.networkString,
    payload: { signature, authorization },
  };
  return {
    headerName: HEADER_NAMES.v1.paymentSignature,
    headerValue: base64Encode(JSON.stringify(payload)),
    payload,
  };
}

/** V1 back-compat: encode an already-assembled PaymentPayloadV1. */
export function encodePaymentHeader(payload: PaymentPayload): string {
  return base64Encode(JSON.stringify(payload));
}

// ---------------------------------------------------------------------------
// 402 response parsing — body (V1) or header (V2)
// ---------------------------------------------------------------------------

/**
 * Parse a 402 HTTP response into a `PaymentRequired` object, detecting
 * the protocol version from the presence of the `Payment-Required` header
 * (V2) or falling back to the JSON body (V1).
 *
 * @param getHeader case-insensitive header lookup
 * @param body already-parsed JSON body (or null)
 */
export function parsePaymentRequiredResponse(
  getHeader: (name: string) => string | null | undefined,
  body: unknown,
): PaymentRequired | null {
  // V2 — header takes precedence
  const paymentRequiredHeader = getHeader("Payment-Required");
  if (paymentRequiredHeader) {
    try {
      const parsed = JSON.parse(base64Decode(paymentRequiredHeader));
      if (parsed && typeof parsed === "object" && parsed.x402Version === 2) {
        return parsed as PaymentRequiredV2;
      }
    } catch {
      // fall through to V1 body path
    }
  }

  // V1 — body contains `{x402Version:1, accepts:[...]}`
  if (
    body &&
    typeof body === "object" &&
    "x402Version" in body &&
    "accepts" in body &&
    Array.isArray((body as PaymentRequiredV1).accepts)
  ) {
    return body as PaymentRequiredV1;
  }

  return null;
}

/** Read a settlement receipt from either V1 or V2 response header. */
export function decodePaymentResponseHeader(
  header: string | null,
): { success: boolean; transaction?: Hex; network?: string; payer?: string } | null {
  if (!header) return null;
  try {
    return JSON.parse(base64Decode(header));
  } catch {
    return null;
  }
}

/** Version-aware response header reader. */
export function readSettleResponse(
  getHeader: (name: string) => string | null | undefined,
): { success: boolean; transaction?: Hex; network?: string; payer?: string } | null {
  return (
    decodePaymentResponseHeader(getHeader("Payment-Response") ?? null) ??
    decodePaymentResponseHeader(getHeader("X-Payment-Response") ?? null)
  );
}
