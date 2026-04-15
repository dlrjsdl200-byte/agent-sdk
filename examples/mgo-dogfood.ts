/**
 * Dogfood: @chain-ops/agent-sdk paying api.mgo.chain-ops.xyz
 *
 * This script exercises the full SDK path against our own MGO endpoint.
 * It is the moment the SDK feeds itself: we're both the seller (MGO) and
 * the buyer (agent-sdk). If anything about V2 parsing, CAIP-2 network
 * resolution, or EIP-3009 signing is wrong, this is where it shows up.
 *
 * SAFETY
 * ------
 * - Pass `DRY_RUN=1` (default) to *parse + sign but NOT send* the X-PAYMENT
 *   request. Nothing leaves your machine after the 402 probe. No USDC is
 *   spent. No nonce is burned against the facilitator.
 * - Only pass `DRY_RUN=0` with a funded wallet on Base mainnet. $0.001 USDC
 *   per call for /gas/basic.
 *
 * USAGE
 * -----
 *   # probe + parse only (no signing)
 *   npx tsx examples/mgo-dogfood.ts
 *
 *   # parse + sign + encode (still no network write)
 *   PRIVATE_KEY=0x... npx tsx examples/mgo-dogfood.ts
 *
 *   # full paid call (USDC will move!)
 *   PRIVATE_KEY=0x... DRY_RUN=0 npx tsx examples/mgo-dogfood.ts
 */

import {
  buildAuthorizationFromNormalized,
  encodePaymentForWire,
  HEADER_NAMES,
  parsePaymentRequiredResponse,
  selectRequirement,
  signAuthorizationNormalized,
} from "../src/payment.js";
import { privateKeyToAccount } from "viem/accounts";

const MGO_URL = process.env.MGO_URL ?? "https://api.mgo.chain-ops.xyz/gas/basic";
const DRY_RUN = process.env.DRY_RUN !== "0";
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}` | undefined;

async function main(): Promise<void> {
  console.log(`\n[dogfood] ${MGO_URL}  (DRY_RUN=${DRY_RUN ? "on" : "OFF — REAL SPEND"})`);

  // ---- Step 1: probe ------------------------------------------------------
  const probe = await fetch(MGO_URL, { method: "GET" });
  console.log(`[1] status ${probe.status}`);

  if (probe.status !== 402) {
    const body = await probe.json().catch(() => null);
    console.log(`[!] expected 402, got ${probe.status}. Body:`, body);
    return;
  }

  // ---- Step 2: parse ------------------------------------------------------
  const probeBody = await probe.json().catch(() => null);
  const required = parsePaymentRequiredResponse(
    (n) => probe.headers.get(n),
    probeBody,
  );
  if (!required) {
    console.log(`[!] 402 response neither V1 body nor V2 Payment-Required header`);
    return;
  }
  console.log(`[2] parsed x402Version=${required.x402Version}, accepts=${required.accepts.length}`);
  for (const r of required.accepts) {
    const amount = "amount" in r ? r.amount : r.maxAmountRequired;
    console.log(`    - scheme=${r.scheme} network=${r.network} amount=${amount} asset=${r.asset}`);
  }

  // ---- Step 3: select -----------------------------------------------------
  const norm = selectRequirement(required.accepts, {
    agentNetwork: "base",
    maxPrice: 10_000n, // $0.01 USDC cap
  });
  if (!norm) {
    console.log(`[!] no compatible requirement for base within maxPrice=10000`);
    return;
  }
  console.log(
    `[3] selected: chainId=${norm.chainId} amount=${norm.amount} asset=${norm.asset} payTo=${norm.payTo}`,
  );

  // ---- Step 4: sign (only if PRIVATE_KEY provided) ------------------------
  if (!PRIVATE_KEY) {
    console.log(`[4] skipped signing (no PRIVATE_KEY)`);
    console.log(`\n[dogfood] parse-only path OK. Provide PRIVATE_KEY to sign.`);
    return;
  }

  const account = privateKeyToAccount(PRIVATE_KEY);
  const auth = buildAuthorizationFromNormalized(account.address, norm);
  console.log(
    `[4] authorization: from=${auth.from} to=${auth.to} value=${auth.value} ` +
      `validAfter=${auth.validAfter} validBefore=${auth.validBefore}`,
  );

  const signature = await signAuthorizationNormalized(account, auth, norm);
  console.log(`[5] signed: ${signature.slice(0, 20)}… (${signature.length - 2}/2 hex chars)`);

  const wire = encodePaymentForWire(norm, auth, signature, ("resource" in required) ? required.resource : undefined);
  console.log(
    `[6] encoded: header=${wire.headerName} value=${wire.headerValue.slice(0, 48)}… (${wire.headerValue.length}B)`,
  );

  // ---- Step 7: paid request (only if DRY_RUN=0) ---------------------------
  if (DRY_RUN) {
    console.log(`\n[dogfood] DRY_RUN stops here. Set DRY_RUN=0 to actually send.`);
    return;
  }

  console.log(`[7] sending paid request with ${wire.headerName}…`);
  const paid = await fetch(MGO_URL, {
    method: "GET",
    headers: { [wire.headerName]: wire.headerValue, Accept: "application/json" },
  });
  console.log(`[7] status ${paid.status}`);

  // check for either V1 or V2 settle header
  const settleHeader =
    paid.headers.get(HEADER_NAMES.v2.paymentResponse) ??
    paid.headers.get(HEADER_NAMES.v1.paymentResponse);
  console.log(`    ${HEADER_NAMES.v2.paymentResponse}: ${settleHeader ? settleHeader.slice(0, 48) + "…" : "(none)"}`);

  const responseBody = await paid.text();
  console.log(`[8] body (first 300B): ${responseBody.slice(0, 300)}`);
}

main().catch((err) => {
  console.error(`[dogfood] failed:`, err);
  process.exit(1);
});
