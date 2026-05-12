/**
 * Vectorization Queue - In-memory queue for real-time message vectorization
 *
 * This implements a simple async queue for processing vectorization tasks
 * without requiring Redis. For production with high volume, consider Bull/BullMQ.
 */

import { ChatbotMessage, ChatbotDeal, MessageEmbedding } from '../../models/index.js';
import * as vectorService from './vector.service.js';
import { embeddingClient } from './embedding.client.js';
import logger from '../../config/logger.js';

interface VectorizationTask {
  type: 'message' | 'deal';
  id: string;
  priority: number;
  addedAt: Date;
  retries: number;
}

interface QueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  avgProcessingTimeMs: number;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const MAX_CONCURRENT = 3;
// removed dead: const PROCESSING_TIMEOUT_MS = 30000;

class VectorizationQueue {
  private queue: VectorizationTask[] = [];
  private processing: Set<string> = new Set();
  private completed: number = 0;
  private failed: number = 0;
  private totalProcessingTime: number = 0;
  private isRunning: boolean = false;
  private processInterval: NodeJS.Timeout | null = null;

  constructor() {
    logger.info('Vectorization queue initialized');
  }

  /**
   * Start the queue processor
   */
  start(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    this.processInterval = setInterval(() => this.processQueue(), 500);
    logger.info('Vectorization queue started');
  }

  /**
   * Stop the queue processor
   */
  stop(): void {
    this.isRunning = false;
    if (this.processInterval) {
      clearInterval(this.processInterval);
      this.processInterval = null;
    }
    logger.info('Vectorization queue stopped');
  }

  /**
   * Add a message to the vectorization queue
   */
  async enqueueMessage(messageId: string, priority: number = 1): Promise<void> {
    // Check if already queued or processing
    const taskKey = `message:${messageId}`;
    if (this.processing.has(taskKey) || this.queue.some((t) => t.id === messageId && t.type === 'message')) {
      logger.debug(`Message ${messageId} already queued`);
      return;
    }

    // Check if already embedded
    const existing = await MessageEmbedding.findOne({ where: { messageId } });
    if (existing) {
      logger.debug(`Message ${messageId} already embedded`);
      return;
    }

    this.queue.push({
      type: 'message',
      id: messageId,
      priority,
      addedAt: new Date(),
      retries: 0,
    });

    // Sort by priority (higher first)
    this.queue.sort((a, b) => b.priority - a.priority);

    logger.debug(`Enqueued message ${messageId} for vectorization`);
  }

  /**
   * Add a deal to the vectorization queue
   */
  async enqueueDeal(dealId: string, priority: number = 0): Promise<void> {
    // Check if already queued or processing
    const taskKey = `deal:${dealId}`;
    if (this.processing.has(taskKey) || this.queue.some((t) => t.id === dealId && t.type === 'deal')) {
      logger.debug(`Deal ${dealId} already queued`);
      return;
    }

    this.queue.push({
      type: 'deal',
      id: dealId,
      priority,
      addedAt: new Date(),
      retries: 0,
    });

    this.queue.sort((a, b) => b.priority - a.priority);

    logger.debug(`Enqueued deal ${dealId} for vectorization`);
  }

  /**
   * Process tasks from the queue
   */
  private async processQueue(): Promise<void> {
    if (!this.isRunning) return;

    // Check if embedding service is available
    const health = await embeddingClient.getHealthStatus();
    if (health.status !== 'healthy') {
      return; // Skip processing if service is unavailable
    }

    // Process up to MAX_CONCURRENT tasks
    while (this.processing.size < MAX_CONCURRENT && this.queue.length > 0) {
      const task = this.queue.shift();
      if (!task) break;

      const taskKey = `${task.type}:${task.id}`;
      this.processing.add(taskKey);

      this.processTask(task)
        .catch((error) => {
          logger.error(`Error processing task ${taskKey}:`, error);
        })
        .finally(() => {
          this.processing.delete(taskKey);
        });
    }
  }

  /**
   * Process a single task
   */
  private async processTask(task: VectorizationTask): Promise<void> {
    const startTime = Date.now();

    try {
      if (task.type === 'message') {
        await this.processMessage(task.id);
      } else {
        await this.processDeal(task.id);
      }

      this.completed++;
      this.totalProcessingTime += Date.now() - startTime;

      logger.debug(`Processed ${task.type} ${task.id} in ${Date.now() - startTime}ms`);
    } catch (error) {
      task.retries++;

      if (task.retries < MAX_RETRIES) {
        // Re-queue with delay
        setTimeout(() => {
          this.queue.push(task);
          this.queue.sort((a, b) => b.priority - a.priority);
        }, RETRY_DELAY_MS * task.retries);

        logger.warn(`Retrying ${task.type} ${task.id} (attempt ${task.retries + 1})`);
      } else {
        this.failed++;
        logger.error(`Failed to process ${task.type} ${task.id} after ${MAX_RETRIES} retries`);
      }
    }
  }

  /**
   * Process a message vectorization
   */
  private async processMessage(messageId: string): Promise<void> {
    const message = await ChatbotMessage.findByPk(messageId, {
      include: [{ model: ChatbotDeal, as: 'Deal' }],
    });

    if (!message || !message.Deal) {
      throw new Error('Message or deal not found');
    }

    const result = await vectorService.vectorizeMessage(message, message.Deal);
    if (!result.success) {
      throw new Error(result.error || 'Vectorization failed');
    }
  }

  /**
   * Process a deal vectorization
   */
  private async processDeal(dealId: string): Promise<void> {
    const result = await vectorService.vectorizeDeal(dealId);
    if (!result.success) {
      throw new Error(result.error || 'Vectorization failed');
    }
  }

  /**
   * Get queue statistics
   */
  getStats(): QueueStats {
    return {
      pending: this.queue.length,
      processing: this.processing.size,
      completed: this.completed,
      failed: this.failed,
      avgProcessingTimeMs:
        this.completed > 0 ? Math.round(this.totalProcessingTime / this.completed) : 0,
    };
  }

  /**
   * Clear the queue
   */
  clear(): void {
    this.queue = [];
    logger.info('Vectorization queue cleared');
  }

  /**
   * Get queue length
   */
  get length(): number {
    return this.queue.length;
  }

  /**
   * Check if queue is empty
   */
  get isEmpty(): boolean {
    return this.queue.length === 0 && this.processing.size === 0;
  }
}

// Export singleton instance
export const vectorizationQueue = new VectorizationQueue();

/**
 * Hook function to be called after a message is created
 * This integrates with the chatbot service
 */
export async function onMessageCreated(message: ChatbotMessage, deal: ChatbotDeal): Promise<void> {
  // Only vectorize if queue is running
  if (!vectorizationQueue['isRunning']) {
    vectorizationQueue.start();
  }

  // Higher priority for active negotiations
  const priority = deal.status === 'NEGOTIATING' ? 2 : 1;
  await vectorizationQueue.enqueueMessage(message.id, priority);

  // Also update deal embedding if deal status changed
  if (deal.status !== 'NEGOTIATING') {
    await vectorizationQueue.enqueueDeal(deal.id, 0);
  }
}

/**
 * Hook function to be called after a deal is completed
 */
export async function onDealCompleted(dealId: string): Promise<void> {
  if (!vectorizationQueue['isRunning']) {
    vectorizationQueue.start();
  }

  // High priority for completed deals
  await vectorizationQueue.enqueueDeal(dealId, 3);
}

export default vectorizationQueue;
