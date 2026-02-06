// =============================================================================
// @agentgate/firewall — Types
// Transaction firewall types for injection detection and intent validation
// =============================================================================

import type { FirewallVerdict } from '@agentgate/core';

/**
 * Classifier interface — pluggable ML model for injection detection.
 * Implement this to bring your own model (OpenAI, Anthropic, local ONNX, etc.)
 */
export interface InjectionClassifier {
  /** Returns probability (0-1) that the input contains injection */
  classify(text: string): Promise<{ injectionProbability: number; details?: string }>;
}

/**
 * Built-in pattern-based rule for detecting injection attempts.
 */
export interface PatternRule {
  pattern: RegExp;
  severity: 'high' | 'medium' | 'low';
  description: string;
}

/**
 * Full configuration for the TransactionFirewall.
 */
export interface TransactionFirewallConfig {
  /** Custom ML-based classifier (optional — falls back to PatternClassifier) */
  classifier?: InjectionClassifier;
  /** Injection probability threshold (0-1). Above this = block. Default: 0.7 */
  injectionThreshold?: number;
  /** Intent-origin similarity threshold (0-1). Below this = block. Default: 0.6 */
  intentDiffThreshold?: number;
  /** User's original instruction for intent-origin comparison */
  originalInstruction?: string;
  /** Enable built-in pattern detection. Default: true */
  enablePatternDetection?: boolean;
  /** Additional custom patterns to check */
  customPatterns?: PatternRule[];
  /** Callback when a transaction is blocked */
  onBlock?: (verdict: FirewallVerdict) => void;
}
