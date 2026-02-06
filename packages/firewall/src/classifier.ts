// =============================================================================
// @agentgate/firewall — Pattern-based Injection Classifier
// Built-in classifier that uses regex patterns to detect prompt injection.
// No ML dependencies — works anywhere.
// =============================================================================

import type { InjectionClassifier, PatternRule } from './types.js';
import { FINANCIAL_INJECTION_PATTERNS } from './patterns.js';

/** Severity weights for scoring */
const SEVERITY_WEIGHTS: Record<PatternRule['severity'], number> = {
  high: 0.4,
  medium: 0.2,
  low: 0.1,
};

/**
 * PatternClassifier — scores text against a set of regex rules.
 * Each matched pattern contributes to the injection probability.
 * The result is capped at 1.0.
 */
export class PatternClassifier implements InjectionClassifier {
  private patterns: PatternRule[];

  constructor(customPatterns?: PatternRule[]) {
    this.patterns = [...FINANCIAL_INJECTION_PATTERNS, ...(customPatterns ?? [])];
  }

  async classify(text: string): Promise<{ injectionProbability: number; details?: string }> {
    const matches: string[] = [];
    let score = 0;

    for (const rule of this.patterns) {
      // Reset lastIndex for patterns with global flag
      if (rule.pattern.global) {
        rule.pattern.lastIndex = 0;
      }

      if (rule.pattern.test(text)) {
        score += SEVERITY_WEIGHTS[rule.severity];
        matches.push(`[${rule.severity}] ${rule.description}`);
      }

      // Reset again after test
      if (rule.pattern.global) {
        rule.pattern.lastIndex = 0;
      }
    }

    const injectionProbability = Math.min(score, 1.0);
    const details = matches.length > 0
      ? `Matched ${matches.length} pattern(s): ${matches.join('; ')}`
      : undefined;

    return { injectionProbability, details };
  }
}
