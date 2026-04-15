# @chain-ops/agent-sdk

> **One-line SDK for [x402](https://x402.org) payments with [ERC-8004](https://github.com/ethereum/ERCs/blob/master/ERCS/erc-8004.md) agent identity.**
> Pay, prove, reputation — in a single call. Supports **x402 V1 and V2**.

[![npm](https://img.shields.io/npm/v/@chain-ops/agent-sdk)](https://www.npmjs.com/package/@chain-ops/agent-sdk)
[![license](https://img.shields.io/npm/l/@chain-ops/agent-sdk)](./LICENSE)
[![x402](https://img.shields.io/badge/x402-compatible-8b5cf6)](https://x402.org)
[![ERC-8004](https://img.shields.io/badge/ERC--8004-Trustless%20Agents-22d3ee)](https://github.com/ethereum/ERCs/blob/master/ERCS/erc-8004.md)

---

## Why this exists

[x402](https://x402.org) gives AI agents a payment rail.
[ERC-8004](https://github.com/ethereum/ERCs/blob/master/ERCS/erc-8004.md) gives AI agents an on-chain identity.
**They don't talk to each other yet.**

Today, a developer has to:

1. Manually call ERC-8004 to mint an agent identity
2. Manually set up x402 payment middleware
3. Hand-write the logic to attach identity to payment requests
4. Hand-write the reputation update after settlement
5. Hand-write the trust-score lookup before sending money

`@chain-ops/agent-sdk` does all of that in **one line**:

```ts
await agent.pay("https://api.example.com/premium");
```

That's it. Identity is attached. Trust is checked. Reputation is updated. Done.

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

// 3. Pay for any x402 resource — identity is attached automatically
const result = await agent.pay("https://api.mgo.chain-ops.xyz/gas/basic");
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
  attachIdentity: true,         // default
  minCounterpartyScore: 700,    // reject low-trust servers
  maxPrice: 10_000n,            // hard cap: 0.01 USDC
  updateReputation: true,        // default
});
```

Options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `attachIdentity` | `boolean` | `true` | Attach ERC-8004 identity proof to request |
| `minCounterpartyScore` | `number` | — | Reject counterparties below this trust score (0–1000) |
| `maxPrice` | `bigint` | — | Hard cap on USDC micro-units |
| `updateReputation` | `boolean` | `true` | Update on-chain reputation after success |
| `network` | `"base" \| ...` | config | Override network for this call |
| `timeoutMs` | `number` | `30_000` | End-to-end timeout |

### `getTrustScore(agentId)` — query any agent's reputation

```ts
const score = await agent.getTrustScore("12345");
console.log(score.score); // 0–1000
console.log(score.components); // { age, settlements, disputes, oracle }
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

Requirements are normalized internally so the EIP-3009 signing path is version-agnostic. See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) ADR-003 for the design.

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

**🚀 v0.1.0 — Week 1 complete, `pay()` + `registerAgent()` + `getTrustScore()` shipped.** Day 6 dogfood against live MGO surfaced an x402 V2 spec mismatch that's now fixed and tested end-to-end (43 tests, EIP-712 signature recovery verified).

See [`docs/ROADMAP.md`](./docs/ROADMAP.md) for the live timeline.
Follow along on [`x.com/gjmade`](https://x.com/gjmade) or the
[`그냥만들었어요`](https://www.youtube.com/@gjmade) YouTube channel.

We have a hard **kill gate** on **2026-04-28**. If adoption signals are insufficient by then, the project is archived transparently. See [`docs/KILL_CRITERIA.md`](./docs/KILL_CRITERIA.md).

---

## Related projects

- **[MGO (chain-ops.xyz)](https://chain-ops.xyz)** — x402 gas-price API, 9 chains. The SDK's first dogfood target; MGO sells API calls, agents buy them with this SDK.
- **[x402](https://x402.org)** — the base payment protocol (Coinbase).
- **[ERC-8004](https://github.com/ethereum/ERCs/blob/master/ERCS/erc-8004.md)** — Trustless Agents identity standard.
- **[Virtuals ACP](https://whitepaper.virtuals.io/about-virtuals/agent-commerce-protocol-acp)** — orchestration layer above x402.

---

## License

MIT © 2026 [chain-ops.xyz](https://chain-ops.xyz)
