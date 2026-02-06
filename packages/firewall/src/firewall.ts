// =============================================================================
// @agentgate/firewall — TransactionFirewall
// The core security engine. Validates every payment intent through multiple
// layers before execution to prevent prompt injection attacks.
// =============================================================================

import type { PaymentIntent, FirewallVerdict } from '@agentgate/core';
import type { TransactionFirewallConfig, InjectionClassifier } from './types.js';
import { PatternClassifier } from './classifier.js';
import { IntentExtractor } from './intent-extractor.js';
import { IntentDiffChecker } from './intent-diff.js';

const DEFAULT_INJECTION_THRESHOLD = 0.7;
const DEFAULT_INTENT_DIFF_THRESHOLD = 0.6;

/**
 * TransactionFirewall — multi-layer security gate for payment intents.
 *
 * Layer 1: Injection classifier (pattern-based or custom ML)
 * Layer 2: Structured intent extraction + field mismatch detection
 * Layer 3: Intent-origin comparison (drift from user's original instruction)
 *
 * A payment intent must pass ALL layers to be allowed through.
 */
export class TransactionFirewall {
  private config: Required<
    Pick<TransactionFirewallConfig, 'injectionThreshold' | 'intentDiffThreshold' | 'enablePatternDetection'>
  > & TransactionFirewallConfig;

  private classifier: InjectionClassifier;
  private extractor: IntentExtractor;
  private diffChecker: IntentDiffChecker | null;

  constructor(config: TransactionFirewallConfig = {}) {
    this.config = {
      injectionThreshold: config.injectionThreshold ?? DEFAULT_INJECTION_THRESHOLD,
      intentDiffThreshold: config.intentDiffThreshold ?? DEFAULT_INTENT_DIFF_THRESHOLD,
      enablePatternDetection: config.enablePatternDetection ?? true,
      ...config,
    };

    // Use custom classifier or fall back to pattern-based
    this.classifier = config.classifier ?? new PatternClassifier(config.customPatterns);
    this.extractor = new IntentExtractor();
    this.diffChecker = config.originalInstruction
      ? new IntentDiffChecker(config.originalInstruction)
      : null;
  }

  /**
   * Run all firewall layers on a payment intent.
   * Returns the first blocking verdict, or an "allowed" verdict if all pass.
   */
  async evaluate(intent: PaymentIntent): Promise<FirewallVerdict> {
    // -----------------------------------------------------------------------
    // Layer 1: Injection Classifier
    // Scan intent.purpose + intent.to + serialized metadata for injections
    // -----------------------------------------------------------------------
    const textToScan = this.buildScanText(intent);
    const classificationResult = await this.classifier.classify(textToScan);

    if (classificationResult.injectionProbability >= this.config.injectionThreshold) {
      const verdict: FirewallVerdict = {
        allowed: false,
        layer: 'classifier',
        reason: `Injection detected (probability: ${classificationResult.injectionProbability.toFixed(2)}). ${classificationResult.details ?? ''}`,
        confidence: classificationResult.injectionProbability,
        details: {
          injectionProbability: classificationResult.injectionProbability,
          classifierDetails: classificationResult.details,
        },
      };
      this.config.onBlock?.(verdict);
      return verdict;
    }

    // -----------------------------------------------------------------------
    // Layer 2: Structured Intent Extraction + Field Mismatch
    // Extract structured fields from purpose and compare against intent fields
    // -----------------------------------------------------------------------
    const extracted = this.extractor.extract(intent.purpose);
    const mismatches: string[] = [];

    // Check if purpose mentions a different amount
    if (extracted.amount !== null && Math.abs(extracted.amount - intent.amount) > 0.01) {
      mismatches.push(
        `Amount mismatch: intent says ${intent.amount} but purpose text implies ${extracted.amount}`
      );
    }

    // Check if purpose mentions a different recipient
    if (extracted.to !== null && extracted.to.toLowerCase() !== intent.to.toLowerCase()) {
      mismatches.push(
        `Recipient mismatch: intent says "${intent.to}" but purpose text implies "${extracted.to}"`
      );
    }

    // Check if purpose mentions a different currency
    if (extracted.currency !== null && extracted.currency.toUpperCase() !== intent.currency.toUpperCase()) {
      mismatches.push(
        `Currency mismatch: intent says ${intent.currency} but purpose text implies ${extracted.currency}`
      );
    }

    if (mismatches.length > 0) {
      const verdict: FirewallVerdict = {
        allowed: false,
        layer: 'intent-diff',
        reason: `Structured intent mismatch: ${mismatches.join('; ')}`,
        confidence: 0.8,
        details: {
          mismatches,
          extractedIntent: extracted,
        },
      };
      this.config.onBlock?.(verdict);
      return verdict;
    }

    // -----------------------------------------------------------------------
    // Layer 3: Intent-Origin Comparison (if original instruction provided)
    // Compare payment intent against what the user originally requested
    // -----------------------------------------------------------------------
    if (this.diffChecker) {
      const diffResult = this.diffChecker.check(intent);

      if (diffResult.similarity < this.config.intentDiffThreshold) {
        const verdict: FirewallVerdict = {
          allowed: false,
          layer: 'intent-diff',
          reason: `Intent drift detected (similarity: ${diffResult.similarity.toFixed(2)}, threshold: ${this.config.intentDiffThreshold}). Drifted fields: ${diffResult.drifts.map(d => d.field).join(', ')}`,
          confidence: 1 - diffResult.similarity,
          details: {
            similarity: diffResult.similarity,
            drifts: diffResult.drifts,
          },
        };
        this.config.onBlock?.(verdict);
        return verdict;
      }
    }

    // -----------------------------------------------------------------------
    // All layers passed
    // -----------------------------------------------------------------------
    return {
      allowed: true,
      layer: 'classifier',
      reason: 'All firewall checks passed',
      confidence: 1 - classificationResult.injectionProbability,
      details: {
        injectionProbability: classificationResult.injectionProbability,
        extractedIntent: extracted,
      },
    };
  }

  /**
   * Update the original instruction for intent-origin comparison.
   * Call this when the user issues a new command.
   */
  setOriginalInstruction(instruction: string): void {
    this.config.originalInstruction = instruction;
    this.diffChecker = new IntentDiffChecker(instruction);
  }

  /**
   * Build the text to scan for injections from a PaymentIntent.
   */
  private buildScanText(intent: PaymentIntent): string {
    const parts: string[] = [intent.purpose, intent.to];

    if (intent.metadata) {
      // Serialize metadata values — injections can hide in any field
      for (const value of Object.values(intent.metadata)) {
        if (typeof value === 'string') {
          parts.push(value);
        } else if (value !== null && value !== undefined) {
          parts.push(String(value));
        }
      }
    }

    return parts.join(' ');
  }
}
