# Roadmap — 2-Week Build Sprint

> **Hard deadline: 2026-04-28**. Kill criteria enforced. See [KILL_CRITERIA.md](./KILL_CRITERIA.md).

## Week 1 — Build

| Day | Date | Goal | Status |
| --- | --- | --- | --- |
| 1 | 2026-04-14 | Scaffold: package.json, tsconfig, types, stub API, README | ✅ |
| 2 | 2026-04-15 | Research deployed addresses, ABIs, chains.ts, `getTrustScore()` read impl, ADR-001/002 | ✅ |
| 3 | 2026-04-16 | `registerAgent()` — data: URL encoding + on-chain mint + event parsing (ADR-001) | ✅ |
| 4 | 2026-04-17 | `pay()` — x402 402-handshake + EIP-3009 signing | ✅ |
| 5 | 2026-04-18 | vitest unit tests — 24 tests passing (registration-uri + payment incl. EIP-712 recovery) | ✅ |
| 6 | 2026-04-19 | Dogfood against live MGO — **V2 spec mismatch found & fixed**, 43 tests, parse+sign path verified | ✅ |
| 7 | 2026-04-20 | README polish, examples/, **`npm publish @chain-ops/agent-sdk@0.1.0` LIVE** | ✅ |

## Week 2 — Distribute + Measure

| Day | Date | Goal | Status |
| --- | --- | --- | --- |
| 8 | 2026-04-21 | x402.org forum post + Virtuals Discord share | ⬜ |
| 9 | 2026-04-22 | r/ethdev + Hacker News "Show HN" | ⬜ |
| 10 | 2026-04-23 | `@gjmade` English short: "I built the missing SDK in a weekend" | ⬜ |
| 11 | 2026-04-24 | Twitter/X thread + ecosystem player mentions | ⬜ |
| 12 | 2026-04-25 | Feedback triage, issue response (< 24h SLA) | ⬜ |
| 13 | 2026-04-26 | Final polish + v0.2.0 if needed | ⬜ |
| **14** | **2026-04-28** | **🚨 KILL GATE — open KILL_CRITERIA.md, fill in, decide** | ⬜ |

## Daily ritual

- Morning (5 min): competitor scan — Virtuals, Coinbase x402, Google AP2, x402.org
- End of day: update this file's status column
- Always: Billink LTD schedule check — if slipping > 1 week, trigger Axis 3 kill

## Decision gate output (Day 14 only)

See [KILL_CRITERIA.md](./KILL_CRITERIA.md) — fill in the results template. Do not modify thresholds.
