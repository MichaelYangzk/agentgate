# AgentGate

**Transaction firewall & protocol abstraction layer for AI agent payments.**

AgentGate sits between AI agents and payment rails (x402, AP2, ACP), providing:
- **Unified SDK** -- one API to pay via any protocol
- **Transaction Firewall** -- prompt injection defense with 4-layer validation
- **Universal Escrow** -- cross-platform agent-to-agent escrow on Base

## Why

7 competing agent payment protocols, none interoperable. Every protocol assumes the agent is trustworthy. AgentGate secures the bridge between intent and execution.

[Read the full whitepaper](https://mkyang.ai/blog/agentgate-whitepaper)

## Packages

| Package | Description |
|---------|-------------|
| `@agentgate/core` | Types, policy engine, main AgentGate class |
| `@agentgate/x402` | x402 protocol adapter (Coinbase) |
| `@agentgate/firewall` | Injection classifier, intent extractor, drift detection |
| `@agentgate/escrow` | Solidity escrow contract + TypeScript client (Base) |

## Quick Start

```typescript
import { AgentGate } from '@agentgate/core';
import { X402Adapter } from '@agentgate/x402';
import { TransactionFirewall } from '@agentgate/firewall';

const gate = new AgentGate({
  wallet: { address: '0x...' },
  policies: {
    maxPerTransaction: 100,
    maxDaily: 1000,
    requireEscrowAbove: 50,
  },
});

gate.use(new X402Adapter({ chain: 'base' }));

const result = await gate.pay({
  to: 'https://api.example.com/data',
  amount: 0.50,
  currency: 'USDC',
  purpose: 'Fetch market data',
});
```

## Architecture

```
Agent LLM generates intent
        |
   [Firewall]
   |-- Injection Classifier (pattern-based, pluggable ML)
   |-- Structured Intent Extraction
   |-- Intent-Origin Diff Check
   |-- Deterministic Policy Engine
        |
   [Router]
   |-- x402 (HTTP APIs, micropayments)
   |-- AP2 (fiat merchants) [planned]
   |-- ACP (checkout flows) [planned]
   |-- Escrow (agent-to-agent jobs)
        |
   Payment Execution
```

## Escrow Contract

Solidity smart contract for Base (EVM):
- Lock USDC with deadline
- Evaluator pattern (AI or human verifies delivery)
- Auto-release after deadline
- Dispute mechanism
- 0.5% fee (50 basis points)

See [`packages/escrow/contracts/AgentGateEscrow.sol`](packages/escrow/contracts/AgentGateEscrow.sol)

## Development

```bash
npm install
npm run build --workspaces
npm run test --workspaces
```

## Status

MVP / early development. Not production-ready.

## License

MIT
