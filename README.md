# @chain-ops/agent-sdk

> **x402 payment client for AI agents, with [ERC-8004](https://github.com/ethereum/ERCs/blob/master/ERCS/erc-8004.md) identity registration and trust lookup.**
> `agent.pay(url)` handles the whole 402 handshake. Supports **x402 V1 and V2**.

[![npm](https://img.shields.io/npm/v/@chain-ops/agent-sdk)](https://www.npmjs.com/package/@chain-ops/agent-sdk)
[![license](https://img.shields.io/npm/l/@chain-ops/agent-sdk)](./LICENSE)
[![x402](https://img.shields.io/badge/x402-compatible-8b5cf6)](https://x402.org)
[![ERC-8004](https://img.shields.io/badge/ERC--8004-Trustless%20Agents-22d3ee)](https://github.com/ethereum/ERCs/blob/master/ERCS/erc-8004.md)

---

## Why this exists

[x402](https://x402.org) gives AI agents a payment rail.
[ERC-8004](https://github.com/ethereum/ERCs/blob/master/ERCS/erc-8004.md) gives AI agents an on-chain identity.
**They don't talk to each other yet.**

`@chain-ops/agent-sdk` packages the pieces you need today:

- **`pay(url)`** — GET, read the 402 (V1 body or V2 header), pick a compatible requirement, sign the EIP-3009 USDC authorization, retry, return the body and the settlement tx hash. One line, no gas spent by the agent.
- **`registerAgent()`** — mint your ERC-8004 identity on-chain.
- **`getTrustScore()`** — read any agent's reputation summary, optionally gate `pay()` on it.

```ts
await agent.pay("https://api.example.com/premium", { maxPrice: 10_000n });
```

What it does **not** do yet (honest roadmap, see [CHANGELOG](./CHANGELOG.md)): attach an identity proof to the request, or write reputation feedback after settlement. Those are planned for 0.2.0.

---

## Install

```bash
npm install @chain-ops/agent-sdk viem
# or
pnpm add @chain-ops/agent-sdk viem
```

Requires **Node 18+**.

---

## Quick Start

```ts
import { createAgent } from "@chain-ops/agent-sdk";

// 1. Create agent from a private key
const agent = createAgent({
  account: process.env.PRIVATE_KEY as `0x${string}`,
  network: "base",
});

// 2. Register on ERC-8004 (one-time)
await agent.registerAgent({
  name: "my-gas-optimizer",
  description: "Finds the cheapest EVM chain for gas",
  tags: ["gas", "evm", "trading"],
});

// 3. Pay for any x402 resource (default hard cap: 1 USDC per call)
const result = await agent.pay("https://api.mgo.chain-ops.xyz/gas/basic", { maxPrice: 10_000n });
console.log(result.body);
console.log(`Paid ${result.pricePaid} micro-USDC in ${result.elapsedMs}ms`);
```

---

## Core API (3 functions)

### `registerAgent(input)` — mint your on-chain identity

```ts
const identity = await agent.registerAgent({
  name: "my-agent",
  description: "What this agent does",
  endpoints: ["https://my-agent.example.com"],
  tags: ["defi", "oracle"],
});

console.log(identity.id); // ERC-8004 tokenId
```

### `pay(url, opts?)` — pay and execute

```ts
const result = await agent.pay("https://api.example.com/data", {
  maxPrice: 10_000n,            // hard cap: 0.01 USDC (default when omitted: 1 USDC)
  minCounterpartyScore: 700,    // reject low-trust servers...
  counterpartyAgentId: "12345", // ...identified by their ERC-8004 tokenId
});
```

Options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `maxPrice` | `bigint` | `1_000_000n` | Hard cap on USDC micro-units (1 USDC by default) |
| `minCounterpartyScore` | `number` | — | Reject counterparties below this trust score (0–1000) |
| `counterpartyAgentId` | `string` | — | ERC-8004 tokenId of the server; required with `minCounterpartyScore` |
| `attachIdentity` | `boolean` | — | **Deprecated, ignored** (not implemented yet) |
| `updateReputation` | `boolean` | — | **Deprecated, ignored** (not implemented yet) |
| `network` | `"base" \| ...` | config | Override network for this call |
| `timeoutMs` | `number` | `30_000` | End-to-end timeout |

### `getTrustScore(agentId)` — query any agent's reputation

```ts
const score = await agent.getTrustScore("12345");
console.log(score.score); // 0–1000 (500 = neutral, no feedback yet)
console.log(score.components.settlements); // number of feedback entries
```

---

## How it works

```
┌──────────────────┐
│   Your Agent     │
│  createAgent()   │
└────────┬─────────┘
         │
         │ agent.pay(url)
         ▼
┌───────────────────────────────────────┐
│   @chain-ops/agent-sdk                │
│  ┌────────────────────────────────┐   │
│  │ 1. GET url → 402               │   │
│  │ 2. Parse V1 body or V2 header  │   │
│  │ 3. (opt) Trust check via 8004  │──►│ ERC-8004 registry
│  │ 4. Sign EIP-3009 TransferAuth  │   │  (USDC domain)
│  │ 5. Retry w/ X-PAYMENT or       │──►│ x402 facilitator
│  │    Payment-Signature header    │   │
│  │ 6. Extract settlement tx hash  │   │
│  └────────────────────────────────┘   │
└───────────────────────────────────────┘
```

All on Base L2. USDC settlement. No API keys. Off-chain signing — **the agent spends zero gas**; the facilitator submits the on-chain transfer.

### x402 V1 + V2

The SDK auto-detects protocol version per response:

| aspect | V1 (legacy) | V2 (current) |
|---|---|---|
| 402 location | JSON body | `Payment-Required` header |
| amount field | `maxAmountRequired` | `amount` |
| network format | `"base"` | CAIP-2 `"eip155:8453"` |
| request header | `X-PAYMENT` | `Payment-Signature` |

Requirements are normalized internally so the EIP-3009 signing path is version-agnostic. Requirements that ask for a Permit2 transfer are skipped (EIP-3009 only). See [`docs/ARCHITECTURE.md`](https://github.com/dlrjsdl200-byte/agent-sdk/blob/main/docs/ARCHITECTURE.md) ADR-003 for the design.

---

## Examples

Live dogfood against [`api.mgo.chain-ops.xyz/gas/basic`](https://api.mgo.chain-ops.xyz/gas/basic):

```bash
# parse-only (safe, no signing)
npx tsx examples/mgo-dogfood.ts

# parse + sign + encode (no network write)
PRIVATE_KEY=0x... npx tsx examples/mgo-dogfood.ts

# full paid call — USDC will move
PRIVATE_KEY=0x... DRY_RUN=0 npx tsx examples/mgo-dogfood.ts
```

See [`examples/`](./examples) for more.

---

## Status

**Maintenance mode.** `pay()`, `registerAgent()` and `getTrustScore()` are implemented and unit-tested (EIP-712 signature recovery verified against a live MGO V2 fixture). The weekly [Bazaar keepalive](./.github/workflows/bazaar-keepalive.yml) settles a real $0.001 USDC payment through this SDK against [api.mgo.chain-ops.xyz](https://api.mgo.chain-ops.xyz), so the payment path is exercised on mainnet every week. Bug fixes land; new features (identity attachment, reputation writes) are not scheduled.

If you only need x402 payments, Coinbase's [`@x402/fetch`](https://www.npmjs.com/package/@x402/fetch) is the reference client; this SDK adds the ERC-8004 identity/trust helpers on top.

---

## Related projects

- **[MGO (chain-ops.xyz)](https://chain-ops.xyz)** — x402 gas-price API, 9 chains. The SDK's first dogfood target; MGO sells API calls, agents buy them with this SDK.
- **[x402](https://x402.org)** — the base payment protocol (Coinbase).
- **[ERC-8004](https://github.com/ethereum/ERCs/blob/master/ERCS/erc-8004.md)** — Trustless Agents identity standard.
- **[Virtuals ACP](https://whitepaper.virtuals.io/about-virtuals/agent-commerce-protocol-acp)** — orchestration layer above x402.

---

## License

MIT © 2026 [chain-ops.xyz](https://chain-ops.xyz)
