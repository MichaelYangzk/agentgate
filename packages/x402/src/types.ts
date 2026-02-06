// =============================================================================
// x402 Protocol Types
// Types specific to the x402 HTTP payment protocol (Coinbase CDP)
// =============================================================================

/**
 * Configuration for the X402 protocol adapter.
 */
export interface X402Config {
  /** Facilitator URL for payment verification. Defaults to Coinbase CDP facilitator. */
  facilitatorUrl?: string;
  /** Target blockchain network. */
  chain: 'base' | 'ethereum' | 'base-sepolia';
  /** Maximum number of retries for payment requests. Defaults to 3. */
  maxRetries?: number;
  /** Timeout in milliseconds for HTTP requests. Defaults to 30000. */
  timeoutMs?: number;
  /** Wallet signer for signing payment payloads. */
  signer?: WalletSigner;
}

/**
 * Pluggable wallet signer interface.
 * Implement this to provide real crypto signing via viem, ethers, etc.
 */
export interface WalletSigner {
  /** The wallet address (checksummed hex). */
  address: string;
  /** Sign a message and return the hex signature. */
  signMessage(message: string): Promise<string>;
  /** Sign typed data (EIP-712) and return the hex signature. */
  signTypedData?(params: {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<string>;
}

/**
 * Parsed from the base64-encoded PAYMENT-REQUIRED response header.
 * Describes what the server expects to be paid.
 */
export interface X402PaymentRequired {
  /** Amount in the token's smallest unit (e.g., wei for ETH, 6 decimals for USDC). */
  price: string;
  /** Token contract address. */
  token: string;
  /** Recipient address that should receive the payment. */
  recipient: string;
  /** CAIP-2 chain identifier (e.g., "eip155:8453" for Base). */
  chain: string;
  /** Optional facilitator URL for payment verification. */
  facilitator?: string;
  /** Optional: additional fields from the server. */
  extra?: Record<string, unknown>;
}

/**
 * The payment payload constructed by the client and sent to the server.
 * This is base64-encoded and placed in the PAYMENT-SIGNATURE header.
 */
export interface X402PaymentPayload {
  /** Hex-encoded signature over the payload. */
  signature: string;
  /** The structured payment data that was signed. */
  payload: {
    /** Payment scheme identifier (e.g., "exact"). */
    scheme: string;
    /** Network identifier (e.g., "base-sepolia"). */
    network: string;
    /** Amount in the token's smallest unit. */
    amount: string;
    /** Token contract address. */
    token: string;
    /** Recipient address. */
    recipient: string;
    /** Unique nonce to prevent replay attacks. */
    nonce: string;
    /** Unix timestamp (seconds) after which this payment is invalid. */
    validUntil: number;
  };
}

/**
 * The response from a successful x402 payment, parsed from PAYMENT-RESPONSE header.
 */
export interface X402PaymentResponse {
  /** Whether the payment was accepted. */
  success: boolean;
  /** On-chain transaction hash, if settlement occurred. */
  transactionHash?: string;
  /** Network the transaction was settled on. */
  network?: string;
}

/**
 * CAIP-2 chain ID mapping for supported chains.
 */
export const CHAIN_IDS: Record<string, string> = {
  'base': 'eip155:8453',
  'ethereum': 'eip155:1',
  'base-sepolia': 'eip155:84532',
};

/**
 * Default facilitator URL (Coinbase CDP).
 */
export const DEFAULT_FACILITATOR_URL = 'https://x402.org/facilitator';

/**
 * Supported stablecoin symbols for x402 payments.
 */
export const SUPPORTED_CURRENCIES = ['USDC', 'USDT', 'DAI'] as const;
export type SupportedCurrency = typeof SUPPORTED_CURRENCIES[number];
