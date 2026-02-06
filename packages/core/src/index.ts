// =============================================================================
// @agentgate/core — Public API
// =============================================================================

// Types
export type {
  PaymentIntent,
  EscrowConfig,
  Milestone,
  PolicyConfig,
  FirewallVerdict,
  ProtocolAdapter,
  PaymentResult,
  AgentGateConfig,
  WalletConfig,
  FirewallConfig,
  Logger,
} from './types.js';

// Core classes
export { AgentGate } from './gate.js';
export { PolicyEngine } from './policy.js';

// Errors
export {
  AgentGateError,
  PolicyViolationError,
  FirewallBlockedError,
  NoAdapterError,
  PaymentFailedError,
} from './errors.js';
