# Architecture Decisions

> Live log of non-trivial design choices. Each entry is immutable once committed.

---

## ADR-001 — Agent URI Hosting Strategy

**Date**: 2026-04-15 (Day 2)
**Status**: Accepted
**Decision**: **Option A — Data URL inline**

### Context

ERC-8004 `IdentityRegistry.register(string agentURI)` requires a URI that resolves
to a JSON metadata file following the `registration-v1` schema (name, description,
services, x402Support, etc.). The SDK promises a *one-line* registration API, so
we must hide this hosting step from the caller.

Three candidates were evaluated:

| Option | How it works | Pros | Cons |
| --- | --- | --- | --- |
| **A. Data URL inline** | SDK encodes JSON as `data:application/json;base64,...` and passes it directly into `register(agentURI)`. The registry stores the URI on-chain. | No external dependencies. No network calls during register. Bit-for-bit reproducible. True one-line API. | Higher gas cost (~2–3× a pointer URL because the JSON lives in calldata + storage). |
| **B. Auto IPFS pin** | SDK pins JSON to IPFS via Pinata/Web3.Storage free tier, passes `ipfs://{cid}`. | Normal gas cost. Standard web3 convention. | External service dependency. Async pin failure modes. Pinning service rate limits. API keys required. |
| **C. Caller-supplied URI** | Caller hosts JSON, passes URL to SDK. | Maximum flexibility. Lowest gas. | Breaks one-line API promise. Non-technical users stuck. |

### Decision

**Option A** — Data URL inline.

### Rationale

1. **One-line API is the SDK's differentiator.** The whole point of
   `@chain-ops/agent-sdk` is that a caller writes one line and is done.
   Option C breaks this outright; Option B introduces an async failure mode
   that forces retry logic and env-var handling on the caller.
2. **Gas cost is a one-time ~$1–3 expense** on Base L2. Agents register
   exactly once. This is not a hot path. The cost is acceptable against
   the UX win.
3. **No external dependencies** aligns with the SDK philosophy of being
   self-contained. We ship as one NPM package, no account setup elsewhere.
4. **Reproducibility**: Data URLs are canonical — the same input always
   produces the same URI. Useful for tests and for CI/CD pipelines that
   replay registrations.
5. **Escape hatch**: `RegisterAgentInput` will still accept an optional
   `agentURI` override for users who *want* external hosting. The default
   is inline; the explicit escape hatch is Option C on demand.

### Consequences

- `registerAgent()` serializes input → JSON → base64 → `data:` URL inside
  the SDK (Day 3 scope).
- On-chain `tokenURI(agentId)` returns the inlined data URL. This is
  readable by any ERC-721 indexer.
- Storage cost is ~2–3× a short pointer URL. Acceptable.
- Future: if we add a large `image` field, we can still offload that to
  IPFS while keeping the parent JSON inlined.

### Open questions (deferred to Day 3)

- Maximum practical data URL length — need to measure concrete gas cost
  for a realistic metadata payload.
- Whether to strip / warn on absurdly large inputs (`description > 1KB`,
  `image` fields, etc.) to keep gas cost predictable.

---

## ADR-002 — viem client encapsulation

**Date**: 2026-04-15 (Day 2)
**Status**: Accepted
**Decision**: Keep viem's `PublicClient` / `WalletClient` private, expose only
SDK methods on the `Agent` class surface.

### Context

TypeScript's `PublicClient` / `WalletClient` exported types from viem are
Chain-generic unions that conflict with the concrete chain-typed instances
we construct at runtime (`createPublicClient({chain: base, ...})`). Attempting
to declare class fields with those exported types produces a `TS2322` error.

### Decision

viem clients are stored as private fields (`_publicClient`, `_walletClient`)
and only accessed from inside `Agent` methods. They are never part of the
public API.

### Rationale

- Users do not need raw viem clients — they call `agent.pay()`, `agent.getTrustScore()`,
  etc. The SDK is the abstraction.
- Keeping them private eliminates the type-surface headache without forcing
  a `satisfies` dance or type assertions at every call site.
- Future: if power users *do* need a viem escape hatch, we add a dedicated
  method (`agent.getPublicClient()`) that returns the concrete typed client
  on-demand. Not needed for v0.

### Consequences

- `any` is used for the private field types with an ESLint-disable comment
  on each line. This is intentional and localized.
- All viem calls happen inside `Agent` methods, making them easy to audit
  in one file.

---

## Template for future ADRs

```
## ADR-NNN — Title

**Date**: YYYY-MM-DD
**Status**: Proposed | Accepted | Deprecated | Superseded by ADR-XXX
**Decision**: One-sentence summary

### Context
Why this decision is needed now.

### Decision
What was chosen.

### Rationale
Why this option beats alternatives.

### Consequences
What changes downstream.
```

---

## ADR-003 — x402 V1 + V2 coexistence via normalized internal shape

**Date**: 2026-04-17 (Day 6)
**Status**: Accepted
**Decision**: Accept both V1 and V2 on the wire; normalize to a single internal `NormalizedRequirement` before signing.

### Context

Day 6 dogfood against `api.mgo.chain-ops.xyz/gas/basic` surfaced that our Day 4
`pay()` implementation (V1-only, based on `coinbase/x402 legacy/x402/src`) could
not parse MGO's 402 response. MGO runs the newer V2 protocol from
`coinbase/x402 typescript/packages/core`. V1 and V2 differ in:

| aspect | V1 | V2 |
|---|---|---|
| 402 location | JSON body | `Payment-Required` header (base64) |
| amount field | `maxAmountRequired` | `amount` |
| network format | loose string (`"base"`) | CAIP-2 (`"eip155:8453"`) |
| resource info | inside each requirement | top-level `resource: {url,…}` |
| request header | `X-PAYMENT` | `Payment-Signature` |
| response header | `X-PAYMENT-RESPONSE` | `Payment-Response` |
| payload wrapper | `{scheme, network, payload}` | `{accepted, payload}` |

The EIP-3009 `TransferWithAuthorization` message, domain, and types are
**identical** across versions — only the wrapping differs.

### Decision

- Introduce a version-agnostic `NormalizedRequirement` (`{chainId, amount: bigint, asset, payTo, maxTimeoutSeconds, extra, raw}`) that both V1 and V2 requirements collapse into.
- `buildAuthorizationFromNormalized()` + `signAuthorizationNormalized()` are the single signing path; they never branch on version.
- `parsePaymentRequiredResponse()` prefers the V2 header, falls back to the V1 body.
- `encodePaymentForWire()` is the only version-aware encoder: it picks header name + wrapper shape from `norm.version`.
- `resolveChainIdFromNetworkString()` accepts both CAIP-2 (`eip155:8453`) and V1 loose names (`base`).

### Rationale

- **Facilitators in flux**: Coinbase's facilitator currently accepts both versions. Refusing V1 would break testnet agents; refusing V2 would fail against MGO and any new servers.
- **Signing is the high-risk path**. Keeping it version-agnostic means only one piece of cryptographic code to audit.
- **Test surface**: a V2 fixture captured verbatim from the live MGO header (`test/payment-v2.test.ts`) guards the wire format. A future spec tweak will surface as a diff against this fixture, not as a silent production failure.
- **No breaking API**: the public `Agent.pay(url)` call signature is unchanged. Upgrade is transparent.

### Consequences

- SDK now exposes `NormalizedRequirement`, `PaymentRequirementsV1`, `PaymentRequirementsV2`, `HEADER_NAMES`, `toCaip2`, `resolveChainIdFromNetworkString` — power users can pre-validate without reaching into internals.
- Bundle grew from 25.8KB (CJS) → 30.3KB to carry V2 parser, encoder, and network table.
- Future version V3 (if any) plugs into the same normalized shape — only parser + encoder add a new branch.

### Dogfood verification

`examples/mgo-dogfood.ts` against live `api.mgo.chain-ops.xyz/gas/basic` (2026-04-17):
1. probe → HTTP 402
2. parse → `x402Version=2, accepts=1, network=eip155:8453, amount=1000`
3. select → `chainId=8453, asset=0x8335…2913, payTo=0x665b…dD7a`
4. sign → 130-char EIP-3009 signature from deterministic test key
5. encode → `Payment-Signature` header, 1080B base64

The `DRY_RUN=0` branch (actual USDC spend) is gated behind an env flag and has not been executed; exercising it requires a funded wallet.
