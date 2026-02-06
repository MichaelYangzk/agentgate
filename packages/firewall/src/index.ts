// =============================================================================
// @agentgate/firewall — Public API
// Transaction firewall for AI agent payment security
// =============================================================================

// Main firewall
export { TransactionFirewall } from './firewall.js';

// Classifiers
export { PatternClassifier } from './classifier.js';

// Intent processing
export { IntentExtractor } from './intent-extractor.js';
export type { StructuredIntent } from './intent-extractor.js';

export { IntentDiffChecker } from './intent-diff.js';
export type { DriftIndicator, IntentDiffResult } from './intent-diff.js';

// Patterns
export { FINANCIAL_INJECTION_PATTERNS } from './patterns.js';

// Types
export type {
  InjectionClassifier,
  PatternRule,
  TransactionFirewallConfig,
} from './types.js';
