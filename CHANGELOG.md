# Changelog

All notable changes to `@chain-ops/agent-sdk` are documented here.
This project follows [Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-04-20

First public release. One-line x402 × ERC-8004 SDK.

### Added

- `createAgent({ account, network })` — factory with `base`, `base-sepolia`, `optimism`, `arbitrum` support.
- `agent.registerAgent(input)` — mint ERC-8004 agent identity via inline `data:application/json;base64,…` agentURI (ADR-001).
- `agent.pay(url, opts?)` — 402 handshake with auto-detection of **x402 V1 and V2** (ADR-003):
  - V2 `Payment-Required` header → `Payment-Signature` response
  - V1 JSON body → `X-PAYMENT` response
  - Internal `NormalizedRequirement` shape keeps the EIP-3009 signing path version-agnostic.
  - Options: `maxPrice`, `minCounterpartyScore` (+ `counterpartyAgentId`), `updateReputation`, `network`, `timeoutMs`.
- `agent.getTrustScore(agentId)` — on-chain read of `ReputationRegistry.getSummary("starred")`, rescaled 0–1000.
- Power-user exports: `buildAuthorizationFromNormalized`, `signAuthorizationNormalized`, `encodePaymentForWire`, `parsePaymentRequiredResponse`, `resolveChainIdFromNetworkString`, `toCaip2`, `HEADER_NAMES`, registration URI helpers.
- 43 unit tests including real MGO V2 fixture + EIP-712 signature recovery verification.
- `examples/basic-usage.ts` and `examples/mgo-dogfood.ts` (live parse-only, opt-in paid mode).

### Protocol notes

- USDC on Base mainnet: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, EIP-712 domain `{ name: "USD Coin", version: "2", chainId: 8453 }`.
- ERC-8004 Identity Registry (Base mainnet): `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`.
- Off-chain signing — the agent spends zero gas; the facilitator submits the on-chain USDC transfer.

### Known limitations

- Solana (`svm`) scheme not yet supported — EVM `exact` only.
- `updateReputation` is currently a no-op placeholder; on-chain feedback writing lands in 0.2.0.
- `counterpartyAgentId` must be supplied explicitly when using `minCounterpartyScore` — the SDK does not derive it from `payTo` alone.
