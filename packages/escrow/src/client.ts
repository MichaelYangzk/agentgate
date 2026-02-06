import type {
  PublicClient,
  WalletClient,
  Address,
  TransactionReceipt,
} from 'viem';
import { decodeEventLog } from 'viem';
import { AGENT_GATE_ESCROW_ABI } from './abi.js';
import type { EscrowParams, EscrowInfo, EscrowClientConfig } from './types.js';
import { EscrowStatus } from './types.js';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

/**
 * Default RPC endpoints per chain.
 */
const DEFAULT_RPC: Record<string, string> = {
  base: 'https://mainnet.base.org',
  'base-sepolia': 'https://sepolia.base.org',
};

/**
 * EscrowClient — TypeScript wrapper for the AgentGateEscrow contract.
 * Uses viem's WalletClient (write) and PublicClient (read).
 */
export class EscrowClient {
  private config: EscrowClientConfig;

  constructor(config: EscrowClientConfig) {
    this.config = {
      ...config,
      rpcUrl: config.rpcUrl ?? DEFAULT_RPC[config.chain],
    };
  }

  get contractAddress(): Address {
    return this.config.contractAddress as Address;
  }

  /**
   * Create a new escrow — buyer locks tokens into the contract.
   * Caller must have approved the contract to spend `params.amount` of `params.token` first.
   */
  async create(
    params: EscrowParams,
    walletClient: WalletClient,
    publicClient: PublicClient,
  ): Promise<{ escrowId: number; txHash: string }> {
    const evaluator = (params.evaluator ?? ZERO_ADDRESS) as Address;

    // viem's WriteContractParameters has deep generic constraints around chain/account;
    // we assert through `any` to keep the external API simple.
    const hash = await walletClient.writeContract({
      address: this.contractAddress,
      abi: AGENT_GATE_ESCROW_ABI,
      functionName: 'createEscrow',
      args: [
        params.seller as Address,
        evaluator,
        params.token as Address,
        params.amount,
        BigInt(params.deadline),
        params.purposeHash,
      ],
      chain: null,
      account: walletClient.account!,
    } as any);

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const escrowId = this.extractEscrowId(receipt);

    return { escrowId, txHash: hash };
  }

  /**
   * Release funds to seller (buyer only).
   */
  async release(
    escrowId: number,
    walletClient: WalletClient,
    publicClient: PublicClient,
  ): Promise<{ txHash: string }> {
    const hash = await walletClient.writeContract({
      address: this.contractAddress,
      abi: AGENT_GATE_ESCROW_ABI,
      functionName: 'release',
      args: [BigInt(escrowId)],
      chain: null,
      account: walletClient.account!,
    } as any);

    await publicClient.waitForTransactionReceipt({ hash });
    return { txHash: hash };
  }

  /**
   * Evaluator approves delivery — releases funds to seller.
   */
  async evaluatorApprove(
    escrowId: number,
    reason: string,
    walletClient: WalletClient,
    publicClient: PublicClient,
  ): Promise<{ txHash: string }> {
    const hash = await walletClient.writeContract({
      address: this.contractAddress,
      abi: AGENT_GATE_ESCROW_ABI,
      functionName: 'evaluatorApprove',
      args: [BigInt(escrowId), reason],
      chain: null,
      account: walletClient.account!,
    } as any);

    await publicClient.waitForTransactionReceipt({ hash });
    return { txHash: hash };
  }

  /**
   * Evaluator rejects delivery — refunds buyer.
   */
  async evaluatorReject(
    escrowId: number,
    reason: string,
    walletClient: WalletClient,
    publicClient: PublicClient,
  ): Promise<{ txHash: string }> {
    const hash = await walletClient.writeContract({
      address: this.contractAddress,
      abi: AGENT_GATE_ESCROW_ABI,
      functionName: 'evaluatorReject',
      args: [BigInt(escrowId), reason],
      chain: null,
      account: walletClient.account!,
    } as any);

    await publicClient.waitForTransactionReceipt({ hash });
    return { txHash: hash };
  }

  /**
   * Dispute an active escrow (buyer or seller).
   */
  async dispute(
    escrowId: number,
    walletClient: WalletClient,
    publicClient: PublicClient,
  ): Promise<{ txHash: string }> {
    const hash = await walletClient.writeContract({
      address: this.contractAddress,
      abi: AGENT_GATE_ESCROW_ABI,
      functionName: 'dispute',
      args: [BigInt(escrowId)],
      chain: null,
      account: walletClient.account!,
    } as any);

    await publicClient.waitForTransactionReceipt({ hash });
    return { txHash: hash };
  }

  /**
   * Release funds after deadline — anyone can call if no evaluator is set.
   */
  async releaseAfterDeadline(
    escrowId: number,
    walletClient: WalletClient,
    publicClient: PublicClient,
  ): Promise<{ txHash: string }> {
    const hash = await walletClient.writeContract({
      address: this.contractAddress,
      abi: AGENT_GATE_ESCROW_ABI,
      functionName: 'releaseAfterDeadline',
      args: [BigInt(escrowId)],
      chain: null,
      account: walletClient.account!,
    } as any);

    await publicClient.waitForTransactionReceipt({ hash });
    return { txHash: hash };
  }

  /**
   * Refund after deadline — buyer only, when deadline has passed.
   */
  async refundAfterDeadline(
    escrowId: number,
    walletClient: WalletClient,
    publicClient: PublicClient,
  ): Promise<{ txHash: string }> {
    const hash = await walletClient.writeContract({
      address: this.contractAddress,
      abi: AGENT_GATE_ESCROW_ABI,
      functionName: 'refundAfterDeadline',
      args: [BigInt(escrowId)],
      chain: null,
      account: walletClient.account!,
    } as any);

    await publicClient.waitForTransactionReceipt({ hash });
    return { txHash: hash };
  }

  /**
   * Get escrow info by ID (read-only).
   */
  async getEscrow(
    escrowId: number,
    publicClient: PublicClient,
  ): Promise<EscrowInfo> {
    const result = await publicClient.readContract({
      address: this.contractAddress,
      abi: AGENT_GATE_ESCROW_ABI,
      functionName: 'getEscrow',
      args: [BigInt(escrowId)],
    });

    // viem returns a tuple matching the struct fields
    const data = result as {
      buyer: Address;
      seller: Address;
      evaluator: Address;
      token: Address;
      amount: bigint;
      deadline: bigint;
      status: number;
      purposeHash: string;
      createdAt: bigint;
    };

    return {
      id: escrowId,
      buyer: data.buyer,
      seller: data.seller,
      evaluator: data.evaluator,
      token: data.token,
      amount: data.amount,
      deadline: Number(data.deadline),
      status: data.status as EscrowStatus,
      purposeHash: data.purposeHash,
      createdAt: Number(data.createdAt),
    };
  }

  /**
   * Get the total escrow count (read-only).
   */
  async getEscrowCount(publicClient: PublicClient): Promise<number> {
    const count = await publicClient.readContract({
      address: this.contractAddress,
      abi: AGENT_GATE_ESCROW_ABI,
      functionName: 'escrowCount',
    });
    return Number(count);
  }

  /**
   * Extract the escrow ID from the EscrowCreated event in a transaction receipt.
   */
  private extractEscrowId(receipt: TransactionReceipt): number {
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: AGENT_GATE_ESCROW_ABI,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === 'EscrowCreated') {
          const args = decoded.args as { id: bigint };
          return Number(args.id);
        }
      } catch {
        // Not an event from our contract, skip
        continue;
      }
    }
    throw new Error('EscrowCreated event not found in transaction receipt');
  }
}
