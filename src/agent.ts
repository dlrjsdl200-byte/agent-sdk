import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  http,
  type Hex,
  type PrivateKeyAccount,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type {
  AgentIdentity,
  CreateAgentConfig,
  PayOptions,
  PayResult,
  RegisterAgentInput,
  SupportedNetwork,
  TrustScore,
} from "./types.js";

import { identityRegistryAbi } from "./abi/identity-registry.js";
import { reputationRegistryAbi } from "./abi/reputation-registry.js";
import {
  CHAINS,
  DEFAULT_RPC_URLS,
  ERC8004_ADDRESSES,
  buildAgentNamespace,
} from "./chains.js";
import {
  buildRegistrationJson,
  encodeRegistrationDataUrl,
} from "./registration-uri.js";
import {
  buildAuthorizationFromNormalized,
  encodePaymentForWire,
  parsePaymentRequiredResponse,
  readSettleResponse,
  selectRequirement,
  signAuthorizationNormalized,
  type NormalizedRequirement,
  type ResourceInfo,
} from "./payment.js";

// Package version is inlined here. Keep in lockstep with package.json.
const SDK_VERSION = "0.0.1";

/**
 * Main Agent class — the one-line entry point for x402 × ERC-8004.
 *
 * @example
 * ```ts
 * import { createAgent } from "@chain-ops/agent-sdk";
 *
 * const agent = createAgent({ account: process.env.PRIVATE_KEY as `0x${string}` });
 *
 * await agent.registerAgent({
 *   name: "my-gas-optimizer",
 *   description: "Finds cheapest EVM chain for gas",
 * });
 *
 * const result = await agent.pay("https://api.mgo.chain-ops.xyz/gas/basic");
 * console.log(result.body);
 * ```
 */
export class Agent {
  readonly network: SupportedNetwork;
  readonly facilitatorUrl: string;
  readonly account: PrivateKeyAccount;

  // viem clients are kept private — the exported Chain-generic union from
  // viem's type surface conflicts with the concrete chain-typed instance we
  // create, so we avoid leaking them on the public API. Users never need
  // raw viem clients; they call agent methods instead.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly _publicClient: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly _walletClient: any;

  private _agentId: string | undefined;

  constructor(config: CreateAgentConfig) {
    this.network = config.network ?? "base";
    this.facilitatorUrl = config.facilitatorUrl ?? "https://x402.org/facilitator";
    this._agentId = config.agentId;

    // Resolve account from either a raw hex key or a pre-built viem account.
    this.account =
      typeof config.account === "string"
        ? privateKeyToAccount(config.account)
        : config.account;

    const chain = CHAINS[this.network];
    const rpcUrl = config.rpcUrl ?? DEFAULT_RPC_URLS[this.network];
    const transport = http(rpcUrl);

    this._publicClient = createPublicClient({ chain, transport });
    this._walletClient = createWalletClient({
      chain,
      transport,
      account: this.account,
    });
  }

  /** ERC-8004 agent ID, if registered. */
  get agentId(): string | undefined {
    return this._agentId;
  }

  /** Global agent namespace per ERC-8004 spec: `eip155:{chainId}:{registry}`. */
  get namespace(): string {
    return buildAgentNamespace(this.network);
  }

  // =====================================================================
  // registerAgent — Day 3 scope
  // =====================================================================

  /**
   * Register this agent on ERC-8004.
   *
   * Implementation strategy (ADR-001 from docs/ARCHITECTURE.md): the SDK
   * builds an inline `data:application/json;base64,...` URL from the input
   * so callers never need to host a JSON file themselves. Tradeoff:
   * slightly higher gas cost for on-chain storage of the URI string.
   *
   * On-chain flow:
   *   1. Build registration-v1 JSON per ERC-8004 spec
   *   2. Encode as base64 data: URL
   *   3. Call IdentityRegistry.register(string agentURI) via walletClient
   *   4. Wait for receipt + parse Registered event for tokenId
   *   5. Cache tokenId on this._agentId and return full AgentIdentity
   *
   * @throws SettlementFailed if the transaction reverts or the event
   *         cannot be parsed
   */
  async registerAgent(input: RegisterAgentInput): Promise<AgentIdentity> {
    const network = input.network ?? this.network;
    const identityAddress = ERC8004_ADDRESSES[network].identityRegistry;
    const chain = CHAINS[network];

    // Step 1–2: build canonical JSON + encode as data: URL
    const json = buildRegistrationJson(input, network, SDK_VERSION);
    const agentURI = encodeRegistrationDataUrl(json);

    // Step 3: on-chain register. We target the single-arg `register(string)`
    // overload so viem can encode calldata unambiguously.
    const txHash = (await this._walletClient.writeContract({
      address: identityAddress,
      abi: identityRegistryAbi,
      functionName: "register",
      args: [agentURI],
      chain,
      account: this.account,
    })) as Hex;

    // Step 4: wait + decode Registered event
    const receipt = await this._publicClient.waitForTransactionReceipt({ hash: txHash });

    if (receipt.status !== "success") {
      throw new Error(
        `[agent-sdk] registerAgent: transaction reverted (txHash=${txHash})`,
      );
    }

    const agentId = extractAgentIdFromLogs(receipt.logs, identityAddress);
    if (agentId === null) {
      throw new Error(
        `[agent-sdk] registerAgent: Registered event not found in receipt logs (txHash=${txHash})`,
      );
    }

    this._agentId = agentId;

    return {
      id: agentId,
      owner: this.account.address,
      name: input.name,
      description: input.description,
      endpoints: input.endpoints,
      tags: input.tags,
      network,
      registeredAt: Math.floor(Date.now() / 1000),
    };
  }

  // =====================================================================
  // pay — Day 4 scope
  // =====================================================================

  /**
   * Pay for an x402-protected resource.
   *
   * Flow:
   *   1. GET the resource → expect HTTP 402 with `{x402Version, accepts[]}`
   *   2. Select a PaymentRequirements entry matching network + maxPrice
   *   3. Build + sign an EIP-3009 `TransferWithAuthorization`
   *   4. Re-request with the base64-encoded `X-PAYMENT` header
   *   5. Return the 200 body + settlement tx hash from `X-PAYMENT-RESPONSE`
   *
   * This is an **off-chain** signing flow — no gas is spent by the agent.
   * The facilitator submits the on-chain USDC transfer. Nonce + validBefore
   * bound replay risk, but a badly-formed signature can still leak a nonce,
   * so all the `extra.name` / `extra.version` / chainId / verifyingContract
   * fields must match what the USDC contract expects exactly.
   *
   * @throws if 402 response is malformed, no compatible requirement fits,
   *         price exceeds cap, counterparty score below threshold, or the
   *         post-payment request returns non-2xx.
   */
  async pay(url: string, opts: PayOptions = {}): Promise<PayResult> {
    const startedAt = Date.now();
    const timeoutMs = opts.timeoutMs ?? 30_000;
    const network = opts.network ?? this.network;

    // --- Step 1: probe for 402 ---------------------------------------------
    const probe = await fetchWithTimeout(url, { method: "GET" }, timeoutMs);

    if (probe.status !== 402) {
      const body = await safeJson(probe);
      return {
        status: probe.status,
        body,
        txHash: "0x" as Hex,
        pricePaid: 0n,
        elapsedMs: Date.now() - startedAt,
      };
    }

    // --- Step 2: parse 402 — V2 header OR V1 body --------------------------
    const probeBody = await safeJson(probe);
    const required = parsePaymentRequiredResponse(
      (name) => probe.headers.get(name),
      probeBody,
    );
    if (!required) {
      throw new Error(
        `[agent-sdk] pay(): 402 response missing 'Payment-Required' header (V2) ` +
          `or JSON body with x402Version+accepts (V1). url=${url}`,
      );
    }

    // --- Step 3: pick a normalized requirement -----------------------------
    const norm: NormalizedRequirement | null = selectRequirement(required.accepts, {
      agentNetwork: network,
      maxPrice: opts.maxPrice,
    });
    if (!norm) {
      const offered = required.accepts
        .map((r) => `${r.scheme}/${r.network}/${"amount" in r ? r.amount : r.maxAmountRequired}`)
        .join(", ");
      throw new Error(
        `[agent-sdk] pay(): no compatible requirement for network=${network}` +
          (opts.maxPrice !== undefined ? ` within maxPrice=${opts.maxPrice}` : "") +
          `. Server offered: ${offered}`,
      );
    }

    // --- Step 4 (optional): counterparty trust check -----------------------
    let counterpartyScore: number | undefined;
    const counterpartyAgentId =
      (opts as { counterpartyAgentId?: string }).counterpartyAgentId;

    if (opts.minCounterpartyScore !== undefined) {
      if (!counterpartyAgentId) {
        throw new Error(
          "[agent-sdk] pay(): minCounterpartyScore requires opts.counterpartyAgentId " +
            "(an ERC-8004 tokenId) — the SDK cannot derive it from payTo alone.",
        );
      }
      const score = await this.getTrustScore(counterpartyAgentId);
      counterpartyScore = score.score;
      if (score.score < opts.minCounterpartyScore) {
        throw new Error(
          `[agent-sdk] pay(): counterparty trust score ${score.score} below threshold ${opts.minCounterpartyScore}`,
        );
      }
    }

    // --- Step 5: sign EIP-3009 authorization (same for V1 and V2) ----------
    const authorization = buildAuthorizationFromNormalized(this.account.address, norm);
    const signature = await signAuthorizationNormalized(this.account, authorization, norm);

    // V2 resource echo — optional but some facilitators want it back
    const resource: ResourceInfo | undefined =
      norm.version === 2 && "resource" in required
        ? (required as { resource: ResourceInfo }).resource
        : undefined;

    const { headerName, headerValue } = encodePaymentForWire(
      norm,
      authorization,
      signature,
      resource,
    );

    // --- Step 6: re-request with the correct payment header ----------------
    const paid = await fetchWithTimeout(
      url,
      {
        method: "GET",
        headers: {
          [headerName]: headerValue,
          Accept: "application/json",
        },
      },
      timeoutMs,
    );

    if (paid.status < 200 || paid.status >= 300) {
      const errorBody = await safeJson(paid);
      throw new Error(
        `[agent-sdk] pay(): settlement attempt returned ${paid.status}. ` +
          `Body: ${JSON.stringify(errorBody)?.slice(0, 500)}`,
      );
    }

    const body = await safeJson(paid);

    // --- Step 7: extract settlement receipt (V1 or V2 header) --------------
    const settlement = readSettleResponse((name) => paid.headers.get(name));
    const txHash = (settlement?.transaction as Hex | undefined) ?? ("0x" as Hex);

    return {
      status: paid.status,
      body,
      txHash,
      pricePaid: norm.amount,
      counterpartyScore,
      elapsedMs: Date.now() - startedAt,
    };
  }

  // =====================================================================
  // getTrustScore — Day 2 scope (read-only, implemented)
  // =====================================================================

  /**
   * Fetch the trust score for any ERC-8004 agent.
   *
   * Day 2 implementation: read-only query against the on-chain
   * ReputationRegistry.getSummary() with tag1="starred" (0-100 scale).
   *
   * The raw 0-100 "starred" score is rescaled to the SDK's 0-1000 range.
   * Component breakdown uses placeholders for fields the current spec
   * does not directly expose (age/disputes/oracle); future iterations
   * will enrich these from indexed events.
   *
   * @param agentId - Target ERC-8004 tokenId (decimal string, as-emitted)
   */
  async getTrustScore(agentId: string): Promise<TrustScore> {
    const reputationAddress = ERC8004_ADDRESSES[this.network].reputationRegistry;
    const agentIdBigInt = BigInt(agentId);

    // ReputationRegistry.getSummary(agentId, [], "starred", "")
    // Empty clientAddresses array = full-population summary (any client).
    // tag2 left blank per spec convention.
    const result = (await this._publicClient.readContract({
      address: reputationAddress,
      abi: reputationRegistryAbi,
      functionName: "getSummary",
      args: [agentIdBigInt, [], "starred", ""],
    })) as readonly [bigint, bigint, number];

    const [count, summaryValue, summaryValueDecimals] = result;

    const score = normalizeStarredToScore(summaryValue, summaryValueDecimals, count);

    return {
      agentId,
      score,
      components: {
        age: 0, // filled in future iterations by indexing Registered events
        settlements: Number(count),
        disputes: 0, // no dispute signal in current spec
        oracle: 0, // optional RedStone/Credora integration not yet wired
      },
      computedAt: new Date().toISOString(),
      source: "onchain",
    };
  }
}

/**
 * Factory function — the canonical one-line entry point.
 * Prefer this over `new Agent(...)` for ergonomics.
 */
export function createAgent(config: CreateAgentConfig): Agent {
  return new Agent(config);
}

/**
 * Parse the `Registered(agentId, agentURI, owner)` event from a transaction
 * receipt's logs and return the agentId as a decimal string.
 *
 * We match on the registry address to ignore unrelated logs (e.g. ERC-721
 * Transfer emitted by the same contract, proxies, or events from other
 * contracts within the same transaction).
 *
 * Returns `null` if no Registered event is found.
 */
function extractAgentIdFromLogs(
  // viem typed logs aren't re-exported cleanly; the receipt shape is
  // stable enough to accept as a read-only array of the relevant fields.
  logs: ReadonlyArray<{ address: string; topics: readonly Hex[]; data: Hex }>,
  registryAddress: string,
): string | null {
  const normalized = registryAddress.toLowerCase();

  for (const log of logs) {
    if (log.address.toLowerCase() !== normalized) continue;

    try {
      const decoded = decodeEventLog({
        abi: identityRegistryAbi,
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      });

      if (decoded.eventName === "Registered") {
        const args = decoded.args as unknown as { agentId: bigint };
        return args.agentId.toString();
      }
    } catch {
      // Not a decodable ABI event for this registry; skip.
    }
  }

  return null;
}

/**
 * Convert ERC-8004 "starred" tag summary (0-100 with int128 + valueDecimals)
 * into the SDK's 0-1000 integer trust score.
 *
 * If no feedback has been given yet (count=0), returns 500 as a neutral
 * starting score rather than 0, so brand-new agents aren't penalised below
 * anyone who has received a single bad review.
 */
/**
 * fetch with a manual AbortController timeout — matches the timeoutMs
 * contract in PayOptions. Using AbortSignal.timeout would work too but
 * requires Node 18+; this is explicit.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Best-effort JSON parse. Returns null on empty body or parse failure. */
async function safeJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function normalizeStarredToScore(
  summaryValue: bigint,
  decimals: number,
  count: bigint,
): number {
  if (count === 0n) return 500;

  // summaryValue is scaled by 10^decimals. Bring it back to base units.
  const divisor = 10n ** BigInt(decimals);
  const base100 = Number(summaryValue) / Number(divisor || 1n);

  // Clamp to [0, 100] then rescale to [0, 1000].
  const clamped = Math.max(0, Math.min(100, base100));
  return Math.round(clamped * 10);
}
