/**
 * @chain-ops/agent-sdk
 *
 * One-line SDK for x402 payments with ERC-8004 agent identity.
 * Pay, prove, reputation — in a single call.
 *
 * @packageDocumentation
 */

export { Agent, createAgent } from "./agent.js";

export type {
  AgentIdentity,
  AgentSdkError,
  CreateAgentConfig,
  PayOptions,
  PayResult,
  RegisterAgentInput,
  SupportedNetwork,
  TrustScore,
} from "./types.js";

// Power-user exports: useful for unit tests, custom hosting strategies,
// and introspection of what the SDK will write on-chain.
export {
  buildRegistrationJson,
  encodeRegistrationDataUrl,
  decodeRegistrationDataUrl,
  encodeBase64Utf8,
  estimateUriStorageWords,
} from "./registration-uri.js";
export type { RegistrationV1 } from "./registration-uri.js";

// Chain metadata exports: useful when a caller wants to display the
// on-chain addresses or build cross-chain agent references.
export {
  ERC8004_ADDRESSES,
  DEFAULT_RPC_URLS,
  buildAgentNamespace,
} from "./chains.js";

// x402 payment primitives: exposed so callers can pre-validate or build
// custom flows (e.g. server-side inspection of payment headers). Supports
// both V1 and V2 of the x402 protocol.
export {
  X402_VERSION,
  X402_VERSION_V1,
  X402_VERSION_V2,
  HEADER_NAMES,
  authorizationTypes,
  buildAuthorization,
  buildAuthorizationFromNormalized,
  createNonce,
  decodePaymentResponseHeader,
  encodePaymentForWire,
  encodePaymentHeader,
  normalizeRequirement,
  parsePaymentRequiredResponse,
  readSettleResponse,
  resolveChainIdFromNetworkString,
  selectPaymentRequirements,
  selectRequirement,
  signAuthorization,
  signAuthorizationNormalized,
  toCaip2,
  networkFromChainId,
} from "./payment.js";
export type {
  ExactEvmAuthorization,
  ExactEvmPayload,
  NormalizedRequirement,
  PaymentPayload,
  PaymentPayloadV1,
  PaymentPayloadV2,
  PaymentRequired,
  PaymentRequiredV1,
  PaymentRequiredV2,
  PaymentRequirements,
  PaymentRequirementsV1,
  PaymentRequirementsV2,
  ResourceInfo,
  X402NetworkName,
  X402ResourceResponse,
} from "./payment.js";
