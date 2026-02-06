// =============================================================================
// X402 Protocol Adapter
// Implements the x402 HTTP payment flow:
//   1. Request resource -> 402 Payment Required
//   2. Parse payment terms from header
//   3. Sign payment payload
//   4. Retry with signed payment
//   5. Return result
// =============================================================================

import type { ProtocolAdapter, PaymentIntent, PaymentResult } from '@agentgate/core';
import type {
  X402Config,
  X402PaymentRequired,
  X402PaymentPayload,
  X402PaymentResponse,
  WalletSigner,
} from './types.js';
import {
  CHAIN_IDS,
  DEFAULT_FACILITATOR_URL,
  SUPPORTED_CURRENCIES,
} from './types.js';

/**
 * X402Adapter implements the ProtocolAdapter interface for the x402 HTTP payment protocol.
 *
 * The x402 protocol works like HTTP 401 but for payments:
 * - Client requests a resource
 * - Server returns 402 with payment terms in PAYMENT-REQUIRED header
 * - Client signs a payment and retries with PAYMENT-SIGNATURE header
 * - Server verifies payment via facilitator and returns the resource
 */
export class X402Adapter implements ProtocolAdapter {
  readonly name = 'x402';

  private readonly config: Required<Pick<X402Config, 'chain' | 'maxRetries' | 'timeoutMs'>> & X402Config;
  private readonly facilitatorUrl: string;
  private readonly signer: WalletSigner | undefined;

  constructor(config: X402Config) {
    this.config = {
      maxRetries: 3,
      timeoutMs: 30_000,
      ...config,
    };
    this.facilitatorUrl = config.facilitatorUrl ?? DEFAULT_FACILITATOR_URL;
    this.signer = config.signer;
  }

  /**
   * Returns true if this adapter can handle the given payment intent.
   *
   * Conditions:
   * - intent.protocol is explicitly 'x402', OR
   * - intent.to is an HTTP(S) URL (x402 is HTTP-native), AND
   * - intent.currency is a supported stablecoin (USDC, USDT, DAI)
   */
  canHandle(intent: PaymentIntent): boolean {
    // Explicit protocol match
    if (intent.protocol === 'x402') {
      return true;
    }

    // Auto-detect: HTTP URL + supported stablecoin
    const isHttpTarget =
      intent.to.startsWith('http://') || intent.to.startsWith('https://');
    const isSupportedCurrency =
      SUPPORTED_CURRENCIES.includes(intent.currency.toUpperCase() as typeof SUPPORTED_CURRENCIES[number]);

    return isHttpTarget && isSupportedCurrency;
  }

  /**
   * Execute the full x402 payment flow.
   */
  async execute(intent: PaymentIntent): Promise<PaymentResult> {
    const startTime = Date.now();

    try {
      // Step 1: Make initial request to the target URL
      const initialResponse = await this.makeRequest(intent.to);

      // If the resource is free (not 402), return success with no payment
      if (initialResponse.status !== 402) {
        return {
          success: true,
          protocol: 'x402',
          amount: 0,
          currency: intent.currency,
          recipient: intent.to,
          timestamp: Date.now(),
          metadata: { note: 'Resource did not require payment', statusCode: initialResponse.status },
        } as PaymentResult;
      }

      // Step 2: Parse the PAYMENT-REQUIRED header
      const paymentRequiredHeader = initialResponse.headers.get('payment-required');
      if (!paymentRequiredHeader) {
        return this.failureResult(
          intent,
          'Server returned 402 but no PAYMENT-REQUIRED header found',
        );
      }

      const paymentRequired = this.parsePaymentRequired(paymentRequiredHeader);

      // Step 3: Validate that we can fulfill the payment
      const validationError = this.validatePaymentTerms(paymentRequired, intent);
      if (validationError) {
        return this.failureResult(intent, validationError);
      }

      // Step 4: Build and sign the payment payload
      const payload = this.buildPayload(paymentRequired, intent);
      const signedPayload = await this.signPayload(payload);

      // Step 5: Retry with signed payment, with retries
      let lastError: string | undefined;
      for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
        try {
          const paymentResponse = await this.makePaymentRequest(
            intent.to,
            signedPayload,
          );

          // Step 6: Parse the response
          if (paymentResponse.status >= 200 && paymentResponse.status < 300) {
            const paymentResult = this.parsePaymentResponse(paymentResponse);
            return {
              success: true,
              transactionId: paymentResult?.transactionHash,
              protocol: 'x402',
              amount: intent.amount,
              currency: intent.currency,
              recipient: paymentRequired.recipient,
              timestamp: Date.now(),
            };
          }

          // If we get another 402, the payment was rejected
          if (paymentResponse.status === 402) {
            lastError = 'Payment was rejected by the server';
            continue;
          }

          // Other error
          lastError = `Server returned ${paymentResponse.status}`;
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
        }

        // Exponential backoff between retries
        if (attempt < this.config.maxRetries - 1) {
          await this.delay(Math.min(1000 * Math.pow(2, attempt), 10_000));
        }
      }

      return this.failureResult(
        intent,
        `Payment failed after ${this.config.maxRetries} attempts: ${lastError}`,
      );
    } catch (err) {
      return this.failureResult(
        intent,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Private: HTTP
  // ---------------------------------------------------------------------------

  /**
   * Make an HTTP request with timeout.
   */
  private async makeRequest(url: string, headers?: Record<string, string>): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      return await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json, */*',
          ...headers,
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Make a payment request with the signed payload in the PAYMENT-SIGNATURE header.
   */
  private async makePaymentRequest(
    url: string,
    signedPayload: X402PaymentPayload,
  ): Promise<Response> {
    const encodedPayload = this.encodePayload(signedPayload);

    return this.makeRequest(url, {
      'Payment-Signature': encodedPayload,
    });
  }

  // ---------------------------------------------------------------------------
  // Private: Parsing
  // ---------------------------------------------------------------------------

  /**
   * Parse the base64-encoded PAYMENT-REQUIRED header.
   * The header contains a JSON object with payment terms.
   */
  parsePaymentRequired(header: string): X402PaymentRequired {
    try {
      const decoded = atob(header);
      const parsed = JSON.parse(decoded);

      if (!parsed.price || !parsed.token || !parsed.recipient || !parsed.chain) {
        throw new Error(
          'PAYMENT-REQUIRED header missing required fields (price, token, recipient, chain)',
        );
      }

      return {
        price: String(parsed.price),
        token: String(parsed.token),
        recipient: String(parsed.recipient),
        chain: String(parsed.chain),
        facilitator: parsed.facilitator ? String(parsed.facilitator) : undefined,
        extra: parsed.extra,
      };
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw new Error(`Failed to parse PAYMENT-REQUIRED header: invalid JSON after base64 decode`);
      }
      throw err;
    }
  }

  /**
   * Parse the PAYMENT-RESPONSE header from a successful payment.
   */
  private parsePaymentResponse(response: Response): X402PaymentResponse | null {
    const header = response.headers.get('payment-response');
    if (!header) {
      return null;
    }

    try {
      const decoded = atob(header);
      const parsed = JSON.parse(decoded);
      return {
        success: Boolean(parsed.success),
        transactionHash: parsed.transactionHash,
        network: parsed.network,
      };
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Payload construction
  // ---------------------------------------------------------------------------

  /**
   * Build the payment payload from the server's requirements and the client's intent.
   */
  buildPayload(
    required: X402PaymentRequired,
    intent: PaymentIntent,
  ): X402PaymentPayload {
    const nonce = this.generateNonce();
    const validUntil = Math.floor(Date.now() / 1000) + 300; // 5 minutes from now

    return {
      signature: '', // Will be filled by signPayload
      payload: {
        scheme: 'exact',
        network: this.resolveNetwork(required.chain),
        amount: required.price,
        token: required.token,
        recipient: required.recipient,
        nonce,
        validUntil,
      },
    };
  }

  /**
   * Sign the payment payload using the configured wallet signer.
   * If no signer is configured, throws an error.
   */
  private async signPayload(payload: X402PaymentPayload): Promise<X402PaymentPayload> {
    if (!this.signer) {
      throw new Error(
        'No wallet signer configured. Provide a WalletSigner in X402Config to sign payments.',
      );
    }

    // Serialize the payload deterministically for signing
    const message = JSON.stringify(payload.payload);
    const signature = await this.signer.signMessage(message);

    return {
      ...payload,
      signature,
    };
  }

  /**
   * Base64-encode a signed payment payload for the PAYMENT-SIGNATURE header.
   */
  private encodePayload(payload: X402PaymentPayload): string {
    return btoa(JSON.stringify(payload));
  }

  // ---------------------------------------------------------------------------
  // Private: Validation
  // ---------------------------------------------------------------------------

  /**
   * Validate that the payment terms are acceptable given the intent.
   * Returns an error message if validation fails, or undefined if OK.
   */
  private validatePaymentTerms(
    required: X402PaymentRequired,
    intent: PaymentIntent,
  ): string | undefined {
    // Validate chain matches
    const expectedChainId = CHAIN_IDS[this.config.chain];
    if (expectedChainId && required.chain !== expectedChainId && required.chain !== this.config.chain) {
      return `Chain mismatch: server requires ${required.chain}, adapter configured for ${this.config.chain} (${expectedChainId})`;
    }

    // Validate the price isn't wildly above the intent amount
    // (basic sanity check — the intent amount is in human units, price is in smallest unit)
    // This is a soft check; real validation would need token decimals
    const priceNum = Number(required.price);
    if (isNaN(priceNum) || priceNum <= 0) {
      return `Invalid price in payment terms: ${required.price}`;
    }

    return undefined;
  }

  // ---------------------------------------------------------------------------
  // Private: Utilities
  // ---------------------------------------------------------------------------

  /**
   * Generate a unique nonce for replay protection.
   */
  private generateNonce(): string {
    // Use crypto.randomUUID if available, otherwise fall back to timestamp + random
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  /**
   * Resolve a CAIP-2 chain ID to a human-readable network name, or vice versa.
   */
  private resolveNetwork(chainId: string): string {
    // If it's already a name, return it
    if (CHAIN_IDS[chainId]) {
      return chainId;
    }

    // Reverse lookup: CAIP-2 -> name
    for (const [name, id] of Object.entries(CHAIN_IDS)) {
      if (id === chainId) {
        return name;
      }
    }

    return chainId;
  }

  /**
   * Create a failure PaymentResult.
   */
  private failureResult(intent: PaymentIntent, error: string): PaymentResult {
    return {
      success: false,
      protocol: 'x402',
      amount: intent.amount,
      currency: intent.currency,
      recipient: intent.to,
      timestamp: Date.now(),
      error,
    };
  }

  /**
   * Async delay helper.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
