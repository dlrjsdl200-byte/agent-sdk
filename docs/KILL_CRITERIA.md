# Kill Criteria (LOCKED until 2026-04-28)

> **Do not edit thresholds.** This document is a pre-commitment device.
> Modifying numbers before 2026-04-28 = sunk-cost fallacy trap. Don't do it.

Mirror of `f:/wiki-gun/synthesis/2026-04-14-x402-sdk-kill-criteria.md` for public transparency.

## Binary rule

**Any axis 🔴 = unconditional KILL. No exceptions.**

## Axis 1 — Demand

| Grade | Threshold |
| --- | --- |
| 🟢 GO | NPM weekly downloads **≥ 50** OR GitHub stars **≥ 30** OR integration attempts **≥ 1** |
| 🟡 HOLD | NPM weekly 10–49 / stars 10–29 / no integration |
| 🔴 KILL | NPM weekly **< 10** AND stars **< 10** AND no reactions |

## Axis 2 — Competition

| Grade | Condition |
| --- | --- |
| 🟢 GO | No official integration SDK from Virtuals, Coinbase, Google |
| 🟡 HOLD | Rumors or announcements only, no shipped code |
| 🔴 KILL | Any competitor ships official integration OR merges similar |

### Daily watch list

- [ ] `x.com/virtuals_io`
- [ ] `blog.coinbase.com` + `docs.cdp.coinbase.com/x402`
- [ ] `x402.org` announcements
- [ ] `github.com/coinbase/x402/issues` and `/pulls`
- [ ] `r/ethdev`, `r/ethereum`, Hacker News
- [ ] Nevermined, t54.ai, Virtuals blog

## Axis 3 — ROI (most important)

| Grade | Condition |
| --- | --- |
| 🟢 GO | Actual work hours ≤ 2 weeks AND Billink LTD unaffected |
| 🟡 HOLD | Work 3–4 weeks AND Billink LTD delayed 1 week |
| 🔴 KILL | Work ≥ 5 weeks OR Billink LTD delayed ≥ 2 weeks |

## Composite rule

| Result | Action |
| --- | --- |
| All three 🟢 | 🚀 Phase 2 (paid registry, managed service) |
| 2× 🟢 + 1× 🟡 | 🔄 Extend +1 week (hard cap, no further extensions) |
| 2× 🟡 + 1× 🟢 | ⏸ MGO-internal only, stop public marketing |
| Any 🔴 | ❌ KILL, archive, asset reuse |

## Traps (pre-committed defenses)

1. **"A little more and it'll work"** → Day 14 ends with `git commit`, hash recorded here. One more line = timebox broken.
2. **"Just lower the threshold a bit"** → These numbers are locked until 2026-04-28.
3. **"One passionate early user appeared"** → 1 user is noise. Threshold is ≥ 1 integration attempt, not ≥ 1 tweet.
4. **"Competitor shipped but ours is better"** → Axis 2 🔴 = auto-kill. Standard position, not quality, is what the window was about.
5. **"Billink LTD can slip one more week"** → Axis 3 🔴 = auto-kill the moment Billink delay ≥ 2 weeks.

## Kill → asset reuse

If killed, the following is still salvaged:

- MGO internal integration (agent.pay() logic feeds ERC-8004 identity into MGO)
- `@gjmade` post-mortem episode ("I built the wrong thing in 2 weeks")
- ERC-8004 contract experience (learning reused in later web3 work)
- Brand: "Developer who actually shipped into x402 ecosystem"

**Total loss = 2 weeks of work-hours only.** Everything else recycles.

---

## Day 14 Result Template (fill only on 2026-04-28)

```
Date: ____

Axis 1 — Demand:
  NPM weekly: ____
  GitHub stars: ____
  Integration attempts: ____
  Grade: 🟢 / 🟡 / 🔴

Axis 2 — Competition:
  Virtuals: ____
  Coinbase: ____
  Google: ____
  Other: ____
  Grade: 🟢 / 🟡 / 🔴

Axis 3 — ROI:
  Actual work hours: ____
  Billink LTD delay (days): ____
  Grade: 🟢 / 🟡 / 🔴

Composite: ____

Decision: ____
Final commit hash: ____
Next action: ____
```

---

Signed 2026-04-14: 건 (decision) · Claude Code (execution partner)
