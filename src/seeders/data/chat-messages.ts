/**
 * Chat Messages seed data for negotiation conversations
 * Mixed depths: Short (2-4), Medium (5-10), Long (15-25) messages per conversation
 * All conversations are in CONVERSATION mode
 */

import { generateUUID } from '../helpers/id-generator.js';
import { daysFromDate } from '../helpers/date-utils.js';
import { allChatbotDeals, type ChatbotDealData } from './contracts.js';
import { calculateUtilityScore } from '../helpers/price-utils.js';

export interface ChatMessageData {
  id: string;
  dealId: string;
  role: 'VENDOR' | 'ACCORDO' | 'SYSTEM';
  content: string;
  round: number;
  extractedOffer?: {
    price: number;
    paymentTerms: string;
    deliveryDays: number;
  };
  engineDecision?: {
    action: 'ACCEPT' | 'COUNTER' | 'WALK_AWAY' | 'ESCALATE' | 'ASK_CLARIFY';
    utilityScore: number;
    counterOffer?: {
      price: number;
      paymentTerms: string;
      deliveryDays: number;
    };
  };
  createdAt: Date;
}

// Message templates for different negotiation stages
const vendorOpeningMessages = [
  "Thank you for the opportunity to participate in this RFQ. Based on our analysis, we're pleased to offer {price} per unit with {paymentTerms} payment terms and {deliveryDays} day delivery.",
  "We're excited to work with your team. Our initial offer is {price} per unit, {paymentTerms} terms, delivery in {deliveryDays} days.",
  "After reviewing your requirements, we propose {price} per unit with {paymentTerms} payment and {deliveryDays} day delivery time.",
  "We appreciate being selected for this RFQ. Our competitive offer: {price}/unit, {paymentTerms}, {deliveryDays} days delivery.",
];

const accordoCounterMessages = [
  "Thank you for your offer. Based on our analysis, we'd like to counter with {price} per unit, {paymentTerms}, and {deliveryDays} day delivery. This would give us a utility score of {utilityScore}%.",
  "We've reviewed your proposal. Our counter-offer is {price} per unit with {paymentTerms} payment terms and {deliveryDays} day delivery.",
  "After careful consideration, we propose {price} per unit, {paymentTerms}, {deliveryDays} days delivery.",
  "Your offer is noted. We'd like to propose {price}/unit, {paymentTerms}, and a {deliveryDays} day delivery window.",
];

const vendorCounterMessages = [
  "We understand your position. We can adjust to {price} per unit with {paymentTerms} and {deliveryDays} day delivery.",
  "After internal discussions, we can offer {price}/unit, {paymentTerms}, {deliveryDays} days delivery.",
  "We appreciate the counter. Our revised offer: {price} per unit, {paymentTerms} payment, {deliveryDays} day delivery.",
  "Thank you for your flexibility. We can meet you at {price}/unit with {paymentTerms} and {deliveryDays} days.",
];

const accordoAcceptMessages = [
  "I'm pleased to accept your offer. We have a deal at {price} per unit with {paymentTerms} payment terms and {deliveryDays} day delivery.",
  "Excellent! We accept your terms: {price}/unit, {paymentTerms}, {deliveryDays} days. Looking forward to working together.",
  "Your offer meets our requirements. Deal confirmed at {price} per unit, {paymentTerms}, {deliveryDays} day delivery.",
];

const accordoWalkAwayMessages = [
  "I appreciate your time, but unfortunately the current offer doesn't meet our minimum requirements. The utility score of {utilityScore}% falls below our walkaway threshold. We'll need to explore other options.",
  "After careful analysis, we're unable to proceed with the current terms. Thank you for your participation in this RFQ.",
  "The gap between our positions remains too significant. We'll be moving forward with alternative vendors. Thank you.",
];

const accordoEscalateMessages = [
  "This negotiation has reached a point where I need to escalate it to a human decision-maker for review. A procurement manager will be in touch shortly.",
  "Given the complexity of the terms being discussed, I'm escalating this deal for senior review. You'll hear from our team soon.",
  "We've reached a stage that requires human oversight. Escalating to the procurement team for final decision.",
];

const systemMessages = [
  "Negotiation session started. Configuration loaded successfully.",
  "Round {round} initiated. Processing vendor response.",
  "Counter-offer generated based on negotiation parameters.",
  "Deal status updated to {status}.",
];

// Helper to fill template with values
function fillTemplate(template: string, values: Record<string, string | number>): string {
  let result = template;
  for (const [key, value] of Object.entries(values)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
  }
  return result;
}

// Generate price progression for a negotiation
function generatePriceProgression(
  targetPrice: number,
  maxPrice: number,
  rounds: number,
  outcome: ChatbotDealData['status']
): number[] {
  const prices: number[] = [];
  const startPrice = targetPrice * (1.15 + Math.random() * 0.15); // 15-30% above target

  if (outcome === 'ACCEPTED') {
    // Converge towards target
    const finalPrice = targetPrice * (1 + Math.random() * 0.1); // 0-10% above target
    for (let i = 0; i < rounds; i++) {
      const progress = i / (rounds - 1);
      prices.push(startPrice - (startPrice - finalPrice) * progress);
    }
  } else if (outcome === 'WALKED_AWAY') {
    // Vendor doesn't budge enough
    const finalPrice = targetPrice * (1.15 + Math.random() * 0.1); // 15-25% above (still too high)
    for (let i = 0; i < rounds; i++) {
      const progress = i / (rounds - 1);
      prices.push(startPrice - (startPrice - finalPrice) * progress * 0.5);
    }
  } else {
    // Negotiating or escalated - partial progress
    for (let i = 0; i < rounds; i++) {
      const progress = i / rounds;
      prices.push(startPrice * (1 - progress * 0.15));
    }
  }

  return prices.map(p => Math.round(p * 100) / 100);
}

// Generate messages for a deal
function generateMessagesForDeal(deal: ChatbotDealData): ChatMessageData[] {
  const messages: ChatMessageData[] = [];
  const config = deal.negotiationConfigJson;
  const targetPrice = config.targetPrice;
  const maxPrice = config.maxAcceptablePrice;

  // Determine message count based on round and status
  let messageCount: number;
  if (deal.status === 'NEGOTIATING') {
    // Short to medium conversations
    messageCount = deal.round * 2 + 1; // Roughly 2 messages per round + opening
  } else if (deal.status === 'ACCEPTED') {
    // Medium to long - completed negotiations
    messageCount = deal.round * 2 + 2;
  } else if (deal.status === 'WALKED_AWAY') {
    // Usually longer - failed after multiple rounds
    messageCount = deal.round * 2 + 2;
  } else {
    // Escalated - longer conversations
    messageCount = deal.round * 2 + 3;
  }

  // Cap at reasonable maximum
  messageCount = Math.min(messageCount, 25);

  // Generate price progression
  const priceProgression = generatePriceProgression(targetPrice, maxPrice, Math.ceil(messageCount / 2), deal.status);

  // Start date for messages
  const startDate = new Date(deal.createdAt);

  // System message at start
  messages.push({
    id: generateUUID(),
    dealId: deal.id,
    role: 'SYSTEM',
    content: fillTemplate(systemMessages[0], {}),
    round: 0,
    createdAt: startDate,
  });

  let currentRound = 1;
  let priceIndex = 0;

  // Generate conversation
  for (let i = 0; i < messageCount - 1; i++) {
    const isVendorTurn = i % 2 === 0;
    const messageDate = daysFromDate(startDate, Math.floor(i / 4)); // ~4 messages per day

    if (isVendorTurn) {
      // Vendor message
      const currentPrice = priceProgression[Math.min(priceIndex, priceProgression.length - 1)];
      const paymentTerms = `Net ${30 + Math.floor(Math.random() * 3) * 15}`; // Net 30, 45, or 60
      const deliveryDays = 14 + Math.floor(Math.random() * 21); // 14-35 days

      const template = i === 0
        ? vendorOpeningMessages[Math.floor(Math.random() * vendorOpeningMessages.length)]
        : vendorCounterMessages[Math.floor(Math.random() * vendorCounterMessages.length)];

      messages.push({
        id: generateUUID(),
        dealId: deal.id,
        role: 'VENDOR',
        content: fillTemplate(template, {
          price: currentPrice.toFixed(2),
          paymentTerms,
          deliveryDays,
        }),
        round: currentRound,
        extractedOffer: {
          price: currentPrice,
          paymentTerms,
          deliveryDays,
        },
        createdAt: messageDate,
      });

      priceIndex++;
    } else {
      // Accordo message
      const vendorPrice = priceProgression[Math.min(priceIndex - 1, priceProgression.length - 1)];
      const utilityScore = calculateUtilityScore(vendorPrice, targetPrice, maxPrice);

      // Determine action based on deal status and round
      type EngineAction = 'ACCEPT' | 'COUNTER' | 'WALK_AWAY' | 'ESCALATE' | 'ASK_CLARIFY';
      let action: EngineAction;
      let template: string;

      const isLastRound = currentRound >= deal.round;

      if (isLastRound && deal.status === 'ACCEPTED') {
        action = 'ACCEPT';
        template = accordoAcceptMessages[Math.floor(Math.random() * accordoAcceptMessages.length)];
      } else if (isLastRound && deal.status === 'WALKED_AWAY') {
        action = 'WALK_AWAY';
        template = accordoWalkAwayMessages[Math.floor(Math.random() * accordoWalkAwayMessages.length)];
      } else if (isLastRound && deal.status === 'ESCALATED') {
        action = 'ESCALATE';
        template = accordoEscalateMessages[Math.floor(Math.random() * accordoEscalateMessages.length)];
      } else {
        action = 'COUNTER';
        template = accordoCounterMessages[Math.floor(Math.random() * accordoCounterMessages.length)];
      }

      // Generate counter offer (lower than vendor's price)
      const counterPrice = vendorPrice * (0.92 + Math.random() * 0.05); // 3-8% lower
      const counterPaymentTerms = `Net ${45 + Math.floor(Math.random() * 2) * 15}`; // Net 45 or 60
      const counterDeliveryDays = 21 + Math.floor(Math.random() * 14); // 21-35 days

      const engineDecisionObj = {
        action,
        utilityScore,
        counterOffer: action === 'COUNTER' ? {
          price: Math.round(counterPrice * 100) / 100,
          paymentTerms: counterPaymentTerms,
          deliveryDays: counterDeliveryDays,
        } : undefined,
      };

      messages.push({
        id: generateUUID(),
        dealId: deal.id,
        role: 'ACCORDO',
        content: fillTemplate(template, {
          price: counterPrice.toFixed(2),
          paymentTerms: counterPaymentTerms,
          deliveryDays: counterDeliveryDays,
          utilityScore: Math.round(utilityScore * 100),
          status: deal.status,
        }),
        round: currentRound,
        engineDecision: engineDecisionObj,
        createdAt: daysFromDate(messageDate, 0.1), // Slightly after vendor message
      });

      currentRound++;
    }
  }

  return messages;
}

// Generate all chat messages
export const allChatMessages: ChatMessageData[] = [];

allChatbotDeals.forEach(deal => {
  const messages = generateMessagesForDeal(deal);
  allChatMessages.push(...messages);
});

// Helper functions
export const getMessagesByDeal = (dealId: string): ChatMessageData[] =>
  allChatMessages.filter(m => m.dealId === dealId).sort((a, b) =>
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

export const getMessagesByRole = (dealId: string, role: ChatMessageData['role']): ChatMessageData[] =>
  getMessagesByDeal(dealId).filter(m => m.role === role);

export const getLastMessage = (dealId: string): ChatMessageData | undefined => {
  const messages = getMessagesByDeal(dealId);
  return messages[messages.length - 1];
};

export const getVendorOffers = (dealId: string): ChatMessageData[] =>
  getMessagesByDeal(dealId).filter(m => m.role === 'VENDOR' && m.extractedOffer);

export const getAccordoDecisions = (dealId: string): ChatMessageData[] =>
  getMessagesByDeal(dealId).filter(m => m.role === 'ACCORDO' && m.engineDecision);

export const getConversationLength = (dealId: string): number =>
  getMessagesByDeal(dealId).length;

// Get conversations by length category
export const getShortConversations = (): string[] =>
  allChatbotDeals
    .filter(d => getConversationLength(d.id) <= 6)
    .map(d => d.id);

export const getMediumConversations = (): string[] =>
  allChatbotDeals
    .filter(d => {
      const len = getConversationLength(d.id);
      return len > 6 && len <= 14;
    })
    .map(d => d.id);

export const getLongConversations = (): string[] =>
  allChatbotDeals
    .filter(d => getConversationLength(d.id) > 14)
    .map(d => d.id);
