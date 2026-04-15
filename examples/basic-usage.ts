/**
 * Basic usage example for @chain-ops/agent-sdk.
 *
 * Run:
 *   tsx examples/basic-usage.ts
 *
 * Required env:
 *   PRIVATE_KEY   — 0x-prefixed hex, funded with a few cents of Base USDC
 */

import { createAgent } from "@chain-ops/agent-sdk";
import type { Hex } from "viem";

async function main() {
  const privateKey = process.env.PRIVATE_KEY as Hex | undefined;
  if (!privateKey) {
    console.error("Set PRIVATE_KEY env var (0x-prefixed hex)");
    process.exit(1);
  }

  // 1. Create agent
  const agent = createAgent({
    account: privateKey,
    network: "base",
  });

  // 2. Register identity on ERC-8004 (one-time; skip if already registered)
  if (!agent.agentId) {
    console.log("Registering agent on ERC-8004...");
    const identity = await agent.registerAgent({
      name: "demo-agent",
      description: "A demo agent using @chain-ops/agent-sdk",
      tags: ["demo"],
    });
    console.log("Registered as tokenId:", identity.id);
  }

  // 3. Pay for a resource
  // Note: `minCounterpartyScore` requires `counterpartyAgentId` (the seller's
  // ERC-8004 tokenId) — we skip it here because MGO is not yet registered
  // on 8004. Add both together once you know your counterparty's id.
  console.log("Paying for MGO gas data...");
  const result = await agent.pay("https://api.mgo.chain-ops.xyz/gas/basic", {
    maxPrice: 10_000n, // cap at 0.01 USDC
  });

  console.log("Response:", result.body);
  console.log(`Paid ${result.pricePaid} micro-USDC`);
  console.log(`Tx: https://basescan.org/tx/${result.txHash}`);
  console.log(`Elapsed: ${result.elapsedMs}ms`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
