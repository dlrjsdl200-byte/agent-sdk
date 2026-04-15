import type { RegisterAgentInput, SupportedNetwork } from "./types.js";

/**
 * ERC-8004 registration-v1 JSON schema.
 *
 * Reference: https://eips.ethereum.org/EIPS/eip-8004#agent-registration-file
 *
 * We emit only the subset of fields our SDK exposes. Callers who need
 * richer metadata (image, extra services, custom trust models) can extend
 * RegisterAgentInput in a future revision.
 */
export interface RegistrationV1 {
  type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1";
  name: string;
  description: string;
  services?: Array<{ name: string; endpoint: string; version?: string }>;
  x402Support: true;
  active: true;
  tags?: string[];
  sdk?: {
    name: "@chain-ops/agent-sdk";
    version: string;
    network: SupportedNetwork;
  };
}

/**
 * Build the canonical ERC-8004 registration JSON from SDK input.
 *
 * Keys are emitted in a stable order so identical input produces
 * byte-for-byte identical JSON → deterministic `data:` URL →
 * reproducible registrations across runs (useful for tests + CI).
 */
export function buildRegistrationJson(
  input: RegisterAgentInput,
  network: SupportedNetwork,
  sdkVersion: string,
): RegistrationV1 {
  const json: RegistrationV1 = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: input.name,
    description: input.description,
    x402Support: true,
    active: true,
    sdk: {
      name: "@chain-ops/agent-sdk",
      version: sdkVersion,
      network,
    },
  };

  if (input.endpoints && input.endpoints.length > 0) {
    json.services = input.endpoints.map((endpoint) => ({
      name: "web",
      endpoint,
    }));
  }

  if (input.tags && input.tags.length > 0) {
    json.tags = [...input.tags];
  }

  return json;
}

/**
 * Serialize the registration JSON into a canonical base64 `data:` URL.
 *
 * Cross-runtime base64 encode: Node's `Buffer` when available,
 * browser's `btoa` otherwise. The resulting URL looks like:
 *   `data:application/json;base64,<base64>`
 *
 * This URL is stored on-chain as the agent's `agentURI`. Any ERC-721
 * indexer, marketplace, or agent directory can decode it without needing
 * to hit an external HTTPS endpoint.
 */
export function encodeRegistrationDataUrl(json: RegistrationV1): string {
  // Stable-key JSON: insertion order is canonical because
  // buildRegistrationJson sets keys in a fixed sequence, and modern
  // JSON.stringify preserves insertion order for string keys.
  const jsonString = JSON.stringify(json);
  const base64 = encodeBase64Utf8(jsonString);
  return `data:application/json;base64,${base64}`;
}

/**
 * UTF-8 safe base64 encoder that works in both Node and browser runtimes.
 * Exposed internally so the decoder round-trip can be unit-tested.
 */
export function encodeBase64Utf8(input: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(input, "utf-8").toString("base64");
  }
  // Browser fallback: btoa needs Latin-1, so we percent-encode first.
  // eslint-disable-next-line no-undef
  return btoa(unescape(encodeURIComponent(input)));
}

/**
 * Decode a `data:` URL back to registration JSON.
 * Useful for tests and for `getAgent` read paths that want to display
 * metadata without dereferencing external URIs.
 *
 * Returns `null` if the URI is not a recognizable registration data URL.
 */
export function decodeRegistrationDataUrl(uri: string): RegistrationV1 | null {
  const prefix = "data:application/json;base64,";
  if (!uri.startsWith(prefix)) return null;

  try {
    const base64 = uri.slice(prefix.length);
    // Cross-runtime base64 decode: Node has Buffer, browsers have atob.
    const decoded =
      typeof Buffer !== "undefined"
        ? Buffer.from(base64, "base64").toString("utf-8")
        : decodeURIComponent(escape(atob(base64)));
    const parsed = JSON.parse(decoded) as RegistrationV1;
    if (parsed.type !== "https://eips.ethereum.org/EIPS/eip-8004#registration-v1") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Return the approximate byte cost of storing this URI on-chain.
 * ERC-8004 IdentityRegistry stores the URI as a dynamic string, so the
 * cost is dominated by SSTORE operations at roughly 20,000 gas per 32-byte
 * word for the first write.
 *
 * This is a *sanity-check* helper — it does not replace an actual gas
 * estimate from the network.
 */
export function estimateUriStorageWords(uri: string): number {
  return Math.ceil(uri.length / 32);
}
