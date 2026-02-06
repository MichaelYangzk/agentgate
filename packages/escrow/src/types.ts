export interface EscrowParams {
  seller: string;            // seller address
  evaluator?: string;        // evaluator address (optional)
  token: string;             // ERC20 token address
  amount: bigint;
  deadline: number;          // unix timestamp
  purposeHash: string;       // IPFS hash or description
}

export interface EscrowInfo {
  id: number;
  buyer: string;
  seller: string;
  evaluator: string;
  token: string;
  amount: bigint;
  deadline: number;
  status: EscrowStatus;
  purposeHash: string;
  createdAt: number;
}

export enum EscrowStatus {
  Active = 0,
  Completed = 1,
  Disputed = 2,
  Refunded = 3,
  Expired = 4,
}

export interface EscrowClientConfig {
  contractAddress: string;
  chain: 'base' | 'base-sepolia';
  rpcUrl?: string;
}

// Well-known token addresses
export const TOKENS = {
  USDC_BASE: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  USDC_BASE_SEPOLIA: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
} as const;
