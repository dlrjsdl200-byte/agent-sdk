import { base, baseSepolia, optimism, arbitrum } from "viem/chains";
import type { Chain } from "viem";
import type { SupportedNetwork } from "./types.js";

/**
 * ERC-8004 deployed contract addresses.
 *
 * Source: https://github.com/erc-8004/erc-8004-contracts
 *
 * Mainnets (Ethereum, Base, Arbitrum, Polygon, Optimism, Avalanche, BSC,
 * Celo, Gnosis, Linea, Mantle, Scroll, Taiko, XLayer) all share the same
 * vanity addresses. Testnets share a different pair.
 */
export const ERC8004_ADDRESSES = {
  base: {
    identityRegistry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    reputationRegistry: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
  },
  "base-sepolia": {
    identityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    reputationRegistry: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
  },
  optimism: {
    identityRegistry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    reputationRegistry: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
  },
  arbitrum: {
    identityRegistry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    reputationRegistry: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
  },
} as const satisfies Record<SupportedNetwork, { identityRegistry: `0x${string}`; reputationRegistry: `0x${string}` }>;

/**
 * Viem chain objects for each supported network.
 */
export const CHAINS = {
  base,
  "base-sepolia": baseSepolia,
  optimism,
  arbitrum,
} as const satisfies Record<SupportedNetwork, Chain>;

/**
 * Default public RPC URLs. Callers can override via `rpcUrl` in CreateAgentConfig.
 * Production users should supply their own Alchemy / QuickNode / public RPC.
 */
export const DEFAULT_RPC_URLS: Record<SupportedNetwork, string> = {
  base: "https://mainnet.base.org",
  "base-sepolia": "https://sepolia.base.org",
  optimism: "https://mainnet.optimism.io",
  arbitrum: "https://arb1.arbitrum.io/rpc",
};

/**
 * Global Agent Identifier per ERC-8004 spec: `{namespace}:{chainId}:{registry}`
 * Used to construct fully-qualified agent references across chains.
 */
export function buildAgentNamespace(network: SupportedNetwork): string {
  const chain = CHAINS[network];
  const registry = ERC8004_ADDRESSES[network].identityRegistry;
  return `eip155:${chain.id}:${registry}`;
}
