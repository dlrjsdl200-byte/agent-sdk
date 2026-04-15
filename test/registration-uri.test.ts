import { describe, expect, it } from "vitest";
import {
  buildRegistrationJson,
  decodeRegistrationDataUrl,
  encodeBase64Utf8,
  encodeRegistrationDataUrl,
  estimateUriStorageWords,
} from "../src/registration-uri.js";

describe("buildRegistrationJson", () => {
  it("emits the ERC-8004 registration-v1 type", () => {
    const json = buildRegistrationJson(
      { name: "gas-optimizer", description: "cheapest gas finder" },
      "base",
      "0.0.1",
    );
    expect(json.type).toBe(
      "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    );
    expect(json.name).toBe("gas-optimizer");
    expect(json.x402Support).toBe(true);
    expect(json.active).toBe(true);
    expect(json.sdk).toEqual({
      name: "@chain-ops/agent-sdk",
      version: "0.0.1",
      network: "base",
    });
  });

  it("maps endpoints to services[] but only when non-empty", () => {
    const empty = buildRegistrationJson(
      { name: "n", description: "d", endpoints: [] },
      "base",
      "0.0.1",
    );
    expect(empty.services).toBeUndefined();

    const one = buildRegistrationJson(
      { name: "n", description: "d", endpoints: ["https://api.example.com"] },
      "base",
      "0.0.1",
    );
    expect(one.services).toEqual([
      { name: "web", endpoint: "https://api.example.com" },
    ]);
  });

  it("copies tags when provided", () => {
    const j = buildRegistrationJson(
      { name: "n", description: "d", tags: ["gas", "base"] },
      "base",
      "0.0.1",
    );
    expect(j.tags).toEqual(["gas", "base"]);
  });
});

describe("data URL round-trip", () => {
  it("encode → decode restores the exact JSON", () => {
    const input = buildRegistrationJson(
      {
        name: "alpha",
        description: "beta gamma",
        tags: ["one", "two"],
        endpoints: ["https://a.example", "https://b.example"],
      },
      "base",
      "0.0.1",
    );
    const uri = encodeRegistrationDataUrl(input);
    expect(uri.startsWith("data:application/json;base64,")).toBe(true);
    const decoded = decodeRegistrationDataUrl(uri);
    expect(decoded).toEqual(input);
  });

  it("handles UTF-8 characters correctly", () => {
    const input = buildRegistrationJson(
      { name: "한글-agent", description: "약사 + 🚀" },
      "base",
      "0.0.1",
    );
    const decoded = decodeRegistrationDataUrl(encodeRegistrationDataUrl(input));
    expect(decoded).not.toBeNull();
    expect(decoded!.name).toBe("한글-agent");
    expect(decoded!.description).toBe("약사 + 🚀");
  });

  it("rejects a non-registration data URL", () => {
    expect(decodeRegistrationDataUrl("https://example.com/foo.json")).toBeNull();
    const badJson = `data:application/json;base64,${Buffer.from('{"type":"other"}').toString("base64")}`;
    expect(decodeRegistrationDataUrl(badJson)).toBeNull();
  });

  it("encodeBase64Utf8 is reversible", () => {
    const s = "Hello, 世界 🌍";
    const b64 = encodeBase64Utf8(s);
    expect(Buffer.from(b64, "base64").toString("utf-8")).toBe(s);
  });
});

describe("estimateUriStorageWords", () => {
  it("rounds up to 32-byte words", () => {
    // exactly 32 chars (ASCII = 32 bytes) → 1 word
    expect(estimateUriStorageWords("a".repeat(32))).toBe(1);
    // 33 chars → 2 words
    expect(estimateUriStorageWords("a".repeat(33))).toBe(2);
    // empty → 0 words
    expect(estimateUriStorageWords("")).toBe(0);
  });
});
