// =============================================================================
// PolicyEngine — Deterministic "last line of defense"
// No LLM, no AI, no reasoning. Pure rules. If the policy says no, it's no.
// =============================================================================

import { PolicyConfig, PaymentIntent, FirewallVerdict } from './types.js';

export class PolicyEngine {
  private config: PolicyConfig;
  private dailySpend: Map<string, number>;   // 'YYYY-MM-DD' -> total spend
  private monthlySpend: Map<string, number>; // 'YYYY-MM' -> total spend
  private lastTransaction: number;

  constructor(config: PolicyConfig) {
    this.config = config;
    this.dailySpend = new Map();
    this.monthlySpend = new Map();
    this.lastTransaction = 0;
  }

  /**
   * Check a payment intent against ALL policy rules.
   * Returns the first violation found, or an "allowed" verdict.
   */
  evaluate(intent: PaymentIntent): FirewallVerdict {
    // Run each check in order of severity
    const checks = [
      this.checkAmount(intent),
      this.checkDailyLimit(intent),
      this.checkMonthlyLimit(intent),
      this.checkRecipient(intent),
      this.checkCategory(intent),
      this.checkCooldown(),
      this.checkEscrowRequirement(intent),
    ];

    for (const result of checks) {
      if (result !== null) {
        return result;
      }
    }

    // All checks passed
    return {
      allowed: true,
      layer: 'policy',
      reason: 'All policy checks passed',
    };
  }

  /**
   * Record a completed transaction — updates daily/monthly tracking.
   */
  recordTransaction(intent: PaymentIntent): void {
    const date = new Date(intent.timestamp);
    const dayKey = this.getDayKey(date);
    const monthKey = this.getMonthKey(date);

    this.dailySpend.set(dayKey, (this.dailySpend.get(dayKey) ?? 0) + intent.amount);
    this.monthlySpend.set(monthKey, (this.monthlySpend.get(monthKey) ?? 0) + intent.amount);
    this.lastTransaction = intent.timestamp;
  }

  /**
   * Reset all counters — useful for testing.
   */
  reset(): void {
    this.dailySpend.clear();
    this.monthlySpend.clear();
    this.lastTransaction = 0;
  }

  /**
   * Check if the human approval threshold is exceeded.
   * Returns true if approval is needed.
   */
  requiresHumanApproval(intent: PaymentIntent): boolean {
    if (this.config.requireHumanApprovalAbove === undefined) return false;
    return intent.amount > this.config.requireHumanApprovalAbove;
  }

  // ---------------------------------------------------------------------------
  // Private checks — each returns null if OK, or a FirewallVerdict if blocked
  // ---------------------------------------------------------------------------

  private checkAmount(intent: PaymentIntent): FirewallVerdict | null {
    if (this.config.maxPerTransaction === undefined) return null;

    if (intent.amount > this.config.maxPerTransaction) {
      return {
        allowed: false,
        layer: 'policy',
        reason: `Amount $${intent.amount} exceeds per-transaction limit of $${this.config.maxPerTransaction}`,
        details: {
          policy: 'maxPerTransaction',
          value: intent.amount,
          limit: this.config.maxPerTransaction,
        },
      };
    }
    return null;
  }

  private checkDailyLimit(intent: PaymentIntent): FirewallVerdict | null {
    if (this.config.maxDaily === undefined) return null;

    const dayKey = this.getDayKey(new Date(intent.timestamp));
    const currentDaily = this.dailySpend.get(dayKey) ?? 0;

    if (currentDaily + intent.amount > this.config.maxDaily) {
      return {
        allowed: false,
        layer: 'policy',
        reason: `Daily spend would reach $${currentDaily + intent.amount}, exceeding limit of $${this.config.maxDaily}`,
        details: {
          policy: 'maxDaily',
          currentSpend: currentDaily,
          intentAmount: intent.amount,
          limit: this.config.maxDaily,
        },
      };
    }
    return null;
  }

  private checkMonthlyLimit(intent: PaymentIntent): FirewallVerdict | null {
    if (this.config.maxMonthly === undefined) return null;

    const monthKey = this.getMonthKey(new Date(intent.timestamp));
    const currentMonthly = this.monthlySpend.get(monthKey) ?? 0;

    if (currentMonthly + intent.amount > this.config.maxMonthly) {
      return {
        allowed: false,
        layer: 'policy',
        reason: `Monthly spend would reach $${currentMonthly + intent.amount}, exceeding limit of $${this.config.maxMonthly}`,
        details: {
          policy: 'maxMonthly',
          currentSpend: currentMonthly,
          intentAmount: intent.amount,
          limit: this.config.maxMonthly,
        },
      };
    }
    return null;
  }

  private checkRecipient(intent: PaymentIntent): FirewallVerdict | null {
    // Check blocked recipients first (blocklist takes priority)
    if (this.config.blockedRecipients?.length) {
      for (const pattern of this.config.blockedRecipients) {
        if (this.matchesGlob(intent.to, pattern)) {
          return {
            allowed: false,
            layer: 'policy',
            reason: `Recipient "${intent.to}" is blocked by pattern "${pattern}"`,
            details: {
              policy: 'blockedRecipients',
              recipient: intent.to,
              matchedPattern: pattern,
            },
          };
        }
      }
    }

    // Check allowed recipients (allowlist — if set, only these pass)
    if (this.config.allowedRecipients?.length) {
      const isAllowed = this.config.allowedRecipients.some(
        (pattern) => this.matchesGlob(intent.to, pattern)
      );
      if (!isAllowed) {
        return {
          allowed: false,
          layer: 'policy',
          reason: `Recipient "${intent.to}" not in allowed recipients list`,
          details: {
            policy: 'allowedRecipients',
            recipient: intent.to,
            allowedPatterns: this.config.allowedRecipients,
          },
        };
      }
    }

    return null;
  }

  private checkCategory(intent: PaymentIntent): FirewallVerdict | null {
    if (!this.config.allowedCategories?.length) return null;

    const category = intent.metadata?.['category'] as string | undefined;
    if (category && !this.config.allowedCategories.includes(category)) {
      return {
        allowed: false,
        layer: 'policy',
        reason: `Category "${category}" is not in allowed categories`,
        details: {
          policy: 'allowedCategories',
          category,
          allowedCategories: this.config.allowedCategories,
        },
      };
    }

    return null;
  }

  private checkCooldown(): FirewallVerdict | null {
    if (this.config.cooldownMs === undefined) return null;
    if (this.lastTransaction === 0) return null;

    const elapsed = Date.now() - this.lastTransaction;
    if (elapsed < this.config.cooldownMs) {
      return {
        allowed: false,
        layer: 'policy',
        reason: `Cooldown active: ${this.config.cooldownMs - elapsed}ms remaining (min ${this.config.cooldownMs}ms between transactions)`,
        details: {
          policy: 'cooldownMs',
          elapsed,
          required: this.config.cooldownMs,
          remainingMs: this.config.cooldownMs - elapsed,
        },
      };
    }
    return null;
  }

  private checkEscrowRequirement(intent: PaymentIntent): FirewallVerdict | null {
    if (this.config.requireEscrowAbove === undefined) return null;

    if (intent.amount > this.config.requireEscrowAbove && !intent.escrow) {
      return {
        allowed: false,
        layer: 'policy',
        reason: `Amount $${intent.amount} exceeds $${this.config.requireEscrowAbove} — escrow configuration required`,
        details: {
          policy: 'requireEscrowAbove',
          amount: intent.amount,
          threshold: this.config.requireEscrowAbove,
        },
      };
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Glob matching — simple wildcard pattern matching
  // Supports: '*' (any chars), '?' (single char), exact match
  // Examples: '*.verified', 'agent://*', '0x1234*'
  // ---------------------------------------------------------------------------

  private matchesGlob(value: string, pattern: string): boolean {
    // Exact match fast path
    if (pattern === value) return true;
    if (pattern === '*') return true;

    // Convert glob pattern to regex
    let regexStr = '^';
    for (let i = 0; i < pattern.length; i++) {
      const char = pattern[i];
      switch (char) {
        case '*':
          regexStr += '.*';
          break;
        case '?':
          regexStr += '.';
          break;
        // Escape regex special characters
        case '.':
        case '+':
        case '^':
        case '$':
        case '{':
        case '}':
        case '(':
        case ')':
        case '|':
        case '[':
        case ']':
        case '\\':
          regexStr += '\\' + char;
          break;
        default:
          regexStr += char;
      }
    }
    regexStr += '$';

    try {
      return new RegExp(regexStr).test(value);
    } catch {
      // If regex compilation fails, fall back to exact match
      return pattern === value;
    }
  }

  // ---------------------------------------------------------------------------
  // Date key helpers
  // ---------------------------------------------------------------------------

  private getDayKey(date: Date): string {
    return date.toISOString().slice(0, 10); // 'YYYY-MM-DD'
  }

  private getMonthKey(date: Date): string {
    return date.toISOString().slice(0, 7); // 'YYYY-MM'
  }
}
