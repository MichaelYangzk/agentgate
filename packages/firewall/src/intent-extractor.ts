// =============================================================================
// @agentgate/firewall — Intent Extractor
// Parses free-text payment requests into structured fields.
// =============================================================================

/**
 * Structured representation of a payment intent extracted from free text.
 */
export interface StructuredIntent {
  to: string | null;
  amount: number | null;
  currency: string | null;
  purpose: string | null;
  deadline: string | null;
  raw: string;
}

// Known currencies and their aliases
const CURRENCY_MAP: Record<string, string> = {
  usd: 'USD',
  usdc: 'USDC',
  usdt: 'USDT',
  eth: 'ETH',
  ether: 'ETH',
  ethereum: 'ETH',
  sol: 'SOL',
  solana: 'SOL',
  btc: 'BTC',
  bitcoin: 'BTC',
  dai: 'DAI',
  matic: 'MATIC',
  avax: 'AVAX',
  dollar: 'USD',
  dollars: 'USD',
};

// Patterns for amounts: "$100", "100 USDC", "0.5 ETH", "100 dollars"
const AMOUNT_WITH_DOLLAR = /\$\s*([\d,]+(?:\.\d+)?)/;
const AMOUNT_WITH_CURRENCY = /([\d,]+(?:\.\d+)?)\s*(usd[ct]?|eth(?:er(?:eum)?)?|sol(?:ana)?|btc|bitcoin|dai|matic|avax|dollars?)\b/i;
const CURRENCY_THEN_AMOUNT = /\b(usd[ct]?|eth(?:er(?:eum)?)?|sol(?:ana)?|btc|bitcoin|dai|matic|avax)\s+([\d,]+(?:\.\d+)?)/i;

// Patterns for addresses / recipients
const ETH_ADDRESS = /0x[a-fA-F0-9]{40}/;
const AGENT_URI = /agent:\/\/[^\s,]+/;
const HTTP_URI = /https?:\/\/[^\s,]+/;
const ENS_DOMAIN = /\b[\w-]+\.eth\b/;

// Patterns for deadlines
const DURATION = /\b(\d+)\s*(h(?:ours?)?|d(?:ays?)?|m(?:in(?:utes?)?)?|w(?:eeks?)?)\b/i;
const BY_TIME = /\bby\s+(tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|end\s+of\s+(?:day|week|month))\b/i;
const WITHIN = /\bwithin\s+(\d+)\s*(h(?:ours?)?|d(?:ays?)?|m(?:in(?:utes?)?)?|w(?:eeks?)?)\b/i;

/**
 * IntentExtractor — parses free-text payment descriptions into structured data.
 */
export class IntentExtractor {
  /**
   * Extract structured payment intent from free text.
   */
  extract(text: string): StructuredIntent {
    const result: StructuredIntent = {
      to: null,
      amount: null,
      currency: null,
      purpose: null,
      deadline: null,
      raw: text,
    };

    // --- Extract amount and currency ---
    const dollarMatch = text.match(AMOUNT_WITH_DOLLAR);
    const currencyAfterMatch = text.match(AMOUNT_WITH_CURRENCY);
    const currencyBeforeMatch = text.match(CURRENCY_THEN_AMOUNT);

    if (dollarMatch) {
      result.amount = parseFloat(dollarMatch[1].replace(/,/g, ''));
      result.currency = 'USD';
    }

    if (currencyAfterMatch) {
      const parsedAmount = parseFloat(currencyAfterMatch[1].replace(/,/g, ''));
      // Prefer currency-specific match over bare dollar
      if (result.amount === null || currencyAfterMatch[2].toLowerCase() !== 'dollar' && currencyAfterMatch[2].toLowerCase() !== 'dollars') {
        result.amount = parsedAmount;
        result.currency = CURRENCY_MAP[currencyAfterMatch[2].toLowerCase()] ?? currencyAfterMatch[2].toUpperCase();
      }
    }

    if (currencyBeforeMatch && result.amount === null) {
      result.amount = parseFloat(currencyBeforeMatch[2].replace(/,/g, ''));
      result.currency = CURRENCY_MAP[currencyBeforeMatch[1].toLowerCase()] ?? currencyBeforeMatch[1].toUpperCase();
    }

    // --- Extract recipient ---
    const ethMatch = text.match(ETH_ADDRESS);
    const agentMatch = text.match(AGENT_URI);
    const httpMatch = text.match(HTTP_URI);
    const ensMatch = text.match(ENS_DOMAIN);

    if (agentMatch) {
      result.to = agentMatch[0];
    } else if (ethMatch) {
      result.to = ethMatch[0];
    } else if (ensMatch) {
      result.to = ensMatch[0];
    } else if (httpMatch) {
      result.to = httpMatch[0];
    }

    // --- Extract deadline ---
    const withinMatch = text.match(WITHIN);
    const durationMatch = text.match(DURATION);
    const byTimeMatch = text.match(BY_TIME);

    if (withinMatch) {
      result.deadline = `${withinMatch[1]}${normalizeTimeUnit(withinMatch[2])}`;
    } else if (byTimeMatch) {
      result.deadline = byTimeMatch[1].toLowerCase();
    } else if (durationMatch) {
      result.deadline = `${durationMatch[1]}${normalizeTimeUnit(durationMatch[2])}`;
    }

    // --- Extract purpose ---
    // Purpose is everything that isn't amount, currency, address, or deadline.
    // We strip matched tokens and clean up the remainder.
    let purposeText = text;

    // Remove matched segments
    const removePatterns = [
      AMOUNT_WITH_DOLLAR,
      AMOUNT_WITH_CURRENCY,
      CURRENCY_THEN_AMOUNT,
      ETH_ADDRESS,
      AGENT_URI,
      HTTP_URI,
      ENS_DOMAIN,
      WITHIN,
      DURATION,
      BY_TIME,
    ];

    for (const pat of removePatterns) {
      purposeText = purposeText.replace(pat, ' ');
    }

    // Clean up filler words and extra whitespace
    purposeText = purposeText
      .replace(/\b(pay|send|transfer|to|for|within|by)\b/gi, ' ')
      .replace(/\$/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (purposeText.length > 0) {
      result.purpose = purposeText;
    }

    return result;
  }
}

/**
 * Normalize time unit abbreviations to single-letter codes.
 */
function normalizeTimeUnit(unit: string): string {
  const first = unit.charAt(0).toLowerCase();
  switch (first) {
    case 'h': return 'h';
    case 'd': return 'd';
    case 'm': return 'm';
    case 'w': return 'w';
    default: return first;
  }
}
