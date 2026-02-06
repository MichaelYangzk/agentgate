export const AGENT_GATE_ESCROW_ABI = [
  // Constructor
  {
    type: 'constructor',
    inputs: [
      { name: '_feeRecipient', type: 'address', internalType: 'address' },
    ],
    stateMutability: 'nonpayable',
  },

  // ─── Read Functions ────────────────────────────────────────────────────────

  {
    type: 'function',
    name: 'escrowCount',
    inputs: [],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'feeRate',
    inputs: [],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'feeRecipient',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'owner',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'escrows',
    inputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    outputs: [
      { name: 'buyer', type: 'address', internalType: 'address' },
      { name: 'seller', type: 'address', internalType: 'address' },
      { name: 'evaluator', type: 'address', internalType: 'address' },
      { name: 'token', type: 'address', internalType: 'address' },
      { name: 'amount', type: 'uint256', internalType: 'uint256' },
      { name: 'deadline', type: 'uint256', internalType: 'uint256' },
      { name: 'status', type: 'uint8', internalType: 'enum AgentGateEscrow.EscrowStatus' },
      { name: 'purposeHash', type: 'string', internalType: 'string' },
      { name: 'createdAt', type: 'uint256', internalType: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getEscrow',
    inputs: [{ name: 'id', type: 'uint256', internalType: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct AgentGateEscrow.Escrow',
        components: [
          { name: 'buyer', type: 'address', internalType: 'address' },
          { name: 'seller', type: 'address', internalType: 'address' },
          { name: 'evaluator', type: 'address', internalType: 'address' },
          { name: 'token', type: 'address', internalType: 'address' },
          { name: 'amount', type: 'uint256', internalType: 'uint256' },
          { name: 'deadline', type: 'uint256', internalType: 'uint256' },
          { name: 'status', type: 'uint8', internalType: 'enum AgentGateEscrow.EscrowStatus' },
          { name: 'purposeHash', type: 'string', internalType: 'string' },
          { name: 'createdAt', type: 'uint256', internalType: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },

  // ─── Write Functions ───────────────────────────────────────────────────────

  {
    type: 'function',
    name: 'createEscrow',
    inputs: [
      { name: 'seller', type: 'address', internalType: 'address' },
      { name: 'evaluator', type: 'address', internalType: 'address' },
      { name: 'token', type: 'address', internalType: 'address' },
      { name: 'amount', type: 'uint256', internalType: 'uint256' },
      { name: 'deadline', type: 'uint256', internalType: 'uint256' },
      { name: 'purposeHash', type: 'string', internalType: 'string' },
    ],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'release',
    inputs: [{ name: 'id', type: 'uint256', internalType: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'evaluatorApprove',
    inputs: [
      { name: 'id', type: 'uint256', internalType: 'uint256' },
      { name: 'reason', type: 'string', internalType: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'evaluatorReject',
    inputs: [
      { name: 'id', type: 'uint256', internalType: 'uint256' },
      { name: 'reason', type: 'string', internalType: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'dispute',
    inputs: [{ name: 'id', type: 'uint256', internalType: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'releaseAfterDeadline',
    inputs: [{ name: 'id', type: 'uint256', internalType: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'refundAfterDeadline',
    inputs: [{ name: 'id', type: 'uint256', internalType: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setFeeRate',
    inputs: [{ name: '_feeRate', type: 'uint256', internalType: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },

  // ─── Events ────────────────────────────────────────────────────────────────

  {
    type: 'event',
    name: 'EscrowCreated',
    inputs: [
      { name: 'id', type: 'uint256', indexed: true, internalType: 'uint256' },
      { name: 'buyer', type: 'address', indexed: false, internalType: 'address' },
      { name: 'seller', type: 'address', indexed: false, internalType: 'address' },
      { name: 'amount', type: 'uint256', indexed: false, internalType: 'uint256' },
      { name: 'token', type: 'address', indexed: false, internalType: 'address' },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'EscrowCompleted',
    inputs: [
      { name: 'id', type: 'uint256', indexed: true, internalType: 'uint256' },
      { name: 'releasedBy', type: 'address', indexed: false, internalType: 'address' },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'EscrowDisputed',
    inputs: [
      { name: 'id', type: 'uint256', indexed: true, internalType: 'uint256' },
      { name: 'disputedBy', type: 'address', indexed: false, internalType: 'address' },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'EscrowRefunded',
    inputs: [
      { name: 'id', type: 'uint256', indexed: true, internalType: 'uint256' },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'EscrowExpired',
    inputs: [
      { name: 'id', type: 'uint256', indexed: true, internalType: 'uint256' },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'EvaluatorVerdict',
    inputs: [
      { name: 'id', type: 'uint256', indexed: true, internalType: 'uint256' },
      { name: 'approved', type: 'bool', indexed: false, internalType: 'bool' },
      { name: 'reason', type: 'string', indexed: false, internalType: 'string' },
    ],
    anonymous: false,
  },
] as const;
