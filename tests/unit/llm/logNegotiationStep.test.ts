/**
 * Tests for logNegotiationStep.ts
 *
 * Verifies the audit logger calls Winston with exactly the right fields.
 * NEVER logs: LLM text, utility scores, weights, vendor messages, or PII.
 * These tests use vi.spyOn to intercept the logger without real I/O.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logNegotiationStep, type NegotiationStepRecord } from '../../../src/metrics/log-negotiation-step.js';

// ─────────────────────────────────────────────
// Mock the logger before importing the module
// ─────────────────────────────────────────────

vi.mock('../../../src/config/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import the mocked logger AFTER the mock is registered
import logger from '../../../src/config/logger.js';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function makeRecord(overrides: Partial<NegotiationStepRecord> = {}): NegotiationStepRecord {
  return {
    action: 'COUNTER',
    firmness: 0.55,
    round: 2,
    counterPrice: 90000,
    vendorTone: 'formal',
    dealId: 'deal-abc-123',
    fromLlm: true,
    ...overrides,
  };
}

// ─────────────────────────────────────────────
// Basic logging contract
// ─────────────────────────────────────────────

describe('logNegotiationStep – basic contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls logger.info once', () => {
    logNegotiationStep(makeRecord());
    expect(logger.info).toHaveBeenCalledTimes(1);
  });

  it('first argument to logger.info is the event name "negotiation_step"', () => {
    logNegotiationStep(makeRecord());
    const [firstArg] = (logger.info as any).mock.calls[0];
    expect(firstArg).toBe('negotiation_step');
  });

  it('second argument to logger.info is an object', () => {
    logNegotiationStep(makeRecord());
    const [, payload] = (logger.info as any).mock.calls[0];
    expect(typeof payload).toBe('object');
    expect(payload).not.toBeNull();
  });

  it('logs event field as "negotiation_step"', () => {
    logNegotiationStep(makeRecord());
    const [, payload] = (logger.info as any).mock.calls[0];
    expect(payload.event).toBe('negotiation_step');
  });

  it('does not throw', () => {
    expect(() => logNegotiationStep(makeRecord())).not.toThrow();
  });

  it('is synchronous (no promise returned)', () => {
    const result = logNegotiationStep(makeRecord());
    expect(result).toBeUndefined();
  });
});

// ─────────────────────────────────────────────
// Required fields are logged
// ─────────────────────────────────────────────

describe('logNegotiationStep – required fields', () => {
  beforeEach(() => vi.clearAllMocks());

  it('logs action', () => {
    logNegotiationStep(makeRecord({ action: 'ACCEPT' }));
    const [, payload] = (logger.info as any).mock.calls[0];
    expect(payload.action).toBe('ACCEPT');
  });

  it('logs firmness', () => {
    logNegotiationStep(makeRecord({ firmness: 0.75 }));
    const [, payload] = (logger.info as any).mock.calls[0];
    expect(payload.firmness).toBe(0.75);
  });

  it('logs round number', () => {
    logNegotiationStep(makeRecord({ round: 5 }));
    const [, payload] = (logger.info as any).mock.calls[0];
    expect(payload.round).toBe(5);
  });

  it('logs vendorTone', () => {
    logNegotiationStep(makeRecord({ vendorTone: 'urgent' }));
    const [, payload] = (logger.info as any).mock.calls[0];
    expect(payload.vendorTone).toBe('urgent');
  });

  it('logs dealId', () => {
    logNegotiationStep(makeRecord({ dealId: 'my-deal-id' }));
    const [, payload] = (logger.info as any).mock.calls[0];
    expect(payload.dealId).toBe('my-deal-id');
  });
});

// ─────────────────────────────────────────────
// counterPrice: present for COUNTER/MESO, absent for others
// ─────────────────────────────────────────────

describe('logNegotiationStep – counterPrice field', () => {
  beforeEach(() => vi.clearAllMocks());

  it('logs counterPrice when provided (COUNTER action)', () => {
    logNegotiationStep(makeRecord({ action: 'COUNTER', counterPrice: 95000 }));
    const [, payload] = (logger.info as any).mock.calls[0];
    expect(payload.counterPrice).toBe(95000);
  });

  it('does NOT log counterPrice when it is undefined (ACCEPT action)', () => {
    logNegotiationStep(makeRecord({ action: 'ACCEPT', counterPrice: undefined }));
    const [, payload] = (logger.info as any).mock.calls[0];
    expect(payload.counterPrice).toBeUndefined();
  });

  it('does NOT log counterPrice when it is undefined (WALK_AWAY action)', () => {
    logNegotiationStep(makeRecord({ action: 'WALK_AWAY', counterPrice: undefined }));
    const [, payload] = (logger.info as any).mock.calls[0];
    expect(payload.counterPrice).toBeUndefined();
  });

  it('does NOT log counterPrice when it is null (ESCALATE action)', () => {
    logNegotiationStep(makeRecord({ action: 'ESCALATE', counterPrice: undefined }));
    const [, payload] = (logger.info as any).mock.calls[0];
    // counterPrice key should be absent, not just undefined
    expect('counterPrice' in payload).toBe(false);
  });
});

// ─────────────────────────────────────────────
// fromLlm field
// ─────────────────────────────────────────────

describe('logNegotiationStep – fromLlm field', () => {
  beforeEach(() => vi.clearAllMocks());

  it('logs fromLlm=true when LLM was used', () => {
    logNegotiationStep(makeRecord({ fromLlm: true }));
    const [, payload] = (logger.info as any).mock.calls[0];
    expect(payload.fromLlm).toBe(true);
  });

  it('logs fromLlm=false when fallback was used', () => {
    logNegotiationStep(makeRecord({ fromLlm: false }));
    const [, payload] = (logger.info as any).mock.calls[0];
    expect(payload.fromLlm).toBe(false);
  });

  it('logs fromLlm=null when omitted from record', () => {
    const record = makeRecord();
    delete (record as any).fromLlm;
    logNegotiationStep(record);
    const [, payload] = (logger.info as any).mock.calls[0];
    expect(payload.fromLlm).toBeNull();
  });
});

// ─────────────────────────────────────────────
// Strict: forbidden fields MUST NOT be logged
// ─────────────────────────────────────────────

describe('logNegotiationStep – forbidden fields must NEVER be logged', () => {
  beforeEach(() => vi.clearAllMocks());

  const FORBIDDEN_KEYS = [
    'llmResponse', 'llmText', 'prompt', 'systemPrompt',
    'utilityScore', 'priceUtility', 'termsUtility', 'totalUtility',
    'weights', 'thresholds', 'config', 'negotiationConfig',
    'vendorMessage', 'vendorEmail', 'vendorName', 'email',
    'password', 'token', 'apiKey',
  ];

  for (const key of FORBIDDEN_KEYS) {
    it(`payload does not contain forbidden key: "${key}"`, () => {
      logNegotiationStep(makeRecord());
      const [, payload] = (logger.info as any).mock.calls[0];
      expect(payload).not.toHaveProperty(key);
    });
  }

  it('payload is a flat object (no nested objects with sensitive data)', () => {
    logNegotiationStep(makeRecord());
    const [, payload] = (logger.info as any).mock.calls[0];
    // All values should be primitives (string/number/boolean/null)
    for (const [key, value] of Object.entries(payload)) {
      const type = typeof value;
      expect(['string', 'number', 'boolean', 'object']).toContain(type);
      // If object, it must only be null
      if (type === 'object' && value !== null) {
        fail(`Payload key "${key}" contains a non-null object: ${JSON.stringify(value)}`);
      }
    }
  });
});

// ─────────────────────────────────────────────
// All action types are logged correctly
// ─────────────────────────────────────────────

describe('logNegotiationStep – all action types', () => {
  beforeEach(() => vi.clearAllMocks());

  const actions = ['ACCEPT', 'COUNTER', 'WALK_AWAY', 'ESCALATE', 'MESO', 'ASK_CLARIFY'] as const;

  for (const action of actions) {
    it(`logs action="${action}" correctly`, () => {
      logNegotiationStep(makeRecord({ action }));
      const [, payload] = (logger.info as any).mock.calls[0];
      expect(payload.action).toBe(action);
    });
  }
});

// ─────────────────────────────────────────────
// All vendor tones are logged correctly
// ─────────────────────────────────────────────

describe('logNegotiationStep – all vendor tones', () => {
  beforeEach(() => vi.clearAllMocks());

  const tones = ['formal', 'casual', 'urgent', 'firm', 'friendly'] as const;

  for (const tone of tones) {
    it(`logs vendorTone="${tone}" correctly`, () => {
      logNegotiationStep(makeRecord({ vendorTone: tone }));
      const [, payload] = (logger.info as any).mock.calls[0];
      expect(payload.vendorTone).toBe(tone);
    });
  }
});

// ─────────────────────────────────────────────
// Edge cases
// ─────────────────────────────────────────────

describe('logNegotiationStep – edge cases', () => {
  beforeEach(() => vi.clearAllMocks());

  it('handles round=0 (initial greeting round)', () => {
    logNegotiationStep(makeRecord({ round: 0 }));
    const [, payload] = (logger.info as any).mock.calls[0];
    expect(payload.round).toBe(0);
  });

  it('handles very high round numbers (long negotiation)', () => {
    logNegotiationStep(makeRecord({ round: 50 }));
    const [, payload] = (logger.info as any).mock.calls[0];
    expect(payload.round).toBe(50);
  });

  it('handles firmness=0.0 (fully soft)', () => {
    logNegotiationStep(makeRecord({ firmness: 0.0 }));
    const [, payload] = (logger.info as any).mock.calls[0];
    expect(payload.firmness).toBe(0.0);
  });

  it('handles firmness=1.0 (fully firm)', () => {
    logNegotiationStep(makeRecord({ firmness: 1.0 }));
    const [, payload] = (logger.info as any).mock.calls[0];
    expect(payload.firmness).toBe(1.0);
  });

  it('handles very large counterPrice (enterprise deal)', () => {
    logNegotiationStep(makeRecord({ counterPrice: 10_000_000 }));
    const [, payload] = (logger.info as any).mock.calls[0];
    expect(payload.counterPrice).toBe(10_000_000);
  });

  it('handles UUID dealId format', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    logNegotiationStep(makeRecord({ dealId: uuid }));
    const [, payload] = (logger.info as any).mock.calls[0];
    expect(payload.dealId).toBe(uuid);
  });

  it('can be called multiple times in sequence without side effects', () => {
    logNegotiationStep(makeRecord({ round: 1 }));
    logNegotiationStep(makeRecord({ round: 2 }));
    logNegotiationStep(makeRecord({ round: 3 }));
    expect(logger.info).toHaveBeenCalledTimes(3);
  });
});
