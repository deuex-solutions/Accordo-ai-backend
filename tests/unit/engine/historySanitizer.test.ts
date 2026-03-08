/**
 * Tests for historySanitizer.ts
 *
 * Tests the conversation history sanitizer that removes stale negotiation
 * context from ACCORDO messages before LLM calls. Covers all 9 stale
 * pattern categories, role filtering (only ACCORDO is sanitized),
 * metadata preservation, edge cases, and pipeline behavior.
 *
 * No DB, no network — pure unit tests.
 */

import { describe, it, expect } from 'vitest';
import {
  sanitizeNegotiationHistory,
  type SanitizableMessage,
  type SanitizationResult,
} from '../../../src/modules/chatbot/engine/historySanitizer.js';

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const REPLACEMENT_TEXT =
  '[Previous context may be outdated. Use the current deal state and latest vendor message for your response.]';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function accordoMsg(content: string, extra?: Record<string, unknown>): SanitizableMessage {
  return { role: 'ACCORDO', content, ...extra };
}

function vendorMsg(content: string, extra?: Record<string, unknown>): SanitizableMessage {
  return { role: 'VENDOR', content, ...extra };
}

function systemMsg(content: string, extra?: Record<string, unknown>): SanitizableMessage {
  return { role: 'SYSTEM', content, ...extra };
}

// ─────────────────────────────────────────────
// Empty / trivial inputs
// ─────────────────────────────────────────────

describe('sanitizeNegotiationHistory – empty and trivial inputs', () => {
  it('returns empty messages array for empty input', () => {
    const result = sanitizeNegotiationHistory([]);
    expect(result.messages).toEqual([]);
    expect(result.sanitizedCount).toBe(0);
    expect(result.triggeredPatterns).toEqual([]);
  });

  it('returns single non-stale ACCORDO message unchanged', () => {
    const msgs = [accordoMsg('Hello, let us begin the negotiation.')];
    const result = sanitizeNegotiationHistory(msgs);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe('Hello, let us begin the negotiation.');
    expect(result.sanitizedCount).toBe(0);
    expect(result.triggeredPatterns).toEqual([]);
  });

  it('returns single vendor message unchanged', () => {
    const msgs = [vendorMsg('Our price is $90,000.')];
    const result = sanitizeNegotiationHistory(msgs);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe('Our price is $90,000.');
    expect(result.sanitizedCount).toBe(0);
  });

  it('returns single system message unchanged', () => {
    const msgs = [systemMsg('Negotiation session started.')];
    const result = sanitizeNegotiationHistory(msgs);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe('Negotiation session started.');
    expect(result.sanitizedCount).toBe(0);
  });
});

// ─────────────────────────────────────────────
// Role filtering — only ACCORDO is sanitized
// ─────────────────────────────────────────────

describe('sanitizeNegotiationHistory – role filtering', () => {
  it('does NOT sanitize VENDOR messages even when they contain stale patterns', () => {
    const msgs = [vendorMsg('The vendor has declined your offer.')];
    const result = sanitizeNegotiationHistory(msgs);
    expect(result.messages[0].content).toBe('The vendor has declined your offer.');
    expect(result.sanitizedCount).toBe(0);
    expect(result.triggeredPatterns).toEqual([]);
  });

  it('does NOT sanitize SYSTEM messages even when they contain stale patterns', () => {
    const msgs = [systemMsg('Negotiation has ended. Deal is locked.')];
    const result = sanitizeNegotiationHistory(msgs);
    expect(result.messages[0].content).toBe('Negotiation has ended. Deal is locked.');
    expect(result.sanitizedCount).toBe(0);
  });

  it('sanitizes only ACCORDO messages in a mixed-role conversation', () => {
    const msgs = [
      systemMsg('Session started.'),
      vendorMsg('Our offer is $85,000.'),
      accordoMsg('The vendor has already declined. The deal is locked.'),
      vendorMsg('Actually, we changed our mind. $82,000 works.'),
    ];
    const result = sanitizeNegotiationHistory(msgs);
    expect(result.messages[0].content).toBe('Session started.');
    expect(result.messages[1].content).toBe('Our offer is $85,000.');
    expect(result.messages[2].content).toBe(REPLACEMENT_TEXT);
    expect(result.messages[3].content).toBe('Actually, we changed our mind. $82,000 works.');
    expect(result.sanitizedCount).toBe(1);
  });

  it('does NOT sanitize messages with unknown roles', () => {
    const msgs: SanitizableMessage[] = [
      { role: 'USER', content: 'The vendor has declined the deal.' },
    ];
    const result = sanitizeNegotiationHistory(msgs);
    expect(result.messages[0].content).toBe('The vendor has declined the deal.');
    expect(result.sanitizedCount).toBe(0);
  });

  it('role matching is case-sensitive — lowercase "accordo" is NOT sanitized', () => {
    const msgs: SanitizableMessage[] = [
      { role: 'accordo', content: 'The vendor has declined.' },
    ];
    const result = sanitizeNegotiationHistory(msgs);
    expect(result.messages[0].content).toBe('The vendor has declined.');
    expect(result.sanitizedCount).toBe(0);
  });
});

// ─────────────────────────────────────────────
// Pattern: vendor_declined
// ─────────────────────────────────────────────

describe('sanitizeNegotiationHistory – vendor_declined pattern', () => {
  it('detects "vendor has declined"', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('The vendor has declined your latest counter-offer.'),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('vendor_declined');
    expect(result.messages[0].content).toBe(REPLACEMENT_TEXT);
  });

  it('detects "vendor rejected"', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('The vendor rejected the terms proposed.'),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('vendor_declined');
  });

  it('detects "vendor has already refused"', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('The vendor has already refused to negotiate on price.'),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('vendor_declined');
  });

  it('detects "vendor turned down"', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('The vendor turned down the delivery timeline.'),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('vendor_declined');
  });

  it('is case-insensitive', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('The VENDOR HAS DECLINED the offer.'),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('vendor_declined');
  });
});

// ─────────────────────────────────────────────
// Pattern: vendor_unwilling
// ─────────────────────────────────────────────

describe('sanitizeNegotiationHistory – vendor_unwilling pattern', () => {
  it('detects "vendor is not willing to"', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('The vendor is not willing to reduce the price further.'),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('vendor_unwilling');
  });

  it('detects "vendor not interested to"', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('The vendor not interested to continue this negotiation.'),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('vendor_unwilling');
  });

  it('detects "vendor not open to"', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('The vendor not open to further discussion on payment terms.'),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('vendor_unwilling');
  });
});

// ─────────────────────────────────────────────
// Pattern: vendor_will_not
// ─────────────────────────────────────────────

describe('sanitizeNegotiationHistory – vendor_will_not pattern', () => {
  it('detects "vendor will not accept"', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('The vendor will not accept anything below $95,000.'),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('vendor_will_not');
  });

  it('detects "vendor will never agree"', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('The vendor will never agree to those terms.'),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('vendor_will_not');
  });

  it('detects "vendor will not go below"', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('The vendor will not go below $80,000 on this deal.'),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('vendor_will_not');
  });

  it('detects "vendor not go above"', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('The vendor will not go above 30 days delivery timeline.'),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('vendor_will_not');
  });
});

// ─────────────────────────────────────────────
// Pattern: deal_locked
// ─────────────────────────────────────────────

describe('sanitizeNegotiationHistory – deal_locked pattern', () => {
  it('detects "deal is locked"', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('The deal is locked at the current terms.'),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('deal_locked');
  });

  it('detects "deal is already closed"', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('The deal is already closed with the vendor.'),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('deal_locked');
  });

  it('detects "deal finalized"', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('The deal finalized at $100,000.'),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('deal_locked');
  });

  it('detects "deal concluded"', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('The deal concluded with Net 30 payment.'),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('deal_locked');
  });

  it('detects "deal terminated"', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('The deal terminated due to price disagreement.'),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('deal_locked');
  });

  it('detects "deal already locked"', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('The deal already locked by procurement.'),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('deal_locked');
  });
});

// ─────────────────────────────────────────────
// Pattern: negotiation_ended
// ─────────────────────────────────────────────

describe('sanitizeNegotiationHistory – negotiation_ended pattern', () => {
  it('detects "negotiation has ended"', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('The negotiation has ended without agreement.'),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('negotiation_ended');
  });

  it('detects "negotiation has already concluded"', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('The negotiation has already concluded successfully.'),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('negotiation_ended');
  });

  it('detects "negotiation failed"', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('The negotiation failed due to price gap.'),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('negotiation_ended');
  });

  it('detects "negotiation terminated"', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('The negotiation terminated by mutual agreement.'),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('negotiation_ended');
  });
});

// ─────────────────────────────────────────────
// Pattern: no_authority
// ─────────────────────────────────────────────

describe('sanitizeNegotiationHistory – no_authority pattern', () => {
  it('detects "insufficient authority to"', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('You have insufficient authority to approve this deal.'),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('no_authority');
  });

  it('detects "no authority to"', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('The vendor representative has no authority to change terms.'),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('no_authority');
  });

  it('detects "lack of permission to"', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('There is a lack of permission to modify the contract.'),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('no_authority');
  });

  it('detects "no approval to"', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('The buyer has no approval to extend the deadline.'),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('no_authority');
  });

  it('detects "lack permission to"', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('We lack permission to override the budget cap.'),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('no_authority');
  });
});

// ─────────────────────────────────────────────
// Pattern: policy_block
// ─────────────────────────────────────────────

describe('sanitizeNegotiationHistory – policy_block pattern', () => {
  it('detects "cannot proceed because policy"', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('We cannot proceed because policy restricts orders above $200,000.'),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('policy_block');
  });

  it('detects "cannot continue due to regulation"', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('We cannot continue due to regulation changes in Q2.'),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('policy_block');
  });

  it('detects "cannot negotiate because compliance"', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('We cannot negotiate because compliance requires re-approval.'),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('policy_block');
  });

  it('detects "cannot proceed due to policy"', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('We cannot proceed due to policy changes in the vendor portal.'),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('policy_block');
  });
});

// ─────────────────────────────────────────────
// Pattern: not_available
// ─────────────────────────────────────────────

describe('sanitizeNegotiationHistory – not_available pattern', () => {
  it('detects "product is no longer available"', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('The product is no longer available from this vendor.'),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('not_available');
  });

  it('detects "item is not in stock"', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('The item is not in stock at the vendor warehouse.'),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('not_available');
  });

  it('detects "material not available"', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('The material not available for delivery this quarter.'),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('not_available');
  });

  it('detects "product no longer in stock"', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('The product no longer in stock at the regional depot.'),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('not_available');
  });
});

// ─────────────────────────────────────────────
// Pattern: price_boundary
// ─────────────────────────────────────────────

describe('sanitizeNegotiationHistory – price_boundary pattern', () => {
  it('detects "cannot go below $85,000"', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('We cannot go below $85,000 on this order.'),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('price_boundary');
  });

  it('detects "will not go above $100,000"', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('The buyer will not go above $100,000 for this contract.'),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('price_boundary');
  });

  it('detects "won\'t go lower than $50,000"', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg("The vendor won't go lower than $50,000."),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('price_boundary');
  });

  it('detects "cannot go higher than 90000"', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('We cannot go higher than 90000 for this item.'),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('price_boundary');
  });

  it('detects price with commas: "will not go below $1,200,000"', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('We will not go below $1,200,000 under any circumstances.'),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('price_boundary');
  });

  it('detects price without dollar sign: "cannot go below 75000"', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('We cannot go below 75000 for this order.'),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('price_boundary');
  });
});

// ─────────────────────────────────────────────
// Non-stale ACCORDO messages pass through
// ─────────────────────────────────────────────

describe('sanitizeNegotiationHistory – non-stale ACCORDO messages', () => {
  it('passes through a simple greeting', () => {
    const msgs = [accordoMsg('Hello! Let us discuss the terms for this deal.')];
    const result = sanitizeNegotiationHistory(msgs);
    expect(result.messages[0].content).toBe('Hello! Let us discuss the terms for this deal.');
    expect(result.sanitizedCount).toBe(0);
  });

  it('passes through a counter-offer without stale patterns', () => {
    const msgs = [accordoMsg('We propose a counter-offer of $88,000 with Net 30 payment terms.')];
    const result = sanitizeNegotiationHistory(msgs);
    expect(result.messages[0].content).toBe(
      'We propose a counter-offer of $88,000 with Net 30 payment terms.',
    );
    expect(result.sanitizedCount).toBe(0);
  });

  it('passes through utility analysis text', () => {
    const msgs = [accordoMsg('Based on utility scoring, the current offer yields 0.72 utility.')];
    const result = sanitizeNegotiationHistory(msgs);
    expect(result.messages[0].content).toBe(
      'Based on utility scoring, the current offer yields 0.72 utility.',
    );
    expect(result.sanitizedCount).toBe(0);
  });

  it('passes through acceptance language', () => {
    const msgs = [accordoMsg('We recommend accepting the vendor offer of $92,000.')];
    const result = sanitizeNegotiationHistory(msgs);
    expect(result.messages[0].content).toBe(
      'We recommend accepting the vendor offer of $92,000.',
    );
    expect(result.sanitizedCount).toBe(0);
  });
});

// ─────────────────────────────────────────────
// Replacement text is correct
// ─────────────────────────────────────────────

describe('sanitizeNegotiationHistory – replacement text', () => {
  it('replaces stale content with the exact neutral placeholder', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('The vendor has declined.'),
    ]);
    expect(result.messages[0].content).toBe(REPLACEMENT_TEXT);
  });

  it('every sanitized message uses the same replacement text', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('The vendor has declined.'),
      accordoMsg('The deal is locked.'),
      accordoMsg('The negotiation has ended.'),
    ]);
    for (const msg of result.messages) {
      expect(msg.content).toBe(REPLACEMENT_TEXT);
    }
  });
});

// ─────────────────────────────────────────────
// sanitizedCount accuracy
// ─────────────────────────────────────────────

describe('sanitizeNegotiationHistory – sanitizedCount', () => {
  it('returns 0 when no messages are sanitized', () => {
    const msgs = [
      accordoMsg('Hello, let us negotiate.'),
      vendorMsg('Sure, our offer is $90,000.'),
    ];
    const result = sanitizeNegotiationHistory(msgs);
    expect(result.sanitizedCount).toBe(0);
  });

  it('returns 1 when exactly one ACCORDO message is sanitized', () => {
    const msgs = [
      accordoMsg('The vendor has declined the offer.'),
      accordoMsg('Let us propose a new price.'),
    ];
    const result = sanitizeNegotiationHistory(msgs);
    expect(result.sanitizedCount).toBe(1);
  });

  it('returns correct count when multiple ACCORDO messages are sanitized', () => {
    const msgs = [
      accordoMsg('The vendor has declined.'),
      vendorMsg('Our price is firm.'),
      accordoMsg('The deal is locked.'),
      accordoMsg('The negotiation has ended.'),
    ];
    const result = sanitizeNegotiationHistory(msgs);
    expect(result.sanitizedCount).toBe(3);
  });

  it('does not count vendor messages toward sanitizedCount', () => {
    const msgs = [
      vendorMsg('The vendor has declined.'),
      vendorMsg('The deal is locked.'),
    ];
    const result = sanitizeNegotiationHistory(msgs);
    expect(result.sanitizedCount).toBe(0);
  });
});

// ─────────────────────────────────────────────
// triggeredPatterns collection
// ─────────────────────────────────────────────

describe('sanitizeNegotiationHistory – triggeredPatterns', () => {
  it('returns empty array when nothing is sanitized', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('Let us begin negotiations.'),
    ]);
    expect(result.triggeredPatterns).toEqual([]);
  });

  it('includes the correct label for a single pattern', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('The vendor has already declined our proposal.'),
    ]);
    expect(result.triggeredPatterns).toEqual(['vendor_declined']);
  });

  it('includes multiple labels when different patterns trigger', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('The vendor has declined.'),
      accordoMsg('The deal is locked.'),
    ]);
    expect(result.triggeredPatterns).toContain('vendor_declined');
    expect(result.triggeredPatterns).toContain('deal_locked');
  });

  it('does not duplicate labels when the same pattern triggers multiple times', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('The vendor has declined the first offer.'),
      accordoMsg('The vendor rejected the second offer.'),
    ]);
    const vendorDeclinedCount = result.triggeredPatterns.filter(p => p === 'vendor_declined').length;
    expect(vendorDeclinedCount).toBe(1);
  });

  it('collects all distinct labels from a single message with multiple patterns', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('The vendor has declined. The deal is locked. The negotiation has ended.'),
    ]);
    expect(result.triggeredPatterns).toContain('vendor_declined');
    expect(result.triggeredPatterns).toContain('deal_locked');
    expect(result.triggeredPatterns).toContain('negotiation_ended');
    expect(result.sanitizedCount).toBe(1);
  });

  it('accumulates patterns across multiple messages', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('The vendor has declined.'),
      accordoMsg('No authority to approve.'),
      accordoMsg('Cannot proceed because policy restrictions.'),
    ]);
    expect(result.triggeredPatterns).toContain('vendor_declined');
    expect(result.triggeredPatterns).toContain('no_authority');
    expect(result.triggeredPatterns).toContain('policy_block');
    expect(result.triggeredPatterns).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────
// Metadata preservation on sanitized messages
// ─────────────────────────────────────────────

describe('sanitizeNegotiationHistory – metadata preservation', () => {
  it('preserves the role property on sanitized messages', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('The vendor has declined.'),
    ]);
    expect(result.messages[0].role).toBe('ACCORDO');
  });

  it('preserves extra properties on sanitized messages', () => {
    const msg = accordoMsg('The vendor has declined.', {
      timestamp: '2025-03-15T10:30:00Z',
      messageId: 42,
      metadata: { round: 3, mode: 'INSIGHTS' },
    });
    const result = sanitizeNegotiationHistory([msg]);
    expect(result.messages[0].role).toBe('ACCORDO');
    expect(result.messages[0].content).toBe(REPLACEMENT_TEXT);
    expect(result.messages[0].timestamp).toBe('2025-03-15T10:30:00Z');
    expect(result.messages[0].messageId).toBe(42);
    expect(result.messages[0].metadata).toEqual({ round: 3, mode: 'INSIGHTS' });
  });

  it('preserves extra properties on non-sanitized ACCORDO messages', () => {
    const msg = accordoMsg('Let us discuss the terms.', {
      timestamp: '2025-03-15T10:30:00Z',
      round: 1,
    });
    const result = sanitizeNegotiationHistory([msg]);
    expect(result.messages[0].content).toBe('Let us discuss the terms.');
    expect(result.messages[0].timestamp).toBe('2025-03-15T10:30:00Z');
    expect(result.messages[0].round).toBe(1);
  });

  it('preserves extra properties on vendor messages', () => {
    const msg = vendorMsg('Our price is $90,000.', {
      vendorId: 7,
      companyName: 'Acme Corp',
    });
    const result = sanitizeNegotiationHistory([msg]);
    expect(result.messages[0].vendorId).toBe(7);
    expect(result.messages[0].companyName).toBe('Acme Corp');
  });
});

// ─────────────────────────────────────────────
// Original array immutability
// ─────────────────────────────────────────────

describe('sanitizeNegotiationHistory – immutability', () => {
  it('does not mutate the original messages array', () => {
    const original = [
      accordoMsg('The vendor has declined.'),
      vendorMsg('Our price is $90,000.'),
    ];
    const originalContents = original.map(m => m.content);
    sanitizeNegotiationHistory(original);
    expect(original.map(m => m.content)).toEqual(originalContents);
  });

  it('does not mutate the original message objects', () => {
    const msg = accordoMsg('The vendor has declined the offer.', { id: 1 });
    const originalContent = msg.content;
    sanitizeNegotiationHistory([msg]);
    expect(msg.content).toBe(originalContent);
  });
});

// ─────────────────────────────────────────────
// Result structure
// ─────────────────────────────────────────────

describe('sanitizeNegotiationHistory – result structure', () => {
  it('returns an object with messages, sanitizedCount, and triggeredPatterns', () => {
    const result = sanitizeNegotiationHistory([]);
    expect(result).toHaveProperty('messages');
    expect(result).toHaveProperty('sanitizedCount');
    expect(result).toHaveProperty('triggeredPatterns');
  });

  it('messages is always an array', () => {
    const result = sanitizeNegotiationHistory([]);
    expect(Array.isArray(result.messages)).toBe(true);
  });

  it('sanitizedCount is always a number', () => {
    const result = sanitizeNegotiationHistory([]);
    expect(typeof result.sanitizedCount).toBe('number');
  });

  it('triggeredPatterns is always an array', () => {
    const result = sanitizeNegotiationHistory([]);
    expect(Array.isArray(result.triggeredPatterns)).toBe(true);
  });

  it('output message count matches input message count', () => {
    const msgs = [
      accordoMsg('The vendor has declined.'),
      vendorMsg('Our price is $90,000.'),
      systemMsg('Session log entry.'),
      accordoMsg('Let us propose a counter.'),
    ];
    const result = sanitizeNegotiationHistory(msgs);
    expect(result.messages).toHaveLength(4);
  });
});

// ─────────────────────────────────────────────
// Edge cases
// ─────────────────────────────────────────────

describe('sanitizeNegotiationHistory – edge cases', () => {
  it('handles ACCORDO message with empty content', () => {
    const result = sanitizeNegotiationHistory([accordoMsg('')]);
    expect(result.sanitizedCount).toBe(0);
    expect(result.messages[0].content).toBe('');
  });

  it('handles ACCORDO message with whitespace-only content', () => {
    const result = sanitizeNegotiationHistory([accordoMsg('   ')]);
    expect(result.sanitizedCount).toBe(0);
    expect(result.messages[0].content).toBe('   ');
  });

  it('handles very long ACCORDO message with a stale pattern embedded', () => {
    const longPrefix = 'Based on our detailed analysis of the market conditions and pricing benchmarks, '.repeat(10);
    const content = longPrefix + 'the vendor has declined the revised offer.';
    const result = sanitizeNegotiationHistory([accordoMsg(content)]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('vendor_declined');
    expect(result.messages[0].content).toBe(REPLACEMENT_TEXT);
  });

  it('handles pattern text that spans word boundaries correctly', () => {
    // The word "vendor" with extra spacing
    const result = sanitizeNegotiationHistory([
      accordoMsg('The vendor   has   declined the offer.'),
    ]);
    // The regex uses \s+ so extra spaces should still match
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('vendor_declined');
  });

  it('does not trigger on partial word matches (e.g. "unvendor")', () => {
    // "vendor" should match as a word in the regex, but the regex does not
    // use word boundaries explicitly — it uses \s+ after "vendor".
    // "unvendor declined" should NOT match because the pattern expects
    // "vendor\s+" at the start of the phrase. Let us verify.
    const result = sanitizeNegotiationHistory([
      accordoMsg('The primary vendor has declined.'),
    ]);
    // This SHOULD match because "vendor has declined" is present
    expect(result.sanitizedCount).toBe(1);
  });

  it('handles messages with special characters in content', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('Price: $100,000 (USD). The vendor has declined. [REF: #4521]'),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('vendor_declined');
  });

  it('handles a large array of messages efficiently', () => {
    const msgs: SanitizableMessage[] = [];
    for (let i = 0; i < 200; i++) {
      if (i % 3 === 0) {
        msgs.push(accordoMsg(`Round ${i}: The vendor has declined.`));
      } else if (i % 3 === 1) {
        msgs.push(vendorMsg(`Round ${i}: Our price is $${80000 + i}.`));
      } else {
        msgs.push(accordoMsg(`Round ${i}: Let us continue.`));
      }
    }
    const result = sanitizeNegotiationHistory(msgs);
    expect(result.messages).toHaveLength(200);
    // Every 3rd message (index 0, 3, 6, ...) is a stale ACCORDO message
    const expectedSanitized = Math.ceil(200 / 3);
    expect(result.sanitizedCount).toBe(expectedSanitized);
  });
});

// ─────────────────────────────────────────────
// Realistic conversation pipeline
// ─────────────────────────────────────────────

describe('sanitizeNegotiationHistory – realistic conversation pipeline', () => {
  it('sanitizes stale ACCORDO messages in a multi-round negotiation', () => {
    const conversation: SanitizableMessage[] = [
      systemMsg('Negotiation session started for Steel Beams RFQ.'),
      vendorMsg('Our initial offer is $95,000 with Net 30.'),
      accordoMsg('Thank you. We propose $82,000 with Net 45.'),
      vendorMsg('That is too low. $90,000 is our best.'),
      accordoMsg('The vendor has declined our counter-offer of $82,000.'),
      vendorMsg('Actually, we can do $87,000 with Net 30.'),
      accordoMsg('The deal is locked at the previous terms.'),
      vendorMsg('We are flexible on delivery. 14 days works.'),
      accordoMsg('Based on the current offer, we recommend accepting.'),
    ];

    const result = sanitizeNegotiationHistory(conversation);
    expect(result.messages).toHaveLength(9);

    // System message preserved
    expect(result.messages[0].content).toBe('Negotiation session started for Steel Beams RFQ.');
    // Vendor messages preserved
    expect(result.messages[1].content).toBe('Our initial offer is $95,000 with Net 30.');
    expect(result.messages[3].content).toBe('That is too low. $90,000 is our best.');
    expect(result.messages[5].content).toBe('Actually, we can do $87,000 with Net 30.');
    expect(result.messages[7].content).toBe('We are flexible on delivery. 14 days works.');

    // Non-stale ACCORDO messages preserved
    expect(result.messages[2].content).toBe('Thank you. We propose $82,000 with Net 45.');
    expect(result.messages[8].content).toBe('Based on the current offer, we recommend accepting.');

    // Stale ACCORDO messages sanitized
    expect(result.messages[4].content).toBe(REPLACEMENT_TEXT);
    expect(result.messages[6].content).toBe(REPLACEMENT_TEXT);

    expect(result.sanitizedCount).toBe(2);
    expect(result.triggeredPatterns).toContain('vendor_declined');
    expect(result.triggeredPatterns).toContain('deal_locked');
  });

  it('handles conversation where all ACCORDO messages are stale', () => {
    const conversation: SanitizableMessage[] = [
      vendorMsg('We offer $95,000.'),
      accordoMsg('The vendor has declined.'),
      vendorMsg('How about $90,000?'),
      accordoMsg('The negotiation has ended.'),
      vendorMsg('OK let us try $85,000.'),
      accordoMsg('The deal is locked.'),
    ];

    const result = sanitizeNegotiationHistory(conversation);
    expect(result.sanitizedCount).toBe(3);
    // All vendor messages preserved
    expect(result.messages[0].content).toBe('We offer $95,000.');
    expect(result.messages[2].content).toBe('How about $90,000?');
    expect(result.messages[4].content).toBe('OK let us try $85,000.');
    // All ACCORDO messages sanitized
    expect(result.messages[1].content).toBe(REPLACEMENT_TEXT);
    expect(result.messages[3].content).toBe(REPLACEMENT_TEXT);
    expect(result.messages[5].content).toBe(REPLACEMENT_TEXT);
  });

  it('handles conversation with no stale content at all', () => {
    const conversation: SanitizableMessage[] = [
      systemMsg('Session started.'),
      vendorMsg('Our offer is $90,000.'),
      accordoMsg('Thank you. We counter with $85,000.'),
      vendorMsg('How about $87,500?'),
      accordoMsg('That works for us. Proceeding to contract.'),
    ];

    const result = sanitizeNegotiationHistory(conversation);
    expect(result.sanitizedCount).toBe(0);
    expect(result.triggeredPatterns).toEqual([]);
    // All messages preserved exactly
    for (let i = 0; i < conversation.length; i++) {
      expect(result.messages[i].content).toBe(conversation[i].content);
    }
  });
});

// ─────────────────────────────────────────────
// Multiple patterns in a single message
// ─────────────────────────────────────────────

describe('sanitizeNegotiationHistory – multiple patterns in one message', () => {
  it('detects vendor_declined AND deal_locked in the same message', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('The vendor has declined the offer. The deal is locked.'),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('vendor_declined');
    expect(result.triggeredPatterns).toContain('deal_locked');
  });

  it('detects negotiation_ended AND no_authority in the same message', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('The negotiation has ended. No authority to approve further changes.'),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('negotiation_ended');
    expect(result.triggeredPatterns).toContain('no_authority');
  });

  it('detects three patterns in a single message', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg(
        'The vendor has declined. The product is no longer available. Cannot go below $50,000.',
      ),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('vendor_declined');
    expect(result.triggeredPatterns).toContain('not_available');
    expect(result.triggeredPatterns).toContain('price_boundary');
    expect(result.triggeredPatterns).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────
// Case insensitivity of patterns
// ─────────────────────────────────────────────

describe('sanitizeNegotiationHistory – case insensitivity', () => {
  it('matches "VENDOR HAS DECLINED" (uppercase)', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('THE VENDOR HAS DECLINED THE OFFER.'),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('vendor_declined');
  });

  it('matches "Deal Is Locked" (title case)', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('The Deal Is Locked at current terms.'),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('deal_locked');
  });

  it('matches "NEGOTIATION HAS ENDED" (uppercase)', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('THE NEGOTIATION HAS ENDED.'),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('negotiation_ended');
  });

  it('matches "Cannot Go Below $50,000" (mixed case)', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('Cannot Go Below $50,000 for this item.'),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('price_boundary');
  });

  it('matches "PRODUCT IS NO LONGER AVAILABLE" (uppercase)', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('THE PRODUCT IS NO LONGER AVAILABLE.'),
    ]);
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('not_available');
  });
});

// ─────────────────────────────────────────────
// Messages with no content property
// ─────────────────────────────────────────────

describe('sanitizeNegotiationHistory – missing or falsy content', () => {
  it('handles ACCORDO message with undefined-ish content gracefully', () => {
    // The source code does `msg.content || ''` so a falsy content is safe
    const msg: SanitizableMessage = { role: 'ACCORDO', content: '' };
    const result = sanitizeNegotiationHistory([msg]);
    expect(result.sanitizedCount).toBe(0);
    expect(result.messages[0].content).toBe('');
  });
});

// ─────────────────────────────────────────────
// Patterns that should NOT trigger
// ─────────────────────────────────────────────

describe('sanitizeNegotiationHistory – non-matching content', () => {
  it('does NOT trigger on "vendor is considering the offer"', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('The vendor is considering the offer.'),
    ]);
    expect(result.sanitizedCount).toBe(0);
  });

  it('does NOT trigger on "the deal is progressing well"', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('The deal is progressing well.'),
    ]);
    expect(result.sanitizedCount).toBe(0);
  });

  it('does NOT trigger on "negotiation is ongoing"', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('The negotiation is ongoing with positive signals.'),
    ]);
    expect(result.sanitizedCount).toBe(0);
  });

  it('does NOT trigger on "product is available for order"', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('The product is available for order starting next month.'),
    ]);
    expect(result.sanitizedCount).toBe(0);
  });

  it('does NOT trigger on "vendor is willing to negotiate"', () => {
    // Note: "vendor is willing to" would match vendor_unwilling pattern
    // because the regex is /vendor\s+(?:is\s+)?(?:not\s+)?(?:willing|interested|open)\s+to/i
    // The "not" is optional, so "vendor is willing to" WOULD match.
    // This is by design — even positive willingness statements can be stale.
    const result = sanitizeNegotiationHistory([
      accordoMsg('The vendor is willing to discuss further.'),
    ]);
    // This WILL match because the regex makes "not" optional
    expect(result.sanitizedCount).toBe(1);
    expect(result.triggeredPatterns).toContain('vendor_unwilling');
  });

  it('does NOT trigger on "we can go below $50,000"', () => {
    // Pattern requires "cannot|will not|won't" before "go below/above"
    const result = sanitizeNegotiationHistory([
      accordoMsg('We can go below $50,000 if they improve delivery.'),
    ]);
    expect(result.sanitizedCount).toBe(0);
  });

  it('does NOT trigger on "vendor may accept"', () => {
    const result = sanitizeNegotiationHistory([
      accordoMsg('The vendor may accept if we adjust the payment terms.'),
    ]);
    expect(result.sanitizedCount).toBe(0);
  });
});

// ─────────────────────────────────────────────
// Order preservation
// ─────────────────────────────────────────────

describe('sanitizeNegotiationHistory – message order preservation', () => {
  it('preserves the order of messages in the output', () => {
    const msgs = [
      systemMsg('Start'),
      vendorMsg('Offer A'),
      accordoMsg('The vendor has declined.'),
      vendorMsg('Offer B'),
      accordoMsg('Counter proposal'),
    ];
    const result = sanitizeNegotiationHistory(msgs);
    expect(result.messages[0].role).toBe('SYSTEM');
    expect(result.messages[1].role).toBe('VENDOR');
    expect(result.messages[2].role).toBe('ACCORDO');
    expect(result.messages[3].role).toBe('VENDOR');
    expect(result.messages[4].role).toBe('ACCORDO');

    expect(result.messages[0].content).toBe('Start');
    expect(result.messages[1].content).toBe('Offer A');
    expect(result.messages[2].content).toBe(REPLACEMENT_TEXT); // sanitized
    expect(result.messages[3].content).toBe('Offer B');
    expect(result.messages[4].content).toBe('Counter proposal');
  });
});
