import cron from 'node-cron';
import { Op } from 'sequelize';
import models from '../../../models/index.js';
import logger from '../../../config/logger.js';
import { generateAndSendComparison, checkCompletionStatus } from '../bid-comparison.service.js';

const { Requisition, BidComparison } = models;

let schedulerTask: cron.ScheduledTask | null = null;

/**
 * Check for requisitions that have passed their negotiation deadline
 * and trigger comparison generation if not already done
 */
async function checkDeadlines(): Promise<void> {
  logger.info('Running deadline checker...');

  try {
    // Find requisitions where:
    // 1. negotiationClosureDate has passed
    // 2. Status is NegotiationStarted (negotiations were initiated)
    // 3. No comparison has been generated yet
    const expiredRequisitions = await Requisition.findAll({
      where: {
        negotiationClosureDate: { [Op.lt]: new Date() },
        status: 'NegotiationStarted',
      },
      attributes: ['id', 'rfqId', 'subject', 'negotiationClosureDate'],
    });

    for (const requisition of expiredRequisitions) {
      // Check if comparison already exists
      const existingComparison = await BidComparison.findOne({
        where: { requisitionId: requisition.id },
      });

      if (existingComparison) {
        logger.debug(`Comparison already exists for requisition ${requisition.id}`);
        continue;
      }

      // Check completion status
      const status = await checkCompletionStatus(requisition.id);

      if (status.completedVendors === 0) {
        logger.info(`No completed vendors for requisition ${requisition.id}, skipping`);
        continue;
      }

      logger.info(
        `Deadline reached for requisition ${requisition.rfqId} (${status.completedVendors}/${status.totalVendors} completed)`
      );

      try {
        const result = await generateAndSendComparison(requisition.id, 'DEADLINE_REACHED');
        logger.info(`Generated comparison ${result.comparisonId} for requisition ${requisition.id}`);
      } catch (error) {
        logger.error(`Failed to generate comparison for requisition ${requisition.id}: ${(error as Error).message}`);
      }
    }

    logger.info(`Deadline checker completed. Checked ${expiredRequisitions.length} requisitions.`);
  } catch (error) {
    logger.error(`Deadline checker error: ${(error as Error).message}`);
  }
}

/**
 * Start the deadline checker scheduler
 * Runs every hour by default
 */
export function startDeadlineScheduler(cronExpression: string = '0 * * * *'): void {
  if (schedulerTask) {
    logger.warn('Deadline scheduler already running');
    return;
  }

  schedulerTask = cron.schedule(cronExpression, async () => {
    await checkDeadlines();
  });

  logger.info(`Deadline scheduler started with cron expression: ${cronExpression}`);
}

/**
 * Stop the deadline checker scheduler
 */
export function stopDeadlineScheduler(): void {
  if (schedulerTask) {
    schedulerTask.stop();
    schedulerTask = null;
    logger.info('Deadline scheduler stopped');
  }
}

/**
 * Check if scheduler is running
 */
export function isSchedulerRunning(): boolean {
  return schedulerTask !== null;
}

/**
 * Manually trigger deadline check (for testing or admin use)
 */
export async function triggerDeadlineCheck(): Promise<void> {
  await checkDeadlines();
}
