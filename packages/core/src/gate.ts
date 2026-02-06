// =============================================================================
// AgentGate — Main entry point
// Validate -> Firewall -> Policy -> Route -> Execute -> Record
// =============================================================================

import {
  AgentGateConfig,
  PaymentIntent,
  PaymentResult,
  ProtocolAdapter,
  FirewallVerdict,
} from './types.js';
import { PolicyEngine } from './policy.js';
import {
  PolicyViolationError,
  FirewallBlockedError,
  NoAdapterError,
  PaymentFailedError,
} from './errors.js';

export class AgentGate {
  private config: AgentGateConfig;
  private policy: PolicyEngine;
  private adapters: ProtocolAdapter[];

  constructor(config: AgentGateConfig) {
    this.config = config;
    this.policy = new PolicyEngine(config.policies);
    this.adapters = config.adapters ? [...config.adapters] : [];
  }

  /**
   * Register a protocol adapter.
   * Adapters are tried in registration order.
   */
  use(adapter: ProtocolAdapter): void {
    this.adapters.push(adapter);
    this.log('info', `Registered adapter: ${adapter.name}`);
  }

  /**
   * Main entry point — validate + route + execute a payment.
   *
   * Pipeline:
   * 1. Generate ID and timestamp
   * 2. Run firewall check (if configured)
   * 3. Run policy engine check
   * 4. Check human approval threshold
   * 5. Auto-detect protocol if not specified
   * 6. Find matching adapter
   * 7. Execute via adapter
   * 8. Record transaction in policy engine
   * 9. Return result
   */
  async pay(
    input: Omit<PaymentIntent, 'id' | 'timestamp'>
  ): Promise<PaymentResult> {
    // Step 1: Build full intent
    const intent: PaymentIntent = {
      ...input,
      id: this.generateId(),
      timestamp: Date.now(),
    };

    this.log('info', `Processing payment ${intent.id}`, {
      to: intent.to,
      amount: intent.amount,
      currency: intent.currency,
    });

    // Step 2: Firewall check (AI-powered, if configured)
    if (this.config.firewall?.enabled) {
      const firewallVerdict = await this.runFirewall(intent);
      if (!firewallVerdict.allowed) {
        this.log('warn', `Firewall blocked payment ${intent.id}`, firewallVerdict);
        throw new FirewallBlockedError(
          firewallVerdict.reason ?? 'Blocked by firewall',
          firewallVerdict.layer,
          firewallVerdict.confidence
        );
      }
    }

    // Step 3: Policy engine check (deterministic, non-bypassable)
    const policyVerdict = this.policy.evaluate(intent);
    if (!policyVerdict.allowed) {
      this.log('warn', `Policy blocked payment ${intent.id}`, policyVerdict);
      throw new PolicyViolationError(
        policyVerdict.reason ?? 'Blocked by policy',
        (policyVerdict.details?.['policy'] as string) ?? 'unknown',
        policyVerdict.details?.['value'],
        policyVerdict.details?.['limit']
      );
    }

    // Step 4: Human approval check
    if (this.policy.requiresHumanApproval(intent)) {
      if (!this.config.onHumanApproval) {
        throw new FirewallBlockedError(
          `Amount $${intent.amount} requires human approval, but no approval handler is configured`,
          'human'
        );
      }

      this.log('info', `Requesting human approval for payment ${intent.id}`);
      const approved = await this.config.onHumanApproval(intent);
      if (!approved) {
        this.log('warn', `Human rejected payment ${intent.id}`);
        throw new FirewallBlockedError(
          'Payment rejected by human approver',
          'human'
        );
      }
      this.log('info', `Human approved payment ${intent.id}`);
    }

    // Step 5: Auto-detect protocol if not specified
    if (!intent.protocol) {
      intent.protocol = this.detectProtocol(intent) as PaymentIntent['protocol'];
      this.log('info', `Auto-detected protocol: ${intent.protocol}`);
    }

    // Step 6: Find matching adapter
    const adapter = this.findAdapter(intent.protocol!);
    if (!adapter) {
      throw new NoAdapterError(intent.protocol!);
    }

    // Step 7: Execute via adapter
    let result: PaymentResult;
    try {
      result = await adapter.execute(intent);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new PaymentFailedError(
        `Payment execution failed: ${message}`,
        intent.protocol!,
        undefined,
        err
      );
    }

    // Step 8: Record transaction (only on success)
    if (result.success) {
      this.policy.recordTransaction(intent);
      this.log('info', `Payment ${intent.id} completed`, {
        transactionId: result.transactionId,
        protocol: result.protocol,
      });
    } else {
      this.log('warn', `Payment ${intent.id} failed at protocol level`, {
        error: result.error,
      });
    }

    // Step 9: Return result
    return result;
  }

  /**
   * Check an intent without executing — dry run.
   * Runs firewall + policy checks but does not execute or record.
   */
  async check(
    input: Omit<PaymentIntent, 'id' | 'timestamp'>
  ): Promise<FirewallVerdict> {
    const intent: PaymentIntent = {
      ...input,
      id: this.generateId(),
      timestamp: Date.now(),
    };

    // Firewall check
    if (this.config.firewall?.enabled) {
      const firewallVerdict = await this.runFirewall(intent);
      if (!firewallVerdict.allowed) {
        return firewallVerdict;
      }
    }

    // Policy check
    const policyVerdict = this.policy.evaluate(intent);
    if (!policyVerdict.allowed) {
      return policyVerdict;
    }

    // Check if human approval would be needed
    if (this.policy.requiresHumanApproval(intent)) {
      return {
        allowed: true,
        layer: 'human',
        reason: 'Payment allowed but requires human approval before execution',
        details: { requiresHumanApproval: true },
      };
    }

    // Check if adapter exists
    const protocol = intent.protocol ?? this.detectProtocol(intent);
    const adapter = this.findAdapter(protocol);
    if (!adapter) {
      return {
        allowed: false,
        layer: 'policy',
        reason: `No adapter registered for protocol "${protocol}"`,
        details: { protocol, registeredAdapters: this.adapters.map((a) => a.name) },
      };
    }

    return {
      allowed: true,
      layer: 'policy',
      reason: 'All checks passed',
      details: { protocol, adapter: adapter.name },
    };
  }

  // ---------------------------------------------------------------------------
  // Protocol detection
  // ---------------------------------------------------------------------------

  private detectProtocol(intent: PaymentIntent): string {
    // Escrow config present -> escrow protocol
    if (intent.escrow) {
      return 'escrow';
    }

    // HTTP URLs -> x402 (HTTP 402 Payment Required protocol)
    if (intent.to.startsWith('http://') || intent.to.startsWith('https://')) {
      return 'x402';
    }

    // Merchant-like patterns -> ACP (Agent Commerce Protocol)
    const merchantPatterns = [
      /^merchant:/i,
      /^shop:/i,
      /^store:/i,
      /\.merchant$/i,
      /\.shop$/i,
    ];
    if (merchantPatterns.some((p) => p.test(intent.to))) {
      return 'acp';
    }

    // Agent URI patterns -> AP2 (Agent-to-Agent Payment Protocol)
    if (intent.to.startsWith('agent://') || intent.to.startsWith('did:')) {
      return 'ap2';
    }

    // Default -> x402
    return 'x402';
  }

  // ---------------------------------------------------------------------------
  // Adapter lookup
  // ---------------------------------------------------------------------------

  private findAdapter(protocol: string): ProtocolAdapter | undefined {
    // First, try to find an adapter whose name matches the protocol
    const byName = this.adapters.find(
      (a) => a.name.toLowerCase() === protocol.toLowerCase()
    );
    if (byName) return byName;

    // Then, try canHandle on each adapter with a dummy intent
    // (adapters may support multiple protocols)
    return undefined;
  }

  // ---------------------------------------------------------------------------
  // Firewall (placeholder — actual AI layer lives in @agentgate/firewall)
  // ---------------------------------------------------------------------------

  private async runFirewall(intent: PaymentIntent): Promise<FirewallVerdict> {
    // If a classifier endpoint is configured, call it
    if (this.config.firewall?.classifierEndpoint) {
      try {
        const response = await fetch(this.config.firewall.classifierEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(intent),
        });

        if (!response.ok) {
          this.log('warn', `Firewall classifier returned ${response.status}, allowing by default`);
          return { allowed: true, layer: 'classifier', reason: 'Classifier unavailable, allowing' };
        }

        const result = (await response.json()) as FirewallVerdict;
        return { ...result, layer: 'classifier' };
      } catch (err) {
        this.log('warn', `Firewall classifier error: ${err}, allowing by default`);
        return { allowed: true, layer: 'classifier', reason: 'Classifier error, allowing' };
      }
    }

    // No classifier configured — pass through
    return { allowed: true, layer: 'classifier', reason: 'No classifier configured' };
  }

  // ---------------------------------------------------------------------------
  // ID generation
  // ---------------------------------------------------------------------------

  private generateId(): string {
    // Format: ag_<timestamp_hex>_<random>
    const timestamp = Date.now().toString(16);
    const random = Math.random().toString(36).substring(2, 10);
    return `ag_${timestamp}_${random}`;
  }

  // ---------------------------------------------------------------------------
  // Logging
  // ---------------------------------------------------------------------------

  private log(level: 'info' | 'warn' | 'error', msg: string, data?: unknown): void {
    if (this.config.logger) {
      this.config.logger[level](`[AgentGate] ${msg}`, data);
    }
  }
}
