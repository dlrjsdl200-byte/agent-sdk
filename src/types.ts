import type { Address, Hex, PrivateKeyAccount } from "viem";

/**
 * Supported EVM networks where ERC-8004 registry + x402 settlement live.
 * Base is the default (x402 reference network).
 */
export type SupportedNetwork = "base" | "base-sepolia" | "optimism" | "arbitrum";

/**
 * Agent identity record stored on-chain via ERC-8004.
 * Mirrors the Trustless Agents standard (2026-01 launch).
 */
export interface AgentIdentity {
  /** ERC-8004 tokenId (uint256 as string for JSON safety). */
  id: string;
  /** Owner EOA that controls this agent. */
  owner: Address;
  /** Human-readable handle. */
  name: string;
  /** Short description shown to counterparties. */
  description: string;
  /** Endpoint(s) the agent exposes. Optional. */
  endpoints?: string[];
  /** Free-form tags for discovery. */
  tags?: string[];
  /** Network where the NFT was minted. */
  network: SupportedNetwork;
  /** Block timestamp of registration. */
  registeredAt: number;
}

/**
 * Input for `registerAgent` — subset of AgentIdentity needed to mint.
 */
export interface RegisterAgentInput {
  name: string;
  description: string;
  endpoints?: string[];
  tags?: string[];
  network?: SupportedNetwork;
}

/**
 * Trust score returned by `getTrustScore`.
 * 0–1000 integer scale. Higher = more trustworthy.
 *
 * The score is a composite of:
 *  - on-chain age (registration recency penalty)
 *  - successful settlement count (x402 history)
 *  - dispute/refund ratio (if tracked)
 *  - external oracle signals (RedStone / Credora when available)
 */
export interface TrustScore {
  agentId: string;
  score: number;
  /** Raw component breakdown for transparency. */
  components: {
    age: number;
    settlements: number;
    disputes: number;
    oracle: number;
  };
  /** ISO timestamp of score computation. */
  computedAt: string;
  /** Provenance — "onchain" | "cached" | "oracle". */
  source: "onchain" | "cached" | "oracle";
}

/**
 * Options for `agent.pay()` — the single biggest API of the SDK.
 */
export interface PayOptions {
  /** Attach ERC-8004 identity proof to the x402 request. Default: true. */
  attachIdentity?: boolean;
  /** Reject if counterparty trust score is below this threshold. Default: disabled. */
  minCounterpartyScore?: number;
  /** Maximum USDC (in micro-units, 1e-6) willing to pay. Hard cap. */
  maxPrice?: bigint;
  /** Automatically update reputation after successful settlement. Default: true. */
  updateReputation?: boolean;
  /** Override network for this specific call. */
  network?: SupportedNetwork;
  /** Timeout in milliseconds. Default: 30_000. */
  timeoutMs?: number;
}

/**
 * Result of a successful `agent.pay()` call.
 */
export interface PayResult {
  /** HTTP status returned by the resource server (typically 200). */
  status: number;
  /** Parsed response body. */
  body: unknown;
  /** Transaction hash of the on-chain settlement. */
  txHash: Hex;
  /** Actual price paid in USDC micro-units. */
  pricePaid: bigint;
  /** Counterparty trust score at time of payment, if checked. */
  counterpartyScore?: number;
  /** Milliseconds elapsed end-to-end. */
  elapsedMs: number;
}

/**
 * Errors thrown by the SDK.
 * Use discriminated union for type-safe catching.
 */
export type AgentSdkError =
  | { kind: "identity-not-registered"; message: string }
  | { kind: "trust-score-below-threshold"; message: string; score: number; threshold: number }
  | { kind: "price-exceeds-cap"; message: string; requested: bigint; cap: bigint }
  | { kind: "settlement-failed"; message: string; txHash?: Hex }
  | { kind: "counterparty-unreachable"; message: string }
  | { kind: "network-mismatch"; message: string }
  | { kind: "timeout"; message: string };

/**
 * Constructor config for `createAgent()`.
 */
export interface CreateAgentConfig {
  /** Private key hex or pre-built viem account. Required for signing payments + registering identity. */
  account: PrivateKeyAccount | Hex;
  /** Default network. Defaults to "base". */
  network?: SupportedNetwork;
  /** Custom RPC URL. Defaults to public Base RPC. */
  rpcUrl?: string;
  /** Custom x402 facilitator URL. Defaults to Coinbase CDP facilitator. */
  facilitatorUrl?: string;
  /** Pre-registered ERC-8004 agent ID. If omitted, SDK will require registerAgent() before pay(). */
  agentId?: string;
}
