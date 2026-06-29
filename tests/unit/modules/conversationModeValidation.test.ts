import { describe, it, expect } from 'vitest';
import { createDealSchema, modeQuerySchema, listDealsQuerySchema } from '../../../src/modules/chatbot/chatbot.validator.js';

describe('CONVERSATION Mode Standardization & INSIGHTS Purge Validation', () => {
  describe('createDealSchema', () => {
    it('should validate and default mode to CONVERSATION when omitted', () => {
      const input = { title: 'Test Negotiation Deal' };
      const { error, value } = createDealSchema.validate(input);
      expect(error).toBeUndefined();
      expect(value.mode).toBe('CONVERSATION');
    });

    it('should accept explicitly specified CONVERSATION mode', () => {
      const input = { title: 'Test Negotiation Deal', mode: 'CONVERSATION' };
      const { error, value } = createDealSchema.validate(input);
      expect(error).toBeUndefined();
      expect(value.mode).toBe('CONVERSATION');
    });

    it('should reject legacy INSIGHTS mode payloads', () => {
      const input = { title: 'Test Negotiation Deal', mode: 'INSIGHTS' };
      const { error } = createDealSchema.validate(input);
      expect(error).toBeDefined();
    });
  });

  describe('modeQuerySchema', () => {
    it('should default mode query parameter to CONVERSATION', () => {
      const input = {};
      const { error, value } = modeQuerySchema.validate(input);
      expect(error).toBeUndefined();
      expect(value.mode).toBe('CONVERSATION');
    });

    it('should reject legacy INSIGHTS query parameter', () => {
      const input = { mode: 'INSIGHTS' };
      const { error } = modeQuerySchema.validate(input);
      expect(error).toBeDefined();
    });
  });

  describe('listDealsQuerySchema', () => {
    it('should allow filtering by CONVERSATION mode', () => {
      const input = { mode: 'CONVERSATION' };
      const { error, value } = listDealsQuerySchema.validate(input);
      expect(error).toBeUndefined();
      expect(value.mode).toBe('CONVERSATION');
    });

    it('should reject filtering by legacy INSIGHTS mode', () => {
      const input = { mode: 'INSIGHTS' };
      const { error } = listDealsQuerySchema.validate(input);
      expect(error).toBeDefined();
    });
  });
});
