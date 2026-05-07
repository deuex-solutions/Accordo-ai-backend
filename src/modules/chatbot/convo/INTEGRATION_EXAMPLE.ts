/**
 * Phase 2 Integration Example
 *
 * This file demonstrates how to integrate the Phase 2 conversation enhancement
 * system into the existing conversationService.ts workflow.
 *
 * NOTE: This is an EXAMPLE file, not meant to be imported directly.
 * Use it as a reference for integrating into your actual service layer.
 */

import { processConversationTurn } from './process-conversation-turn.js';
import { ChatbotDeal } from '../../../models/chatbot-deal.js';
import { ChatbotMessage } from '../../../models/chatbot-message.js';
import logger from '../../../config/logger.js';
import type { ConvoState } from './enhanced-convo-router.js';

/**
 * Example: Processing a vendor message in conversation mode
 *
 * This shows how to integrate processConversationTurn into your
 * existing message handling workflow.
 */
export async function exampleHandleVendorMessage(
  dealId: string,
  vendorMessage: string,
  userId: number
): Promise<{
  success: boolean;
  accordoMessage: string;
  dealStatus: string;
  conversationState: ConvoState;
}> {
  try {
    // Step 1: Save vendor message to database
    await ChatbotMessage.create({
      dealId,
      role: 'VENDOR',
      content: vendorMessage,
      createdAt: new Date(),
    });

    logger.info('[Example] Vendor message saved', { dealId });

    // Step 2: Process conversation turn (Phase 2 system)
    const result = await processConversationTurn({
      dealId,
      vendorMessage,
      userId,
    });

    logger.info('[Example] Turn processed', {
      dealId,
      accordoIntent: result.accordoIntent,
      vendorIntent: result.vendorIntent,
      phase: result.updatedState.phase,
    });

    // Step 3: Save Accordo response to database
    await ChatbotMessage.create({
      dealId,
      role: 'ACCORDO',
      content: result.accordoMessage,
      createdAt: new Date(),
    });

    logger.info('[Example] Accordo message saved', { dealId });

    // Step 4: Update deal status based on intent
    let newStatus: 'NEGOTIATING' | 'ACCEPTED' | 'WALKED_AWAY' | 'ESCALATED' =
      'NEGOTIATING';

    if (result.accordoIntent === 'ACCEPT') {
      newStatus = 'ACCEPTED';
    } else if (result.accordoIntent === 'WALK_AWAY') {
      newStatus = 'WALKED_AWAY';
    } else if (result.accordoIntent === 'ESCALATE') {
      newStatus = 'ESCALATED';
    }

    // Update deal if status changed
    if (newStatus !== 'NEGOTIATING') {
      await ChatbotDeal.update(
        { status: newStatus },
        { where: { id: dealId } }
      );

      logger.info('[Example] Deal status updated', {
        dealId,
        newStatus,
      });
    }

    return {
      success: true,
      accordoMessage: result.accordoMessage,
      dealStatus: newStatus,
      conversationState: result.updatedState,
    };
  } catch (error) {
    logger.error('[Example] Failed to handle vendor message', {
      dealId,
      error,
    });

    throw error;
  }
}

/**
 * Example: Testing template selection
 *
 * Shows how templates are selected deterministically
 */
export async function exampleTestTemplateSelection(): Promise<void> {
  const {
    selectTemplate,
    generateConversationMessage,
  } = await import('./conversation-templates.js');

  const dealId = 'test-deal-123';

  // Test 1: Same inputs produce same template
  const template1 = selectTemplate(dealId, 1, 'GREET');
  const template2 = selectTemplate(dealId, 1, 'GREET');

  console.log('Test 1 - Deterministic selection:');
  console.log('Template 1:', template1);
  console.log('Template 2:', template2);
  console.log('Match:', template1 === template2); // Should be true

  // Test 2: Different rounds produce different templates (usually)
  const round1 = selectTemplate(dealId, 1, 'COUNTER');
  const round2 = selectTemplate(dealId, 2, 'COUNTER');
  const round3 = selectTemplate(dealId, 3, 'COUNTER');

  console.log('\nTest 2 - Different rounds:');
  console.log('Round 1:', round1.substring(0, 50) + '...');
  console.log('Round 2:', round2.substring(0, 50) + '...');
  console.log('Round 3:', round3.substring(0, 50) + '...');

  // Test 3: Generate complete message with variables
  const message = generateConversationMessage(dealId, 1, 'COUNTER', {
    counterparty: 'Acme Corp',
    currentPrice: 150,
    targetPrice: 120,
    paymentTerms: 'Net 30',
    reason: 'This aligns with our budget and market analysis.',
  });

  console.log('\nTest 3 - Complete message:');
  console.log(message);
}

/**
 * Example: Monitoring conversation state
 *
 * Shows how to track and log conversation state transitions
 */
export async function exampleMonitorConversationState(
  dealId: string
): Promise<void> {
  const deal = await ChatbotDeal.findByPk(dealId);

  if (!deal || !deal.convoStateJson) {
    console.log('No conversation state found');
    return;
  }

  const state = deal.convoStateJson as ConvoState;

  console.log('Conversation State Summary:');
  console.log('─'.repeat(50));
  console.log('Deal ID:', dealId);
  console.log('Title:', deal.title);
  console.log('Phase:', state.phase);
  console.log('Turn Count:', state.turnCount);
  console.log('Refusal Count:', state.refusalCount);
  console.log('Last Refusal Type:', state.lastRefusalType || 'None');
  console.log('Small Talk Count:', state.smallTalkCount);
  console.log('Asked for Preferences:', state.askedForPreferences);
  console.log('Last Intent:', state.lastIntent || 'None');
  console.log('\nContext:');
  console.log('  Mentioned Price:', state.context.mentionedPrice);
  console.log('  Mentioned Terms:', state.context.mentionedTerms);
  console.log('  Shared Constraints:', state.context.sharedConstraints);
  console.log('─'.repeat(50));

  // Check for warning conditions
  if (state.refusalCount >= 3) {
    console.warn('⚠️  High refusal count - may need intervention');
  }

  if (state.smallTalkCount >= 2) {
    console.warn('⚠️  Too much small talk - redirecting to business');
  }

  if (state.turnCount > 20) {
    console.warn('⚠️  Long conversation - may need human oversight');
  }
}

/**
 * Example: Manual state initialization for testing
 *
 * Shows how to create a test deal with initialized conversation state
 */
export async function exampleInitializeTestDeal(): Promise<string> {
  const { initializeConvoState } = await import('./enhanced-convo-router.js');

  // Create test deal
  const deal = await ChatbotDeal.create({
    title: 'Test Deal - Phase 2 Integration',
    counterparty: 'Test Vendor Corp',
    status: 'NEGOTIATING',
    round: 0,
    mode: 'CONVERSATION',
    convoStateJson: initializeConvoState() as any,
    userId: 1, // Replace with actual user ID
  });

  logger.info('[Example] Test deal created', {
    dealId: deal.id,
    convoState: deal.convoStateJson,
  });

  return deal.id;
}

/**
 * Example: Simulating a multi-turn conversation
 *
 * Demonstrates how multiple turns are processed and state evolves
 */
export async function exampleSimulateConversation(
  dealId: string,
  userId: number
): Promise<void> {
  const vendorMessages = [
    'Hi there! Thanks for reaching out about this opportunity.',
    'Sure, I can provide pricing. Our standard rate is $180 per unit with Net 60 payment terms.',
    'I understand your concerns. How about $160 per unit with Net 45?',
    'That sounds reasonable. I can accept $140 per unit with Net 30.',
  ];

  console.log('Simulating Multi-Turn Conversation');
  console.log('='.repeat(60));

  for (let i = 0; i < vendorMessages.length; i++) {
    const vendorMessage = vendorMessages[i];

    console.log(`\n--- Turn ${i + 1} ---`);
    console.log('Vendor:', vendorMessage);

    const result = await exampleHandleVendorMessage(
      dealId,
      vendorMessage,
      userId
    );

    console.log('Accordo:', result.accordoMessage);
    console.log('Phase:', result.conversationState.phase);
    console.log('Status:', result.dealStatus);

    // Small delay between turns for readability
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.log('\n' + '='.repeat(60));
  console.log('Conversation Complete');
}

/**
 * Example: Custom template variable extraction
 *
 * Shows how to extract and prepare variables for different scenarios
 */
export function examplePrepareCustomVariables(
  deal: ChatbotDeal,
  vendorMessage: string,
  intent: string
): Record<string, any> {
  const variables: Record<string, any> = {
    counterparty: deal.counterparty || 'there',
  };

  // Extract price from vendor message
  const priceMatch = vendorMessage.match(/\$(\d+(?:,\d{3})*(?:\.\d{2})?)/);
  if (priceMatch) {
    variables.currentPrice = parseFloat(priceMatch[1].replace(/,/g, ''));
  }

  // Extract payment terms
  const termsMatch = vendorMessage.match(/net\s*(\d+)|(\d+)\s*days/i);
  if (termsMatch) {
    variables.paymentTerms = `Net ${termsMatch[1] || termsMatch[2]}`;
  }

  // Get target values from template config
  const config = (deal.Template?.configJson as any) || {};
  variables.targetPrice = config.targetPrice || 100;
  variables.productName = config.productName || 'this product';
  variables.quantity = config.quantity || 100;

  // Generate context-specific reasons
  if (intent === 'COUNTER' && variables.currentPrice && variables.targetPrice) {
    const diff = variables.currentPrice - variables.targetPrice;
    const percent = ((diff / variables.currentPrice) * 100).toFixed(1);
    variables.reason = `This ${percent}% adjustment aligns with our budget and market analysis.`;
  }

  return variables;
}

/**
 * Example: Error handling and recovery
 *
 * Shows how to handle common errors gracefully
 */
export async function exampleHandleErrors(
  dealId: string,
  vendorMessage: string,
  userId: number
): Promise<void> {
  try {
    const result = await processConversationTurn({
      dealId,
      vendorMessage,
      userId,
    });

    console.log('Success:', result.accordoMessage);
  } catch (error: any) {
    // Handle specific error types
    if (error.statusCode === 404) {
      console.error('Deal not found:', dealId);
      // Maybe create a new deal or notify user
    } else if (error.statusCode === 400) {
      console.error('Invalid deal state:', error.message);
      // Maybe reset conversation state
    } else if (error.message?.includes('LLM')) {
      console.error('LLM service error:', error.message);
      // Fallback to heuristic-only mode or retry
    } else {
      console.error('Unexpected error:', error);
      // Log to monitoring service
    }

    // Return a safe fallback response
    const fallbackMessage = `I apologize, but I encountered an issue processing your message. Could you please rephrase or provide more details?`;

    console.log('Fallback response:', fallbackMessage);
  }
}

/**
 * Example: Integrating with decision engine (Phase 3 preview)
 *
 * Shows where decision engine will plug in
 */
export async function exampleDecisionEngineIntegration(
  dealId: string,
  vendorMessage: string,
  userId: number
): Promise<void> {
  const result = await processConversationTurn({
    dealId,
    vendorMessage,
    userId,
  });

  // Check if we should invoke decision engine
  const { shouldInvokeDecisionEngine } = await import(
    './process-conversation-turn.js'
  );

  if (
    shouldInvokeDecisionEngine(result.accordoIntent, result.vendorIntent)
  ) {
    console.log('Decision engine should be invoked here');

    // TODO Phase 3: Parse vendor offer
    // const offer = await parseOffer(vendorMessage, conversationHistory);

    // TODO Phase 3: Get decision from engine
    // const decision = await decide(offer, templateConfig);

    // TODO Phase 3: Generate strategic response
    // const strategicMessage = await generateStrategicResponse(decision);

    console.log('For now, using template-based response:', result.accordoMessage);
  } else {
    console.log('Template-based response:', result.accordoMessage);
  }
}

/**
 * Example: Analytics and reporting
 *
 * Shows how to extract metrics from conversation state
 */
export async function exampleGenerateAnalytics(
  dealId: string
): Promise<{
  totalTurns: number;
  averageRefusalsPerDeal: number;
  phaseDistribution: Record<string, number>;
  intentDistribution: Record<string, number>;
}> {
  // This would typically aggregate across multiple deals
  const deal = await ChatbotDeal.findByPk(dealId);

  if (!deal || !deal.convoStateJson) {
    throw new Error('Deal or conversation state not found');
  }

  const state = deal.convoStateJson as ConvoState;

  // Load all messages for intent analysis
  const messages = await ChatbotMessage.findAll({
    where: { dealId },
    order: [['createdAt', 'ASC']],
  });

  const accordoMessages = messages.filter((m) => m.role === 'ACCORDO');

  // Count intent usage (would require storing intent metadata)
  const intentCounts: Record<string, number> = {
    GREET: 0,
    ASK_FOR_OFFER: 0,
    ASK_CLARIFY: 0,
    COUNTER: 0,
    ACCEPT: 0,
    ESCALATE: 0,
    WALK_AWAY: 0,
    SMALL_TALK: 0,
  };

  // Analyze message patterns (simplified)
  accordoMessages.forEach((msg) => {
    if (msg.content.toLowerCase().includes('hello')) intentCounts.GREET++;
    if (msg.content.toLowerCase().includes('pricing')) intentCounts.ASK_FOR_OFFER++;
    if (msg.content.toLowerCase().includes('clarify')) intentCounts.ASK_CLARIFY++;
    if (msg.content.toLowerCase().includes('propose')) intentCounts.COUNTER++;
    if (msg.content.toLowerCase().includes('accept')) intentCounts.ACCEPT++;
    if (msg.content.toLowerCase().includes('escalate')) intentCounts.ESCALATE++;
    if (msg.content.toLowerCase().includes('step away')) intentCounts.WALK_AWAY++;
  });

  return {
    totalTurns: state.turnCount,
    averageRefusalsPerDeal: state.refusalCount,
    phaseDistribution: {
      [state.phase]: 1, // Would aggregate across deals
    },
    intentDistribution: intentCounts,
  };
}

/**
 * Example: Unit test helper
 *
 * Shows how to test individual components
 */
export async function exampleUnitTests(): Promise<void> {
  const {
    classifyVendorIntent,
    initializeConvoState,
    handleRefusal,
  } = await import('./enhanced-convo-router.js');

  // Test 1: Intent classification
  console.log('Test 1: Vendor Intent Classification');
  const intent1 = await classifyVendorIntent(
    'Our price is $150 per unit with Net 30 payment terms.'
  );
  console.log('Expected: PROVIDE_OFFER, Got:', intent1);

  const intent2 = await classifyVendorIntent(
    "I can't share that information right now."
  );
  console.log('Expected: REFUSAL, Got:', intent2);

  // Test 2: State initialization
  console.log('\nTest 2: State Initialization');
  const state = initializeConvoState();
  console.log('Phase:', state.phase); // Should be GREET
  console.log('Turn Count:', state.turnCount); // Should be 0
  console.log('Refusal Count:', state.refusalCount); // Should be 0

  // Test 3: Refusal handling
  console.log('\nTest 3: Refusal Handling');
  const testState = initializeConvoState();
  const nextIntent1 = handleRefusal(testState, 'NO');
  console.log('After 1 refusal:', nextIntent1, '- Count:', testState.refusalCount);

  testState.refusalCount = 2;
  const nextIntent2 = handleRefusal(testState, 'LATER');
  console.log('After 3 refusals:', nextIntent2, '- Asked preferences:', testState.askedForPreferences);

  testState.refusalCount = 4;
  const nextIntent3 = handleRefusal(testState, 'NO');
  console.log('After 5 refusals:', nextIntent3, '- Phase:', testState.phase);
}

// Export all examples for easy access
export const examples = {
  handleVendorMessage: exampleHandleVendorMessage,
  testTemplateSelection: exampleTestTemplateSelection,
  monitorConversationState: exampleMonitorConversationState,
  initializeTestDeal: exampleInitializeTestDeal,
  simulateConversation: exampleSimulateConversation,
  prepareCustomVariables: examplePrepareCustomVariables,
  handleErrors: exampleHandleErrors,
  decisionEngineIntegration: exampleDecisionEngineIntegration,
  generateAnalytics: exampleGenerateAnalytics,
  unitTests: exampleUnitTests,
};
