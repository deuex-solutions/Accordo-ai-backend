/**
 * Vendor Simulator Controller
 *
 * HTTP request handlers for vendor autopilot functionality.
 */

import { Request, Response, NextFunction } from 'express';
import * as vendorSimulatorService from './vendor-simulator.service.js';
import { CustomError } from '../../../utils/custom-error.js';
import logger from '../../../config/logger.js';
import { getParam } from '../../../types/index.js';

/**
 * Generate next vendor message (autopilot)
 * POST /api/chatbot/vendor/deals/:dealId/vendor/next
 *
 * Request body:
 * {
 *   "scenario": "HARD" | "SOFT" | "WALK_AWAY"
 * }
 *
 * Response:
 * {
 *   "message": "Vendor message generated successfully",
 *   "data": {
 *     "vendorMessage": Message,
 *     "accordoMessage": Message,
 *     "deal": Deal,
 *     "completed": boolean
 *   }
 * }
 */
export const generateNextVendorMessage = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const dealId = getParam(req.params.dealId);
    const { scenario } = req.body;

    if (!scenario) {
      throw new CustomError('Scenario is required', 400);
    }

    // Validate scenario
    const validatedScenario = vendorSimulatorService.validateScenario(scenario);

    // Generate vendor message
    const result = await vendorSimulatorService.generateNextVendorMessage({
      dealId,
      scenario: validatedScenario,
      userId: req.context?.userId,
    });

    logger.info(
      `[VendorSimController] Vendor message generated for deal ${dealId}: ${result.vendorMessage.id}`,
      {
        dealId,
        scenario: validatedScenario,
        completed: result.completed,
        userId: req.context?.userId,
      }
    );

    res.status(200).json({
      message: 'Vendor message generated successfully',
      data: {
        vendorMessage: result.vendorMessage,
        accordoMessage: result.accordoMessage,
        deal: result.deal,
        completed: result.completed,
      },
    });
  } catch (error) {
    next(error);
  }
};
