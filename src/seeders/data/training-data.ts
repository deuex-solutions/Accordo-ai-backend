/**
 * AI/ML Training Data and Embeddings seed data
 * Includes:
 * - Negotiation training data (scenario suggestions logged)
 * - Message embeddings (placeholder - actual vectors generated at runtime)
 * - Deal embeddings
 * - Negotiation patterns
 */

import { generateUUID } from '../helpers/id-generator.js';
import { daysFromNow, daysFromDate } from '../helpers/date-utils.js';
import { allChatbotDeals, type ChatbotDealData } from './contracts.js';
import { allChatMessages, getMessagesByDeal, type ChatMessageData } from './chat-messages.js';

export interface NegotiationTrainingData {
  id: string;
  dealId: string;
  userId: number;
  round: number;
  suggestionsJson: {
    HARD: string[];
    MEDIUM: string[];
    SOFT: string[];
    WALK_AWAY: string[];
  };
  conversationContext: string;
  configSnapshot: Record<string, unknown>;
  llmModel: string;
  generationSource: 'llm' | 'fallback';
  selectedScenario: string | null;
  selectedSuggestion: string | null;
  dealOutcome: string | null;
  createdAt: Date;
}

export interface MessageEmbeddingData {
  id: string;
  messageId: string;
  dealId: string;
  contentText: string;
  contentType: 'message' | 'offer_extract' | 'decision';
  role: 'VENDOR' | 'ACCORDO' | 'SYSTEM';
  outcome: string | null;
  utilityScore: number | null;
  decisionAction: string | null;
  // Note: Actual embedding vectors (1024 floats) generated at runtime
  createdAt: Date;
}

export interface DealEmbeddingData {
  id: string;
  dealId: string;
  embeddingType: 'summary' | 'pattern' | 'outcome';
  finalStatus: string;
  totalRounds: number;
  finalUtility: number | null;
  anchorPrice: number;
  targetPrice: number;
  finalPrice: number | null;
  // Note: Actual embedding vectors (1024 floats) generated at runtime
  createdAt: Date;
}

export interface NegotiationPatternData {
  id: string;
  patternType: 'successful_negotiation' | 'failed_negotiation' | 'quick_accept' | 'extended_negotiation' | 'escalation_trigger';
  patternName: string;
  description: string;
  avgUtility: number;
  successRate: number;
  sampleCount: number;
  exampleDealIds: string[];
  isActive: boolean;
  createdAt: Date;
}

// Suggestion templates for different scenarios
const hardSuggestions = [
  "We appreciate your position, but our target price remains ${target}. We need you to move closer to this figure.",
  "At ${price}, this offer doesn't meet our budget requirements. We're looking for at least a 15% reduction.",
  "Our analysis shows market rates are significantly lower. We'll need to see ${target} to proceed.",
  "The current price gap is too wide. Please reconsider your position to be more competitive.",
];

const mediumSuggestions = [
  "We're getting closer. If you can meet us at ${mid}, we have a deal.",
  "Let's find middle ground - how about ${mid} with extended payment terms?",
  "We value your partnership. At ${mid}, we can make this work.",
  "Your offer shows progress. ${mid} would seal the deal today.",
];

const softSuggestions = [
  "We're very interested in working with you. Could you offer any flexibility on price?",
  "Your terms are reasonable. Is there room for a small adjustment to ${soft}?",
  "We'd like to accept, but ${soft} would help us meet our internal targets.",
  "Just a minor adjustment to ${soft} and we can close this today.",
];

const walkAwaySuggestions = [
  "We've reached an impasse. Thank you for your time, but we need to explore other options.",
  "Unfortunately, we cannot accept terms that exceed ${max}. We'll have to decline.",
  "After careful consideration, this negotiation isn't meeting our requirements.",
  "We appreciate your efforts, but the gap between our positions is too significant.",
];

// Generate training data from completed deals
export const allTrainingData: NegotiationTrainingData[] = [];

allChatbotDeals
  .filter(d => d.round >= 2) // Only deals with meaningful conversations
  .forEach((deal, index) => {
    const config = deal.negotiationConfigJson;
    const messages = getMessagesByDeal(deal.id);

    // Generate context summary
    const vendorMessages = messages.filter(m => m.role === 'VENDOR');
    const lastVendorOffer = vendorMessages[vendorMessages.length - 1]?.extractedOffer;

    const contextSummary = `Deal: ${deal.title}
Target: $${config.targetPrice.toFixed(2)}
Max: $${config.maxAcceptablePrice.toFixed(2)}
Current offer: $${lastVendorOffer?.price.toFixed(2) || 'N/A'}
Round: ${deal.round}
Payment: ${lastVendorOffer?.paymentTerms || 'N/A'}`;

    // Generate suggestions for this deal
    const targetPrice = config.targetPrice;
    const midPrice = targetPrice * 1.1;
    const softPrice = targetPrice * 1.15;
    const maxPrice = config.maxAcceptablePrice;

    const suggestions = {
      HARD: hardSuggestions.map(s =>
        s.replace('${target}', targetPrice.toFixed(2))
          .replace('${price}', (lastVendorOffer?.price || targetPrice * 1.2).toFixed(2))
      ),
      MEDIUM: mediumSuggestions.map(s =>
        s.replace('${mid}', midPrice.toFixed(2))
      ),
      SOFT: softSuggestions.map(s =>
        s.replace('${soft}', softPrice.toFixed(2))
      ),
      WALK_AWAY: walkAwaySuggestions.map(s =>
        s.replace('${max}', maxPrice.toFixed(2))
      ),
    };

    // Determine what was selected (simulated)
    let selectedScenario: string | null = null;
    let selectedSuggestion: string | null = null;

    if (deal.status !== 'NEGOTIATING') {
      if (deal.status === 'ACCEPTED') {
        selectedScenario = Math.random() > 0.5 ? 'MEDIUM' : 'SOFT';
      } else if (deal.status === 'WALKED_AWAY') {
        selectedScenario = 'WALK_AWAY';
      } else {
        selectedScenario = 'HARD';
      }
      const scenarioSuggestions = suggestions[selectedScenario as keyof typeof suggestions];
      selectedSuggestion = scenarioSuggestions[Math.floor(Math.random() * scenarioSuggestions.length)];
    }

    allTrainingData.push({
      id: generateUUID(),
      dealId: deal.id,
      userId: deal.createdById,
      round: Math.max(1, deal.round - 1), // Suggestions generated before final round
      suggestionsJson: suggestions,
      conversationContext: contextSummary,
      configSnapshot: {
        targetPrice: config.targetPrice,
        maxAcceptablePrice: config.maxAcceptablePrice,
        weights: config.scoringWeights,
      },
      llmModel: 'qwen3',
      generationSource: index % 5 === 0 ? 'fallback' : 'llm', // 20% fallback
      selectedScenario,
      selectedSuggestion,
      dealOutcome: deal.status,
      createdAt: daysFromDate(new Date(deal.createdAt), deal.round - 1),
    });
  });

// Generate message embeddings metadata (vectors generated at runtime)
export const allMessageEmbeddings: MessageEmbeddingData[] = [];

allChatMessages
  .filter(m => m.role !== 'SYSTEM')
  .forEach(message => {
    const deal = allChatbotDeals.find(d => d.id === message.dealId);

    allMessageEmbeddings.push({
      id: generateUUID(),
      messageId: message.id,
      dealId: message.dealId,
      contentText: message.content,
      contentType: message.extractedOffer ? 'offer_extract' : message.engineDecision ? 'decision' : 'message',
      role: message.role,
      outcome: deal?.status || null,
      utilityScore: message.engineDecision?.utilityScore || null,
      decisionAction: message.engineDecision?.action || null,
      createdAt: new Date(message.createdAt),
    });
  });

// Generate deal embeddings metadata
export const allDealEmbeddings: DealEmbeddingData[] = [];

allChatbotDeals.forEach(deal => {
  const config = deal.negotiationConfigJson;
  const messages = getMessagesByDeal(deal.id);
  const lastVendorOffer = messages
    .filter(m => m.role === 'VENDOR' && m.extractedOffer)
    .pop()?.extractedOffer;

  allDealEmbeddings.push({
    id: generateUUID(),
    dealId: deal.id,
    embeddingType: deal.status === 'NEGOTIATING' ? 'summary' : 'outcome',
    finalStatus: deal.status,
    totalRounds: deal.round,
    finalUtility: lastVendorOffer
      ? Math.max(0, 1 - (lastVendorOffer.price - config.targetPrice) / (config.maxAcceptablePrice - config.targetPrice))
      : null,
    anchorPrice: config.anchorPrice,
    targetPrice: config.targetPrice,
    finalPrice: lastVendorOffer?.price || null,
    createdAt: new Date(deal.createdAt),
  });
});

// Generate negotiation patterns
export const allNegotiationPatterns: NegotiationPatternData[] = [
  {
    id: generateUUID(),
    patternType: 'successful_negotiation',
    patternName: 'Quick Agreement Pattern',
    description: 'Negotiations that concluded successfully within 3 rounds with high utility score.',
    avgUtility: 0.85,
    successRate: 0.92,
    sampleCount: allChatbotDeals.filter(d => d.status === 'ACCEPTED' && d.round <= 3).length,
    exampleDealIds: allChatbotDeals.filter(d => d.status === 'ACCEPTED' && d.round <= 3).slice(0, 3).map(d => d.id),
    isActive: true,
    createdAt: daysFromNow(-30),
  },
  {
    id: generateUUID(),
    patternType: 'successful_negotiation',
    patternName: 'Extended Negotiation Success',
    description: 'Successfully concluded negotiations requiring 5+ rounds but achieving target price.',
    avgUtility: 0.78,
    successRate: 0.75,
    sampleCount: allChatbotDeals.filter(d => d.status === 'ACCEPTED' && d.round >= 5).length,
    exampleDealIds: allChatbotDeals.filter(d => d.status === 'ACCEPTED' && d.round >= 5).slice(0, 3).map(d => d.id),
    isActive: true,
    createdAt: daysFromNow(-30),
  },
  {
    id: generateUUID(),
    patternType: 'failed_negotiation',
    patternName: 'Price Gap Stalemate',
    description: 'Negotiations that ended in walk-away due to persistent price gap above threshold.',
    avgUtility: 0.35,
    successRate: 0,
    sampleCount: allChatbotDeals.filter(d => d.status === 'WALKED_AWAY').length,
    exampleDealIds: allChatbotDeals.filter(d => d.status === 'WALKED_AWAY').slice(0, 3).map(d => d.id),
    isActive: true,
    createdAt: daysFromNow(-25),
  },
  {
    id: generateUUID(),
    patternType: 'escalation_trigger',
    patternName: 'Complex Terms Escalation',
    description: 'Negotiations escalated due to complex non-price terms requiring human review.',
    avgUtility: 0.55,
    successRate: 0.6,
    sampleCount: allChatbotDeals.filter(d => d.status === 'ESCALATED').length,
    exampleDealIds: allChatbotDeals.filter(d => d.status === 'ESCALATED').slice(0, 3).map(d => d.id),
    isActive: true,
    createdAt: daysFromNow(-20),
  },
  {
    id: generateUUID(),
    patternType: 'quick_accept',
    patternName: 'First Offer Acceptance',
    description: 'Pattern where initial vendor offer met all requirements immediately.',
    avgUtility: 0.95,
    successRate: 1.0,
    sampleCount: allChatbotDeals.filter(d => d.status === 'ACCEPTED' && d.round <= 2).length,
    exampleDealIds: allChatbotDeals.filter(d => d.status === 'ACCEPTED' && d.round <= 2).slice(0, 3).map(d => d.id),
    isActive: true,
    createdAt: daysFromNow(-15),
  },
  {
    id: generateUUID(),
    patternType: 'extended_negotiation',
    patternName: 'Marathon Negotiation',
    description: 'Deals requiring 7+ rounds, often due to multiple parameter optimization.',
    avgUtility: 0.65,
    successRate: 0.5,
    sampleCount: allChatbotDeals.filter(d => d.round >= 7).length,
    exampleDealIds: allChatbotDeals.filter(d => d.round >= 7).slice(0, 3).map(d => d.id),
    isActive: true,
    createdAt: daysFromNow(-10),
  },
];

// Helper functions
export const getTrainingDataByDeal = (dealId: string): NegotiationTrainingData[] =>
  allTrainingData.filter(t => t.dealId === dealId);

export const getTrainingDataByOutcome = (outcome: string): NegotiationTrainingData[] =>
  allTrainingData.filter(t => t.dealOutcome === outcome);

export const getTrainingDataBySource = (source: 'llm' | 'fallback'): NegotiationTrainingData[] =>
  allTrainingData.filter(t => t.generationSource === source);

export const getEmbeddingsByDeal = (dealId: string): MessageEmbeddingData[] =>
  allMessageEmbeddings.filter(e => e.dealId === dealId);

export const getEmbeddingsByRole = (role: MessageEmbeddingData['role']): MessageEmbeddingData[] =>
  allMessageEmbeddings.filter(e => e.role === role);

export const getDealEmbeddingsByStatus = (status: string): DealEmbeddingData[] =>
  allDealEmbeddings.filter(e => e.finalStatus === status);

export const getActivePatterns = (): NegotiationPatternData[] =>
  allNegotiationPatterns.filter(p => p.isActive);

export const getPatternsByType = (patternType: NegotiationPatternData['patternType']): NegotiationPatternData[] =>
  allNegotiationPatterns.filter(p => p.patternType === patternType);

// Stats
export const getTrainingDataStats = () => ({
  totalTrainingRecords: allTrainingData.length,
  byOutcome: {
    ACCEPTED: allTrainingData.filter(t => t.dealOutcome === 'ACCEPTED').length,
    WALKED_AWAY: allTrainingData.filter(t => t.dealOutcome === 'WALKED_AWAY').length,
    ESCALATED: allTrainingData.filter(t => t.dealOutcome === 'ESCALATED').length,
    NEGOTIATING: allTrainingData.filter(t => t.dealOutcome === 'NEGOTIATING').length,
  },
  bySource: {
    llm: allTrainingData.filter(t => t.generationSource === 'llm').length,
    fallback: allTrainingData.filter(t => t.generationSource === 'fallback').length,
  },
  messageEmbeddings: allMessageEmbeddings.length,
  dealEmbeddings: allDealEmbeddings.length,
  patterns: allNegotiationPatterns.length,
});
