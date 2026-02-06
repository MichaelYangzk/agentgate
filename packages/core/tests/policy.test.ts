// =============================================================================
// PolicyEngine Tests
// Deterministic spending rules — the "last line of defense"
// =============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { PolicyEngine } from '../src/policy.js';
import type { PaymentIntent, PolicyConfig } from '../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIntent(overrides: Partial<PaymentIntent> = {}): PaymentIntent {
  return {
    id: 'test-intent-1',
    to: 'agent://service.verified',
    amount: 50,
    currency: 'USDC',
    purpose: 'Test payment',
    timestamp: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// maxPerTransaction
// ---------------------------------------------------------------------------

describe('PolicyEngine — maxPerTransaction', () => {
  it('should allow amounts within the limit', () => {
    const engine = new PolicyEngine({ maxPerTransaction: 100 });
    const verdict = engine.evaluate(makeIntent({ amount: 50 }));
    expect(verdict.allowed).toBe(true);
    expect(verdict.layer).toBe('policy');
  });

  it('should allow amounts exactly at the limit', () => {
    const engine = new PolicyEngine({ maxPerTransaction: 100 });
    const verdict = engine.evaluate(makeIntent({ amount: 100 }));
    expect(verdict.allowed).toBe(true);
  });

  it('should block amounts exceeding the limit', () => {
    const engine = new PolicyEngine({ maxPerTransaction: 100 });
    const verdict = engine.evaluate(makeIntent({ amount: 150 }));
    expect(verdict.allowed).toBe(false);
    expect(verdict.layer).toBe('policy');
    expect(verdict.reason).toContain('per-transaction limit');
    expect(verdict.details?.['policy']).toBe('maxPerTransaction');
    expect(verdict.details?.['value']).toBe(150);
    expect(verdict.details?.['limit']).toBe(100);
  });

  it('should skip check when maxPerTransaction is not set', () => {
    const engine = new PolicyEngine({});
    const verdict = engine.evaluate(makeIntent({ amount: 999999 }));
    expect(verdict.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Daily limit tracking
// ---------------------------------------------------------------------------

describe('PolicyEngine — daily limit', () => {
  let engine: PolicyEngine;

  beforeEach(() => {
    engine = new PolicyEngine({ maxDaily: 500 });
  });

  it('should allow first transaction within daily limit', () => {
    const verdict = engine.evaluate(makeIntent({ amount: 200 }));
    expect(verdict.allowed).toBe(true);
  });

  it('should track cumulative daily spending', () => {
    const now = Date.now();

    // Record 3 transactions of $150 each = $450 total
    for (let i = 0; i < 3; i++) {
      engine.recordTransaction(makeIntent({ id: `tx-${i}`, amount: 150, timestamp: now }));
    }

    // $450 + $100 = $550 > $500 limit — should block
    const verdict = engine.evaluate(makeIntent({ amount: 100, timestamp: now }));
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain('Daily spend');
    expect(verdict.details?.['policy']).toBe('maxDaily');
  });

  it('should allow if cumulative spend stays within limit', () => {
    const now = Date.now();

    // Record $200
    engine.recordTransaction(makeIntent({ amount: 200, timestamp: now }));

    // $200 + $250 = $450 < $500 — should allow
    const verdict = engine.evaluate(makeIntent({ amount: 250, timestamp: now }));
    expect(verdict.allowed).toBe(true);
  });

  it('should reset counters on reset()', () => {
    const now = Date.now();

    // Fill up to $400
    engine.recordTransaction(makeIntent({ amount: 400, timestamp: now }));

    // $400 + $200 = $600 > $500 — blocked
    let verdict = engine.evaluate(makeIntent({ amount: 200, timestamp: now }));
    expect(verdict.allowed).toBe(false);

    // Reset
    engine.reset();

    // Same check should now pass
    verdict = engine.evaluate(makeIntent({ amount: 200, timestamp: now }));
    expect(verdict.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Recipient allowlist / blocklist with glob patterns
// ---------------------------------------------------------------------------

describe('PolicyEngine — recipient filtering', () => {
  it('should block recipients matching blocklist glob pattern', () => {
    const engine = new PolicyEngine({
      blockedRecipients: ['*attacker*', '*evil*'],
    });

    const verdict = engine.evaluate(makeIntent({ to: '0xattacker-wallet-abc' }));
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain('blocked');
    expect(verdict.details?.['policy']).toBe('blockedRecipients');
  });

  it('should allow recipients not matching blocklist', () => {
    const engine = new PolicyEngine({
      blockedRecipients: ['*attacker*'],
    });

    const verdict = engine.evaluate(makeIntent({ to: 'agent://legitimate.service' }));
    expect(verdict.allowed).toBe(true);
  });

  it('should allow recipients matching allowlist glob pattern', () => {
    const engine = new PolicyEngine({
      allowedRecipients: ['*.verified', 'agent://*'],
    });

    const verdict = engine.evaluate(makeIntent({ to: 'api-service.verified' }));
    expect(verdict.allowed).toBe(true);
  });

  it('should block recipients not matching allowlist', () => {
    const engine = new PolicyEngine({
      allowedRecipients: ['*.verified', 'agent://*'],
    });

    const verdict = engine.evaluate(makeIntent({ to: 'random-unknown-service.xyz' }));
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain('not in allowed recipients');
    expect(verdict.details?.['policy']).toBe('allowedRecipients');
  });

  it('should give blocklist priority over allowlist', () => {
    const engine = new PolicyEngine({
      allowedRecipients: ['*.verified'],
      blockedRecipients: ['attacker.verified'],
    });

    // This matches allowlist pattern BUT is explicitly blocked
    const verdict = engine.evaluate(makeIntent({ to: 'attacker.verified' }));
    expect(verdict.allowed).toBe(false);
    expect(verdict.details?.['policy']).toBe('blockedRecipients');
  });

  it('should support wildcard-only pattern', () => {
    const engine = new PolicyEngine({
      allowedRecipients: ['*'],
    });

    const verdict = engine.evaluate(makeIntent({ to: 'literally-anything' }));
    expect(verdict.allowed).toBe(true);
  });

  it('should support single-char wildcard (?)', () => {
    const engine = new PolicyEngine({
      blockedRecipients: ['evil-agent-?'],
    });

    const verdict1 = engine.evaluate(makeIntent({ to: 'evil-agent-1' }));
    expect(verdict1.allowed).toBe(false);

    const verdict2 = engine.evaluate(makeIntent({ to: 'evil-agent-AB' }));
    expect(verdict2.allowed).toBe(true); // '?' only matches single char
  });
});

// ---------------------------------------------------------------------------
// Cooldown enforcement
// ---------------------------------------------------------------------------

describe('PolicyEngine — cooldown', () => {
  it('should allow first transaction (no previous tx)', () => {
    const engine = new PolicyEngine({ cooldownMs: 5000 });
    const verdict = engine.evaluate(makeIntent());
    expect(verdict.allowed).toBe(true);
  });

  it('should block if cooldown has not elapsed', () => {
    const engine = new PolicyEngine({ cooldownMs: 5000 });

    // Record a transaction
    engine.recordTransaction(makeIntent({ timestamp: Date.now() }));

    // Immediately try another — should be blocked
    const verdict = engine.evaluate(makeIntent());
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain('Cooldown');
    expect(verdict.details?.['policy']).toBe('cooldownMs');
  });

  it('should allow after cooldown period has elapsed', async () => {
    const engine = new PolicyEngine({ cooldownMs: 50 }); // 50ms for testing

    engine.recordTransaction(makeIntent({ timestamp: Date.now() }));

    // Wait for cooldown
    await new Promise((resolve) => setTimeout(resolve, 60));

    const verdict = engine.evaluate(makeIntent());
    expect(verdict.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Escrow requirement detection
// ---------------------------------------------------------------------------

describe('PolicyEngine — escrow requirement', () => {
  it('should allow below escrow threshold without escrow config', () => {
    const engine = new PolicyEngine({ requireEscrowAbove: 1000 });
    const verdict = engine.evaluate(makeIntent({ amount: 500 }));
    expect(verdict.allowed).toBe(true);
  });

  it('should block above escrow threshold without escrow config', () => {
    const engine = new PolicyEngine({
      requireEscrowAbove: 1000,
    });

    const intent = makeIntent({ amount: 1500 });
    const verdict = engine.evaluate(intent);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain('escrow configuration required');
    expect(verdict.details?.['policy']).toBe('requireEscrowAbove');
  });

  it('should allow above escrow threshold when escrow is configured', () => {
    const engine = new PolicyEngine({ requireEscrowAbove: 1000 });

    const intent = makeIntent({
      amount: 1500,
      escrow: {
        deadline: '24h',
        evaluator: 'auto',
      },
    });

    const verdict = engine.evaluate(intent);
    expect(verdict.allowed).toBe(true);
  });

  it('should allow at exactly the escrow threshold without escrow', () => {
    const engine = new PolicyEngine({ requireEscrowAbove: 1000 });
    const verdict = engine.evaluate(makeIntent({ amount: 1000 }));
    // amount === threshold, not > threshold, so should be allowed
    expect(verdict.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Human approval detection
// ---------------------------------------------------------------------------

describe('PolicyEngine — human approval', () => {
  it('should not require approval when threshold is not set', () => {
    const engine = new PolicyEngine({});
    expect(engine.requiresHumanApproval(makeIntent({ amount: 999999 }))).toBe(false);
  });

  it('should not require approval below threshold', () => {
    const engine = new PolicyEngine({ requireHumanApprovalAbove: 100 });
    expect(engine.requiresHumanApproval(makeIntent({ amount: 50 }))).toBe(false);
  });

  it('should not require approval at exactly the threshold', () => {
    const engine = new PolicyEngine({ requireHumanApprovalAbove: 100 });
    expect(engine.requiresHumanApproval(makeIntent({ amount: 100 }))).toBe(false);
  });

  it('should require approval above threshold', () => {
    const engine = new PolicyEngine({ requireHumanApprovalAbove: 100 });
    expect(engine.requiresHumanApproval(makeIntent({ amount: 101 }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Combined policy checks
// ---------------------------------------------------------------------------

describe('PolicyEngine — combined policies', () => {
  it('should check all rules and return first violation', () => {
    const engine = new PolicyEngine({
      maxPerTransaction: 100,
      maxDaily: 500,
      blockedRecipients: ['*attacker*'],
    });

    // This violates maxPerTransaction AND blocked recipient
    // maxPerTransaction should be checked first
    const intent = makeIntent({ amount: 200, to: '0xattacker' });
    const verdict = engine.evaluate(intent);
    expect(verdict.allowed).toBe(false);
    expect(verdict.details?.['policy']).toBe('maxPerTransaction');
  });

  it('should pass when all rules are satisfied', () => {
    const engine = new PolicyEngine({
      maxPerTransaction: 100,
      maxDaily: 500,
      allowedRecipients: ['*.verified'],
    });

    const verdict = engine.evaluate(makeIntent({
      amount: 50,
      to: 'good-service.verified',
    }));
    expect(verdict.allowed).toBe(true);
    expect(verdict.reason).toBe('All policy checks passed');
  });
});
