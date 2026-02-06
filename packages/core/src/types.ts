// =============================================================================
// AgentGate Core Types
// Transaction firewall & protocol abstraction layer for AI agent payments
// =============================================================================

/**
 * Payment intent — the structured output of what an agent wants to pay.
 * This is the universal "request to pay" that flows through the entire pipeline.
 */
export interface PaymentIntent {
  id: string;
  to: string;                // recipient address or agent URI
  amount: number;
  currency: string;          // 'USDC', 'ETH', etc.
  purpose: string;           // human-readable description
  protocol?: 'x402' | 'ap2' | 'acp' | 'escrow';  // auto-detected if not set
  escrow?: EscrowConfig;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

/**
 * Escrow configuration — holds funds until conditions are met.
 */
export interface EscrowConfig {
  deadline: string;          // duration like '24h' or ISO timestamp
  evaluator?: string;        // evaluator agent URI or 'auto'
  milestones?: Milestone[];
}

/**
 * Milestone within an escrow — partial release of funds.
 */
export interface Milestone {
  description: string;
  amount: number;
  deadline: string;
}

/**
 * Policy — deterministic rules that no LLM can override.
 * This is the "constitution" of an agent's spending behavior.
 */
export interface PolicyConfig {
  maxPerTransaction?: number;
  maxDaily?: number;
  maxMonthly?: number;
  allowedRecipients?: string[];    // glob patterns like '*.verified'
  blockedRecipients?: string[];
  allowedCategories?: string[];
  requireEscrowAbove?: number;     // auto-escrow above this amount
  requireHumanApprovalAbove?: number;
  cooldownMs?: number;             // min time between transactions
}

/**
 * Firewall verdict — the output of each security layer.
 */
export interface FirewallVerdict {
  allowed: boolean;
  reason?: string;
  layer: 'classifier' | 'policy' | 'intent-diff' | 'human';
  confidence?: number;
  details?: Record<string, unknown>;
}

/**
 * Protocol adapter interface — x402, AP2, ACP all implement this.
 * Each adapter knows how to execute payments on a specific protocol.
 */
export interface ProtocolAdapter {
  name: string;
  canHandle(intent: PaymentIntent): boolean;
  execute(intent: PaymentIntent): Promise<PaymentResult>;
}

/**
 * Payment result — the outcome of executing a payment.
 */
export interface PaymentResult {
  success: boolean;
  transactionId?: string;
  protocol: string;
  amount: number;
  currency: string;
  recipient: string;
  timestamp: number;
  escrowId?: string;
  error?: string;
}

/**
 * AgentGate top-level configuration.
 */
export interface AgentGateConfig {
  wallet: WalletConfig;
  policies: PolicyConfig;
  firewall?: FirewallConfig;
  adapters?: ProtocolAdapter[];
  onHumanApproval?: (intent: PaymentIntent) => Promise<boolean>;
  logger?: Logger;
}

/**
 * Wallet configuration — how AgentGate connects to the blockchain.
 */
export interface WalletConfig {
  privateKey?: string;
  address: string;
  chain?: string;  // 'base', 'ethereum', 'solana'
}

/**
 * Firewall configuration — controls the AI-powered security layers.
 */
export interface FirewallConfig {
  enabled?: boolean;
  classifierEndpoint?: string;
  intentDiffThreshold?: number;   // 0-1, semantic similarity threshold
  originalInstruction?: string;   // user's original intent for comparison
}

/**
 * Logger interface — plug in your own logging.
 */
export interface Logger {
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
  error(msg: string, data?: unknown): void;
}
