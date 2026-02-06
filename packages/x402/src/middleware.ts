// =============================================================================
// x402 Paywall Middleware
// Express/Next.js middleware for RECEIVING x402 payments on your API routes.
//
// Usage:
//   app.get('/premium-data', x402Paywall({
//     price: 0.01,
//     currency: 'USDC',
//     recipient: '0x...',
//   }), (req, res) => { res.json({ data: 'premium' }) });
// =============================================================================

import {
  CHAIN_IDS,
  DEFAULT_FACILITATOR_URL,
  SUPPORTED_CURRENCIES,
} from './types.js';
import type { X402PaymentPayload, X402PaymentResponse } from './types.js';

/**
 * Options for the x402 paywall middleware.
 */
export interface X402PaywallOptions {
  /** Price in human-readable units (e.g., 0.01 for 1 cent USDC). */
  price: number;
  /** Currency symbol. Defaults to 'USDC'. */
  currency?: string;
  /** Recipient wallet address that should receive the payment. */
  recipient: string;
  /** Token contract address. If not provided, inferred from currency + chain. */
  tokenAddress?: string;
  /** Blockchain to accept payment on. Defaults to 'base'. */
  chain?: 'base' | 'ethereum' | 'base-sepolia';
  /** Facilitator URL for verifying payments. */
  facilitatorUrl?: string;
  /** Custom verification function. If provided, overrides facilitator verification. */
  verifyPayment?: (payload: X402PaymentPayload) => Promise<boolean>;
  /** Timeout in ms for facilitator verification. Defaults to 10000. */
  verifyTimeoutMs?: number;
}

/**
 * Minimal request interface (compatible with Express, Koa, Next.js, etc.).
 */
interface MiddlewareRequest {
  headers: Record<string, string | string[] | undefined> | {
    get?(name: string): string | undefined;
  };
}

/**
 * Minimal response interface (compatible with Express, Next.js, etc.).
 */
interface MiddlewareResponse {
  status?(code: number): MiddlewareResponse;
  statusCode?: number;
  setHeader?(name: string, value: string): void;
  set?(name: string, value: string): void;
  json?(body: unknown): void;
  end?(body?: string): void;
}

/**
 * Well-known USDC contract addresses by chain.
 */
const USDC_ADDRESSES: Record<string, string> = {
  'base': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  'ethereum': '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  'base-sepolia': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
};

/**
 * Get the header value from a request, handling different frameworks.
 */
function getHeader(req: MiddlewareRequest, name: string): string | undefined {
  const lowerName = name.toLowerCase();

  // Express-style: req.headers is a plain object
  if (req.headers && typeof req.headers === 'object') {
    // Check for .get() method (Node IncomingMessage, Fetch Headers)
    if ('get' in req.headers && typeof req.headers.get === 'function') {
      return req.headers.get(lowerName) ?? undefined;
    }

    // Plain object (Express)
    const headers = req.headers as Record<string, string | string[] | undefined>;
    const value = headers[lowerName] ?? headers[name];
    if (Array.isArray(value)) {
      return value[0];
    }
    return value ?? undefined;
  }

  return undefined;
}

/**
 * Set a header and status on a response, handling different frameworks.
 */
function setResponseHeader(res: MiddlewareResponse, name: string, value: string): void {
  if (typeof res.setHeader === 'function') {
    res.setHeader(name, value);
  } else if (typeof res.set === 'function') {
    res.set(name, value);
  }
}

function setStatus(res: MiddlewareResponse, code: number): void {
  if (typeof res.status === 'function') {
    res.status(code);
  } else {
    res.statusCode = code;
  }
}

function sendJson(res: MiddlewareResponse, body: unknown): void {
  if (typeof res.json === 'function') {
    res.json(body);
  } else if (typeof res.end === 'function') {
    setResponseHeader(res, 'Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  }
}

/**
 * Convert a human-readable price to the token's smallest unit.
 * USDC/USDT have 6 decimals, DAI has 18.
 */
function toSmallestUnit(price: number, currency: string): string {
  const decimals = currency.toUpperCase() === 'DAI' ? 18 : 6;
  // Use string math to avoid floating point issues
  const factor = BigInt(10) ** BigInt(decimals);
  // Multiply with sufficient precision
  const amount = BigInt(Math.round(price * Number(factor)));
  return amount.toString();
}

/**
 * Creates Express/Next.js middleware that implements an x402 paywall.
 *
 * When a request comes in without a PAYMENT-SIGNATURE header, the middleware
 * responds with 402 and a PAYMENT-REQUIRED header describing the price.
 *
 * When a request includes a valid PAYMENT-SIGNATURE header, the middleware
 * verifies the payment via the facilitator and, if valid, calls next().
 */
export function x402Paywall(options: X402PaywallOptions) {
  const {
    price,
    currency = 'USDC',
    recipient,
    chain = 'base',
    facilitatorUrl = DEFAULT_FACILITATOR_URL,
    verifyPayment: customVerify,
    verifyTimeoutMs = 10_000,
  } = options;

  const tokenAddress = options.tokenAddress ?? USDC_ADDRESSES[chain] ?? '';
  const chainId = CHAIN_IDS[chain] ?? chain;
  const priceSmallest = toSmallestUnit(price, currency);

  // Pre-compute the PAYMENT-REQUIRED header value
  const paymentRequiredData = {
    price: priceSmallest,
    token: tokenAddress,
    recipient,
    chain: chainId,
    facilitator: facilitatorUrl,
  };
  const paymentRequiredHeader = btoa(JSON.stringify(paymentRequiredData));

  return async function x402PaywallMiddleware(
    req: MiddlewareRequest,
    res: MiddlewareResponse,
    next: () => void,
  ): Promise<void> {
    // Check for existing payment signature
    const paymentSignature = getHeader(req, 'Payment-Signature');

    if (!paymentSignature) {
      // No payment provided — return 402 with payment terms
      setStatus(res, 402);
      setResponseHeader(res, 'Payment-Required', paymentRequiredHeader);
      setResponseHeader(res, 'Content-Type', 'application/json');
      sendJson(res, {
        error: 'Payment Required',
        message: `This resource costs ${price} ${currency}`,
        paymentRequired: paymentRequiredData,
      });
      return;
    }

    // Payment signature present — verify it
    try {
      const payload = parsePaymentSignature(paymentSignature);

      // Validate basic fields match our requirements
      const validationError = validatePayload(payload, {
        expectedAmount: priceSmallest,
        expectedToken: tokenAddress,
        expectedRecipient: recipient,
      });

      if (validationError) {
        setStatus(res, 402);
        setResponseHeader(res, 'Payment-Required', paymentRequiredHeader);
        sendJson(res, {
          error: 'Payment Invalid',
          message: validationError,
        });
        return;
      }

      // Check expiration
      if (payload.payload.validUntil < Math.floor(Date.now() / 1000)) {
        setStatus(res, 402);
        setResponseHeader(res, 'Payment-Required', paymentRequiredHeader);
        sendJson(res, {
          error: 'Payment Expired',
          message: 'The payment signature has expired. Please submit a new payment.',
        });
        return;
      }

      // Verify via custom function or facilitator
      let verified = false;
      if (customVerify) {
        verified = await customVerify(payload);
      } else {
        verified = await verifyViaFacilitator(
          facilitatorUrl,
          payload,
          verifyTimeoutMs,
        );
      }

      if (!verified) {
        setStatus(res, 402);
        setResponseHeader(res, 'Payment-Required', paymentRequiredHeader);
        sendJson(res, {
          error: 'Payment Rejected',
          message: 'Payment verification failed.',
        });
        return;
      }

      // Payment verified — build success response header
      const paymentResponse: X402PaymentResponse = {
        success: true,
        network: chain,
      };
      setResponseHeader(
        res,
        'Payment-Response',
        btoa(JSON.stringify(paymentResponse)),
      );

      // Continue to the actual route handler
      next();
    } catch (err) {
      setStatus(res, 400);
      sendJson(res, {
        error: 'Bad Request',
        message: `Invalid PAYMENT-SIGNATURE header: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse the base64-encoded PAYMENT-SIGNATURE header.
 */
function parsePaymentSignature(header: string): X402PaymentPayload {
  const decoded = atob(header);
  const parsed = JSON.parse(decoded);

  if (!parsed.signature || !parsed.payload) {
    throw new Error('Missing required fields: signature, payload');
  }

  const p = parsed.payload;
  if (!p.scheme || !p.amount || !p.token || !p.recipient || !p.nonce || !p.validUntil) {
    throw new Error('Payload missing required fields');
  }

  return {
    signature: String(parsed.signature),
    payload: {
      scheme: String(p.scheme),
      network: String(p.network ?? ''),
      amount: String(p.amount),
      token: String(p.token),
      recipient: String(p.recipient),
      nonce: String(p.nonce),
      validUntil: Number(p.validUntil),
    },
  };
}

/**
 * Validate that the payload fields match the server's requirements.
 */
function validatePayload(
  payload: X402PaymentPayload,
  expected: {
    expectedAmount: string;
    expectedToken: string;
    expectedRecipient: string;
  },
): string | undefined {
  if (payload.payload.amount !== expected.expectedAmount) {
    return `Amount mismatch: expected ${expected.expectedAmount}, got ${payload.payload.amount}`;
  }

  // Case-insensitive address comparison
  if (payload.payload.token.toLowerCase() !== expected.expectedToken.toLowerCase()) {
    return `Token mismatch: expected ${expected.expectedToken}, got ${payload.payload.token}`;
  }

  if (payload.payload.recipient.toLowerCase() !== expected.expectedRecipient.toLowerCase()) {
    return `Recipient mismatch: expected ${expected.expectedRecipient}, got ${payload.payload.recipient}`;
  }

  return undefined;
}

/**
 * Verify a payment via the facilitator service.
 */
async function verifyViaFacilitator(
  facilitatorUrl: string,
  payload: X402PaymentPayload,
  timeoutMs: number,
): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${facilitatorUrl}/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      return false;
    }

    const result = await response.json() as { valid?: boolean };
    return result.valid === true;
  } catch {
    // Network errors, timeouts, etc. — fail closed (reject payment)
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}
