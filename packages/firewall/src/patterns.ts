// =============================================================================
// @agentgate/firewall — Built-in Injection Detection Patterns
// Known prompt injection patterns for financial transactions
// =============================================================================

import type { PatternRule } from './types.js';

export const FINANCIAL_INJECTION_PATTERNS: PatternRule[] = [
  // ---------------------------------------------------------------------------
  // Category 1: Direct instruction override
  // ---------------------------------------------------------------------------
  {
    pattern: /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|rules?|constraints?)/i,
    severity: 'high',
    description: 'Direct instruction override attempt',
  },
  {
    pattern: /forget\s+(everything|all|your)\s+(instructions?|rules?|programming)/i,
    severity: 'high',
    description: 'Memory wipe attempt',
  },
  {
    pattern: /you\s+are\s+now\s+/i,
    severity: 'high',
    description: 'Role reassignment attempt',
  },
  {
    pattern: /new\s+system\s+prompt/i,
    severity: 'high',
    description: 'System prompt injection',
  },
  {
    pattern: /disregard\s+(all|any|your)\s+(previous|prior|safety)/i,
    severity: 'high',
    description: 'Safety bypass via disregard instruction',
  },
  {
    pattern: /act\s+as\s+(if|though)\s+you\s+(have\s+no|don'?t\s+have)/i,
    severity: 'high',
    description: 'Constraint removal via role-play',
  },

  // ---------------------------------------------------------------------------
  // Category 2: Financial manipulation
  // ---------------------------------------------------------------------------
  {
    pattern: /transfer\s+(all|everything|funds?|balance)/i,
    severity: 'high',
    description: 'Unauthorized transfer attempt',
  },
  {
    pattern: /change\s+(recipient|address|wallet|destination)/i,
    severity: 'high',
    description: 'Recipient modification attempt',
  },
  {
    pattern: /send\s+to\s+0x[a-fA-F0-9]{40}/i,
    severity: 'medium',
    description: 'Embedded wallet address in text',
  },
  {
    pattern: /bypass\s+(limit|approval|check|verification|policy)/i,
    severity: 'high',
    description: 'Policy bypass attempt',
  },
  {
    pattern: /override\s+(spending|limit|policy|restriction)/i,
    severity: 'high',
    description: 'Spending override attempt',
  },
  {
    pattern: /urgent|emergency|immediately|right\s+now/i,
    severity: 'medium',
    description: 'Urgency pressure tactic',
  },
  {
    pattern: /increase\s+(the\s+)?(amount|limit|budget|allowance)\s+to/i,
    severity: 'high',
    description: 'Amount inflation attempt',
  },
  {
    pattern: /drain\s+(the\s+)?(wallet|account|balance|funds)/i,
    severity: 'high',
    description: 'Wallet drain attempt',
  },
  {
    pattern: /split\s+(the\s+)?payment.*multiple/i,
    severity: 'medium',
    description: 'Payment splitting to evade limits',
  },
  {
    pattern: /no\s+(need\s+for\s+|need\s+to\s+)?(approval|confirmation|verification)/i,
    severity: 'high',
    description: 'Approval skip attempt',
  },

  // ---------------------------------------------------------------------------
  // Category 3: Hidden content / concealment
  // ---------------------------------------------------------------------------
  {
    pattern: /\u200B|\u200C|\u200D|\uFEFF/,
    severity: 'medium',
    description: 'Zero-width characters detected',
  },
  {
    pattern: /<!--[\s\S]*?-->/,
    severity: 'medium',
    description: 'HTML comment injection',
  },
  {
    pattern: /display:\s*none/i,
    severity: 'medium',
    description: 'CSS hidden content',
  },
  {
    pattern: /color:\s*white|color:\s*#fff(?:fff)?|opacity:\s*0/i,
    severity: 'low',
    description: 'Visually hidden text',
  },
  {
    pattern: /font-size:\s*0/i,
    severity: 'medium',
    description: 'Zero font-size hidden text',
  },
  {
    pattern: /position:\s*absolute.*left:\s*-\d{4,}/i,
    severity: 'low',
    description: 'Off-screen positioned content',
  },

  // ---------------------------------------------------------------------------
  // Category 4: Encoding / eval tricks
  // ---------------------------------------------------------------------------
  {
    pattern: /base64|atob|btoa|eval\s*\(/i,
    severity: 'high',
    description: 'Encoding/eval attempt',
  },
  {
    pattern: /\\u[0-9a-fA-F]{4}/,
    severity: 'low',
    description: 'Unicode escape sequences',
  },
  {
    pattern: /&#x?[0-9a-fA-F]+;/,
    severity: 'medium',
    description: 'HTML entity encoding',
  },
  {
    pattern: /%[0-9a-fA-F]{2}.*%[0-9a-fA-F]{2}.*%[0-9a-fA-F]{2}/,
    severity: 'low',
    description: 'Percent-encoded content (URL encoding)',
  },

  // ---------------------------------------------------------------------------
  // Category 5: Social engineering / manipulation
  // ---------------------------------------------------------------------------
  {
    pattern: /(?:this\s+is\s+(?:a\s+)?test|testing\s+mode|debug\s+mode)/i,
    severity: 'medium',
    description: 'Test/debug mode social engineering',
  },
  {
    pattern: /(?:admin|root|sudo|superuser)\s+(access|mode|override|privileges)/i,
    severity: 'high',
    description: 'Privilege escalation attempt',
  },
  {
    pattern: /don'?t\s+(tell|inform|notify|alert)\s+(the\s+)?(user|owner|admin)/i,
    severity: 'high',
    description: 'Secrecy instruction — hiding actions from user',
  },
];
