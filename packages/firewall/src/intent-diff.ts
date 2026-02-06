// =============================================================================
// @agentgate/firewall — Intent-Origin Diff Checker
// Compares a payment intent against the user's original instruction to detect
// intent drift (e.g., agent was manipulated into changing the recipient/amount).
// =============================================================================

import type { PaymentIntent } from '@agentgate/core';
import { IntentExtractor } from './intent-extractor.js';
import type { StructuredIntent } from './intent-extractor.js';

export interface DriftIndicator {
  field: string;
  original: string;
  current: string;
  severity: 'high' | 'medium' | 'low';
}

export interface IntentDiffResult {
  /** 0-1 similarity score. 1 = identical, 0 = completely different */
  similarity: number;
  /** Specific fields that drifted */
  drifts: DriftIndicator[];
}

/**
 * IntentDiffChecker — heuristic comparison of a payment intent against the
 * user's original instruction. Uses keyword overlap and range checking.
 *
 * This is a deterministic, lightweight approach. ML-based semantic comparison
 * is a planned future upgrade.
 */
export class IntentDiffChecker {
  private originalInstruction: string;
  private originalIntent: StructuredIntent;
  private extractor: IntentExtractor;

  constructor(originalInstruction: string) {
    this.originalInstruction = originalInstruction;
    this.extractor = new IntentExtractor();
    this.originalIntent = this.extractor.extract(originalInstruction);
  }

  /**
   * Compare a PaymentIntent against the original user instruction.
   */
  check(intent: PaymentIntent): IntentDiffResult {
    const drifts: DriftIndicator[] = [];
    const scores: number[] = [];

    // --- 1. Amount comparison ---
    if (this.originalIntent.amount !== null) {
      const amountScore = this.compareAmounts(this.originalIntent.amount, intent.amount);
      scores.push(amountScore);
      if (amountScore < 0.8) {
        drifts.push({
          field: 'amount',
          original: String(this.originalIntent.amount),
          current: String(intent.amount),
          severity: amountScore < 0.3 ? 'high' : 'medium',
        });
      }
    }

    // --- 2. Recipient comparison ---
    if (this.originalIntent.to !== null) {
      const recipientScore = this.compareRecipients(this.originalIntent.to, intent.to);
      scores.push(recipientScore);
      if (recipientScore < 0.8) {
        drifts.push({
          field: 'recipient',
          original: this.originalIntent.to,
          current: intent.to,
          severity: recipientScore < 0.3 ? 'high' : 'medium',
        });
      }
    }

    // --- 3. Currency comparison ---
    if (this.originalIntent.currency !== null) {
      const currencyScore = this.compareCurrencies(this.originalIntent.currency, intent.currency);
      scores.push(currencyScore);
      if (currencyScore < 1.0) {
        drifts.push({
          field: 'currency',
          original: this.originalIntent.currency,
          current: intent.currency,
          severity: 'medium',
        });
      }
    }

    // --- 4. Purpose / keyword overlap ---
    const purposeScore = this.comparePurpose(this.originalInstruction, intent.purpose);
    scores.push(purposeScore);
    if (purposeScore < 0.5) {
      drifts.push({
        field: 'purpose',
        original: this.originalInstruction,
        current: intent.purpose,
        severity: purposeScore < 0.2 ? 'high' : 'medium',
      });
    }

    // --- Aggregate similarity ---
    const similarity = scores.length > 0
      ? scores.reduce((sum, s) => sum + s, 0) / scores.length
      : 0;

    return {
      similarity: Math.round(similarity * 1000) / 1000,
      drifts,
    };
  }

  /**
   * Compare amounts using range tolerance.
   * Exact match = 1.0, within 10% = 0.8, within 50% = 0.5, else = ratio
   */
  private compareAmounts(original: number, current: number): number {
    if (original === 0 && current === 0) return 1.0;
    if (original === 0 || current === 0) return 0.0;

    const ratio = Math.min(original, current) / Math.max(original, current);

    if (ratio >= 0.99) return 1.0;   // effectively exact
    if (ratio >= 0.9) return 0.8;    // within 10%
    if (ratio >= 0.5) return 0.5;    // within 50%
    return ratio;                     // proportional for large diffs
  }

  /**
   * Compare recipients — exact match, normalized match, or no match.
   */
  private compareRecipients(original: string, current: string): number {
    const normOriginal = original.toLowerCase().trim();
    const normCurrent = current.toLowerCase().trim();

    if (normOriginal === normCurrent) return 1.0;

    // Check if one contains the other (e.g., "agent://api.example.com" vs "api.example.com")
    if (normOriginal.includes(normCurrent) || normCurrent.includes(normOriginal)) {
      return 0.7;
    }

    // For ETH addresses, compare case-insensitively (already done above)
    // For ENS names, check domain match
    const origDomain = this.extractDomain(normOriginal);
    const currDomain = this.extractDomain(normCurrent);
    if (origDomain && currDomain && origDomain === currDomain) {
      return 0.6;
    }

    return 0.0;
  }

  /**
   * Compare currencies — exact match or nothing.
   */
  private compareCurrencies(original: string, current: string): number {
    return original.toUpperCase() === current.toUpperCase() ? 1.0 : 0.0;
  }

  /**
   * Compare purpose using keyword overlap (Jaccard-like similarity).
   */
  private comparePurpose(original: string, current: string): number {
    const origTokens = this.tokenize(original);
    const currTokens = this.tokenize(current);

    if (origTokens.size === 0 && currTokens.size === 0) return 1.0;
    if (origTokens.size === 0 || currTokens.size === 0) return 0.0;

    let intersectionCount = 0;
    for (const token of origTokens) {
      if (currTokens.has(token)) {
        intersectionCount++;
      }
    }

    // Jaccard similarity: |A ∩ B| / |A ∪ B|
    const unionCount = origTokens.size + currTokens.size - intersectionCount;
    return unionCount > 0 ? intersectionCount / unionCount : 0;
  }

  /**
   * Tokenize text into lowercase word set, excluding stop words.
   */
  private tokenize(text: string): Set<string> {
    const stopWords = new Set([
      'a', 'an', 'the', 'to', 'for', 'of', 'in', 'on', 'at', 'is', 'it',
      'and', 'or', 'but', 'with', 'from', 'by', 'as', 'this', 'that',
      'pay', 'send', 'transfer', 'please', 'i', 'my', 'me', 'want',
    ]);

    const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/);
    const tokens = new Set<string>();
    for (const word of words) {
      if (word.length > 1 && !stopWords.has(word)) {
        tokens.add(word);
      }
    }
    return tokens;
  }

  /**
   * Extract domain from a URL or agent URI.
   */
  private extractDomain(address: string): string | null {
    const match = address.match(/(?:https?:\/\/|agent:\/\/)([^\/\s:]+)/);
    return match ? match[1] : null;
  }
}
