// =============================================================================
// AgentGate Custom Errors
// Typed errors for precise error handling across the payment pipeline
// =============================================================================

/**
 * Base error for all AgentGate errors.
 */
export class AgentGateError extends Error {
  public readonly code: string;

  constructor(message: string, code: string = 'AGENTGATE_ERROR') {
    super(message);
    this.name = 'AgentGateError';
    this.code = code;
    // Fix prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a payment intent violates a deterministic policy rule.
 * These are hard blocks — no LLM reasoning can override them.
 */
export class PolicyViolationError extends AgentGateError {
  public readonly policy: string;
  public readonly value: unknown;
  public readonly limit: unknown;

  constructor(message: string, policy: string, value?: unknown, limit?: unknown) {
    super(message, 'POLICY_VIOLATION');
    this.name = 'PolicyViolationError';
    this.policy = policy;
    this.value = value;
    this.limit = limit;
  }
}

/**
 * Thrown when the AI firewall blocks a payment.
 * This includes classifier, intent-diff, and human rejection layers.
 */
export class FirewallBlockedError extends AgentGateError {
  public readonly layer: string;
  public readonly confidence?: number;

  constructor(message: string, layer: string, confidence?: number) {
    super(message, 'FIREWALL_BLOCKED');
    this.name = 'FirewallBlockedError';
    this.layer = layer;
    this.confidence = confidence;
  }
}

/**
 * Thrown when no protocol adapter can handle the payment intent.
 */
export class NoAdapterError extends AgentGateError {
  public readonly protocol: string;

  constructor(protocol: string) {
    super(
      `No adapter registered for protocol "${protocol}". Register one with gate.use(adapter).`,
      'NO_ADAPTER'
    );
    this.name = 'NoAdapterError';
    this.protocol = protocol;
  }
}

/**
 * Thrown when a payment execution fails at the protocol level.
 */
export class PaymentFailedError extends AgentGateError {
  public readonly protocol: string;
  public readonly transactionId?: string;
  public readonly originalError?: unknown;

  constructor(message: string, protocol: string, transactionId?: string, originalError?: unknown) {
    super(message, 'PAYMENT_FAILED');
    this.name = 'PaymentFailedError';
    this.protocol = protocol;
    this.transactionId = transactionId;
    this.originalError = originalError;
  }
}
