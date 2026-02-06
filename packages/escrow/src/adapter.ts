import type { ProtocolAdapter, PaymentIntent, PaymentResult } from '@agentgate/core';
import type { PublicClient, WalletClient } from 'viem';
import { EscrowClient } from './client.js';
import type { EscrowClientConfig, EscrowParams } from './types.js';
import { TOKENS } from './types.js';

/**
 * Parse a deadline string (e.g. '24h', '7d', ISO timestamp) into a unix timestamp.
 */
function parseDeadline(deadline: string): number {
  // Try ISO date first
  const asDate = Date.parse(deadline);
  if (!isNaN(asDate)) {
    return Math.floor(asDate / 1000);
  }

  // Parse duration strings like '24h', '7d', '30m'
  const match = deadline.match(/^(\d+)\s*(m|h|d|w)$/i);
  if (!match) {
    throw new Error(`Invalid deadline format: ${deadline}. Use ISO date or duration like '24h', '7d'.`);
  }

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const now = Math.floor(Date.now() / 1000);

  const multipliers: Record<string, number> = {
    m: 60,
    h: 3600,
    d: 86400,
    w: 604800,
  };

  return now + value * multipliers[unit];
}

/**
 * Resolve a currency string to a token address for the given chain.
 */
function resolveTokenAddress(currency: string, chain: 'base' | 'base-sepolia'): string {
  const upper = currency.toUpperCase();
  if (upper === 'USDC') {
    return chain === 'base' ? TOKENS.USDC_BASE : TOKENS.USDC_BASE_SEPOLIA;
  }
  // If it looks like an address, return as-is
  if (currency.startsWith('0x') && currency.length === 42) {
    return currency;
  }
  throw new Error(`Unsupported currency for escrow: ${currency}. Use 'USDC' or a token address.`);
}

/**
 * EscrowAdapter — implements ProtocolAdapter for the AgentGate escrow flow.
 * Bridges PaymentIntent from @agentgate/core to the on-chain EscrowClient.
 */
export class EscrowAdapter implements ProtocolAdapter {
  name = 'escrow';

  private client: EscrowClient;
  private config: EscrowClientConfig;
  private walletClient: WalletClient;
  private publicClient: PublicClient;

  constructor(
    config: EscrowClientConfig,
    walletClient: WalletClient,
    publicClient: PublicClient,
  ) {
    this.config = config;
    this.client = new EscrowClient(config);
    this.walletClient = walletClient;
    this.publicClient = publicClient;
  }

  /**
   * Returns true if this adapter can handle the given payment intent.
   */
  canHandle(intent: PaymentIntent): boolean {
    return intent.protocol === 'escrow' || !!intent.escrow;
  }

  /**
   * Execute a payment intent by creating an on-chain escrow.
   */
  async execute(intent: PaymentIntent): Promise<PaymentResult> {
    try {
      const escrowConfig = intent.escrow;
      if (!escrowConfig) {
        throw new Error('PaymentIntent is missing escrow configuration');
      }

      const deadline = parseDeadline(escrowConfig.deadline);
      const token = resolveTokenAddress(intent.currency, this.config.chain);

      // Convert amount to token decimals (USDC = 6 decimals)
      const decimals = intent.currency.toUpperCase() === 'USDC' ? 6 : 18;
      const amount = BigInt(Math.round(intent.amount * 10 ** decimals));

      const params: EscrowParams = {
        seller: intent.to,
        evaluator: escrowConfig.evaluator !== 'auto' ? escrowConfig.evaluator : undefined,
        token,
        amount,
        deadline,
        purposeHash: intent.purpose,
      };

      const { escrowId, txHash } = await this.client.create(
        params,
        this.walletClient,
        this.publicClient,
      );

      return {
        success: true,
        transactionId: txHash,
        protocol: 'escrow',
        amount: intent.amount,
        currency: intent.currency,
        recipient: intent.to,
        timestamp: Date.now(),
        escrowId: String(escrowId),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        protocol: 'escrow',
        amount: intent.amount,
        currency: intent.currency,
        recipient: intent.to,
        timestamp: Date.now(),
        error: message,
      };
    }
  }
}
