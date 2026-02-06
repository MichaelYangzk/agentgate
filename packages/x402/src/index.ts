// =============================================================================
// @agentgate/x402 — Public API
// x402 protocol adapter for AgentGate
// =============================================================================

// Adapter
export { X402Adapter } from './adapter.js';

// Middleware
export { x402Paywall } from './middleware.js';
export type { X402PaywallOptions } from './middleware.js';

// Types
export type {
  X402Config,
  X402PaymentRequired,
  X402PaymentPayload,
  X402PaymentResponse,
  WalletSigner,
  SupportedCurrency,
} from './types.js';

export {
  CHAIN_IDS,
  DEFAULT_FACILITATOR_URL,
  SUPPORTED_CURRENCIES,
} from './types.js';
