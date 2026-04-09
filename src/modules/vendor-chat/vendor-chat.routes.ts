import { Router } from 'express';
import {
  submitQuote,
  checkCanEditQuote,
  editQuote,
  getDeal,
  enterChat,
  sendMessage,
  getPMResponse,
  selectMesoOption,
  submitOthers,
  confirmFinalOffer,
  submitDiscount,
  submitPaymentTerms,
} from './vendor-chat.controller.js';

/**
 * Vendor Chat Routes
 * ALL routes are PUBLIC - NO authMiddleware
 * Authentication is via uniqueToken in request body/query
 */
const vendorChatRouter = Router();

// Quote management
vendorChatRouter.post('/quote', submitQuote);
vendorChatRouter.get('/can-edit-quote', checkCanEditQuote);
vendorChatRouter.put('/quote', editQuote);

// Deal/chat access
vendorChatRouter.get('/deal', getDeal);
vendorChatRouter.post('/enter', enterChat);

// Messaging (two-phase pattern)
vendorChatRouter.post('/message', sendMessage);
vendorChatRouter.post('/pm-response', getPMResponse);

// ============================================================================
// MESO + Others Flow Routes (February 2026)
// ============================================================================

// Select a MESO option (auto-accepts deal)
vendorChatRouter.post('/meso/select', selectMesoOption);

// Submit "Others" form with custom price/terms
vendorChatRouter.post('/meso/others', submitOthers);

// Confirm or deny final offer (stall detection response)
vendorChatRouter.post('/final-offer/confirm', confirmFinalOffer);

// ============================================================================
// Structured Prompt Routes (April 2026)
// Feature 1: initial discount ask; Feature 2: payment terms dropdown
// ============================================================================

vendorChatRouter.post('/discount', submitDiscount);
vendorChatRouter.post('/payment-terms', submitPaymentTerms);

export default vendorChatRouter;
