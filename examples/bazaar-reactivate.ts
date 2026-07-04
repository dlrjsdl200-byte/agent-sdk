/**
 * Bazaar re-activation — one clean paid call to api.mgo.chain-ops.xyz
 *
 * WHY THIS EXISTS
 * ---------------
 * CDP's x402 Bazaar drops any resource with no settled payment in the last
 * 30 days from its search results. MGO's last real payment was 2026-03-08,
 * so it has been INVISIBLE in Bazaar discovery since early April. A single
 * settled $0.001 call brings it back within ~6 hours (Bazaar recomputes
 * quality/recency on a 6-hour schedule).
 *
 * Unlike examples/mgo-dogfood.ts (which drives the low-level payment.js
 * primitives step-by-step for debugging), this script uses the SAME
 * high-level `agent.pay()` API a real customer would — so it dogfoods the
 * public SDK surface and doubles as a "does the happy path work end-to-end"
 * smoke test.
 *
 * SAFETY  ⚠️  THIS SPENDS REAL USDC ON BASE MAINNET
 * -------------------------------------------------
 * - DRY_RUN=1 (the default) probes the 402 and prints what WOULD be paid,
 *   then stops. Nothing is signed, nothing is sent, no USDC moves.
 * - DRY_RUN=0 performs the real paid call: $0.001 USDC for /gas/basic,
 *   plus a small amount of Base ETH for gas is NOT needed here — the CDP
 *   facilitator submits the on-chain USDC transfer; the agent only signs
 *   off-chain (EIP-3009). You still need USDC in the wallet.
 * - The wallet you pay FROM should be DIFFERENT from the payTo wallet
 *   (0x665bab4…dd7a) so that self-payments are distinguishable from real
 *   customer revenue when you audit incoming transfers.
 *
 * USAGE
 * -----
 *   # 1) dry run — see the quote, spend nothing (safe to run anytime)
 *   npx tsx examples/bazaar-reactivate.ts
 *
 *   # 2) real payment — reactivates Bazaar listing (USDC WILL MOVE)
 *   PRIVATE_KEY=0x... DRY_RUN=0 npx tsx examples/bazaar-reactivate.ts
 *
 * The PRIVATE_KEY is read from the environment only. It is never written to
 * disk or logged. Prefer loading it from a local .env you do NOT commit.
 */

import { createAgent } from "../src/agent.js";

const MGO_URL = process.env.MGO_URL ?? "https://api.mgo.chain-ops.xyz/gas/basic";
const DRY_RUN = process.env.DRY_RUN !== "0";
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}` | undefined;

// $0.001 = 1000 (6-decimal USDC). Cap at $0.01 so a mispriced/hijacked 402
// can never drain more than a cent.
const MAX_PRICE = 10_000n;

async function main(): Promise<void> {
  console.log(`\n[bazaar-reactivate] target: ${MGO_URL}`);
  console.log(`[bazaar-reactivate] mode:   ${DRY_RUN ? "DRY_RUN (no spend)" : "⚠️  LIVE — REAL USDC SPEND"}\n`);

  if (DRY_RUN) {
    // Probe only — show the quote without a key so anyone can preview cost.
    const probe = await fetch(MGO_URL, { method: "GET" });
    console.log(`[1] probe status: ${probe.status} (402 = payment required, as expected)`);
    if (probe.status === 402) {
      const header = probe.headers.get("Payment-Required");
      console.log(`[2] Payment-Required header present: ${header ? "yes" : "no"}`);
      console.log(
        `\n[bazaar-reactivate] DRY_RUN stops here. Nothing was signed or sent.\n` +
          `  To actually reactivate the Bazaar listing, run:\n` +
          `    PRIVATE_KEY=0x... DRY_RUN=0 npx tsx examples/bazaar-reactivate.ts\n`,
      );
    } else {
      console.log(`[!] expected 402 but got ${probe.status} — the endpoint may be misconfigured.`);
    }
    return;
  }

  // ---- LIVE path ----------------------------------------------------------
  if (!PRIVATE_KEY) {
    console.error(
      `[!] DRY_RUN=0 requires PRIVATE_KEY in the environment.\n` +
        `    PRIVATE_KEY=0x... DRY_RUN=0 npx tsx examples/bazaar-reactivate.ts`,
    );
    process.exit(1);
  }

  const agent = createAgent({ account: PRIVATE_KEY, network: "base" });

  console.log(`[1] paying via agent.pay() — this is the exact call a customer makes…`);
  const result = await agent.pay(MGO_URL, { maxPrice: MAX_PRICE });

  console.log(`[2] HTTP status:  ${result.status}`);
  console.log(`[3] tx hash:      ${result.txHash}`);
  console.log(`[4] price paid:   ${result.pricePaid} (USDC base units, 6 decimals)`);
  console.log(`[5] elapsed:      ${result.elapsedMs}ms`);

  if (result.status >= 200 && result.status < 300 && result.txHash && result.txHash !== "0x") {
    console.log(
      `\n✅ Settled. Bazaar recomputes recency/quality on a ~6-hour cycle,\n` +
        `   so MGO should reappear in Bazaar search within ~6 hours.\n` +
        `   Verify tx: https://basescan.org/tx/${result.txHash}\n`,
    );
  } else {
    console.log(
      `\n⚠️  Call completed but did not look like a settled payment ` +
        `(status=${result.status}, txHash=${result.txHash}). Check the endpoint and wallet balance.\n`,
    );
  }
}

main().catch((err) => {
  console.error(`[bazaar-reactivate] failed:`, err instanceof Error ? err.message : err);
  process.exit(1);
});
