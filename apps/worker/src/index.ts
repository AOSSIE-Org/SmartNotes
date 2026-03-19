/**
 * SmartNotes Background Worker
 * 
 * Processes async jobs including:
 * - Note indexing
 * - AI embedding generation
 * - Search reindexing
 * - Agent task execution
 */

import 'dotenv/config';
import { getEventBus, createEventBus } from '@smartnotes/events';
import { createIndexingPipeline } from '@smartnotes/ai-core';
import { createDatabaseClient, getDatabaseConfig } from '@smartnotes/db';
import { createVault } from '@smartnotes/vault';

// ==================== Job Types ====================

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'retrying';

export interface Job {
    id: string;
    type: 'index-note' | 'reindex-note' | 'delete-embeddings' | 'run-agent';
    payload: Record<string, unknown>;
    status: JobStatus;
    attempts: number;
    maxAttempts: number;
    createdAt: Date;
    startedAt?: Date;
    completedAt?: Date;
    error?: string;
    nextRetryAt?: Date;
}

// ==================== Job Queue ====================

/**
 * Simple in-memory job queue with retry support
 * Ready for BullMQ migration
 */
class JobQueue {
    private jobs: Map<string, Job> = new Map();
    private processing: Set<string> = new Set();
    private maxConcurrency: number;
    private retryDelays: number[] = [1000, 5000, 30000, 120000]; // Exponential backoff

    constructor(maxConcurrency: number = 5) {
        this.maxConcurrency = maxConcurrency;
    }

    /**
     * Add a job to the queue
     */
    enqueue(type: Job['type'], payload: Record<string, unknown>): Job {
        const job: Job = {
            id: `job_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
            type,
            payload,
            status: 'pending',
            attempts: 0,
            maxAttempts: 4,
            createdAt: new Date(),
        };

        this.jobs.set(job.id, job);
        console.log(`[Worker] Job enqueued: ${job.id} (${type})`);

        return job;
    }

    /**
     * Get next pending job
     */
    dequeue(): Job | null {
        if (this.processing.size >= this.maxConcurrency) {
            return null;
        }

        for (const [id, job] of this.jobs.entries()) {
            if (job.status === 'pending' && !this.processing.has(id)) {
                job.status = 'processing';
                job.attempts++;
                job.startedAt = new Date();
                this.processing.add(id);
                return job;
            }
        }

        return null;
    }

    /**
     * Mark job as completed
     */
    complete(jobId: string): void {
        const job = this.jobs.get(jobId);
        if (job) {
            job.status = 'completed';
            job.completedAt = new Date();
            this.processing.delete(jobId);
            console.log(`[Worker] Job completed: ${jobId}`);
        }
    }

    /**
     * Mark job as failed and schedule retry
     */
    fail(jobId: string, error: string): void {
        const job = this.jobs.get(jobId);
        if (!job) return;

        if (job.attempts < job.maxAttempts) {
            // Schedule retry with exponential backoff
            job.status = 'retrying';
            const delayIndex = Math.min(job.attempts - 1, this.retryDelays.length - 1);
            const delay = this.retryDelays[delayIndex];
            job.nextRetryAt = new Date(Date.now() + delay);
            job.error = error;

            // Reset to pending after delay
            setTimeout(() => {
                if (job.status === 'retrying') {
                    job.status = 'pending';
                    job.nextRetryAt = undefined;
                }
            }, delay);

            console.log(`[Worker] Job ${jobId} failed, retrying in ${delay}ms (attempt ${job.attempts}/${job.maxAttempts})`);
        } else {
            job.status = 'failed';
            job.error = error;
            console.error(`[Worker] Job ${jobId} permanently failed: ${error}`);
        }

        this.processing.delete(jobId);
    }

    /**
     * Get queue statistics
     */
    getStats(): { pending: number; processing: number; completed: number; failed: number; retrying: number } {
        let pending = 0, completed = 0, failed = 0, retrying = 0;

        for (const job of this.jobs.values()) {
            switch (job.status) {
                case 'pending': pending++; break;
                case 'processing': break;
                case 'completed': completed++; break;
                case 'failed': failed++; break;
                case 'retrying': retrying++; break;
            }
        }

        return {
            pending,
            processing: this.processing.size,
            completed,
            failed,
            retrying,
        };
    }

    /**
     * Get job by ID
     */
    getJob(jobId: string): Job | undefined {
        return this.jobs.get(jobId);
    }
}

// ==================== Job Processors ====================

interface JobProcessor {
    process(job: Job): Promise<void>;
}

class IndexNoteProcessor implements JobProcessor {
    private pipeline = createIndexingPipeline();

    async process(job: Job): Promise<void> {
        const { noteId, content } = job.payload as { noteId: string; content: string };

        console.log(`[Worker] Indexing note: ${noteId}`);
        const startTime = Date.now();

        const result = await this.pipeline.indexNote(noteId, content);

        const duration = Date.now() - startTime;
        console.log(`[Worker] Indexed note ${noteId} in ${duration}ms (chunks: ${result.chunks})`);
    }
}

class DeleteEmbeddingsProcessor implements JobProcessor {
    private pipeline = createIndexingPipeline();

    async process(job: Job): Promise<void> {
        const { noteId } = job.payload as { noteId: string };

        console.log(`[Worker] Deleting embeddings for note: ${noteId}`);
        await this.pipeline.deleteNoteEmbeddings(noteId);
        console.log(`[Worker] Deleted embeddings for note: ${noteId}`);
    }
}

// ==================== Main Worker ====================

class BackgroundWorker {
    private queue: JobQueue;
    private eventBus = getEventBus();
    private processors: Map<Job['type'], JobProcessor>;
    private running: boolean = false;
    private pollInterval: number;

    constructor() {
        this.queue = new JobQueue(5);
        this.pollInterval = 1000; // Poll every second

        this.processors = new Map([
            ['index-note', new IndexNoteProcessor()],
            ['reindex-note', new IndexNoteProcessor()],
            ['delete-embeddings', new DeleteEmbeddingsProcessor()],
        ]);
    }

    /**
     * Subscribe to events that trigger jobs
     */
    subscribeToEvents(): void {
        // Subscribe to note created event
        this.eventBus.subscribe('note:created', async (event) => {
            const payload = event.payload as { noteId: string; title: string };

            // Fetch full content from vault (would be passed in real implementation)
            const content = `${payload.title}\n\nIndexed from event`;

            this.queue.enqueue('index-note', {
                noteId: payload.noteId,
                content,
            });
        });

        // Subscribe to note updated event
        this.eventBus.subscribe('note:updated', async (event) => {
            const payload = event.payload as { noteId: string };

            this.queue.enqueue('reindex-note', {
                noteId: payload.noteId,
                content: 'Reindexed content',
            });
        });

        // Subscribe to note deleted event
        this.eventBus.subscribe('note:deleted', async (event) => {
            const payload = event.payload as { noteId: string };

            this.queue.enqueue('delete-embeddings', {
                noteId: payload.noteId,
            });
        });

        console.log('[Worker] Subscribed to events');
    }

    /**
     * Start processing jobs
     */
    start(): void {
        this.running = true;
        this.subscribeToEvents();

        console.log(`
╔═══════════════════════════════════════════════════╗
║   SmartNotes Background Worker                   ║
║   Processing async jobs...                        ║
╚═══════════════════════════════════════════════════╝
    `);

        // Main processing loop
        const processLoop = async () => {
            while (this.running) {
                // Try to dequeue and process jobs
                let job = this.queue.dequeue();

                while (job && this.running) {
                    try {
                        const processor = this.processors.get(job.type);
                        if (processor) {
                            await processor.process(job);
                            this.queue.complete(job.id);
                        } else {
                            console.error(`[Worker] No processor for job type: ${job.type}`);
                            this.queue.fail(job.id, `Unknown job type: ${job.type}`);
                        }
                    } catch (error) {
                        this.queue.fail(job.id, error instanceof Error ? error.message : 'Unknown error');
                    }

                    job = this.queue.dequeue();
                }

                // Log stats periodically
                const stats = this.queue.getStats();
                if (stats.pending > 0 || stats.processing > 0) {
                    console.log(`[Worker] Queue stats:`, stats);
                }

                // Wait before next poll
                await new Promise(resolve => setTimeout(resolve, this.pollInterval));
            }
        };

        processLoop();
    }

    /**
     * Stop the worker
     */
    stop(): void {
        this.running = false;
        console.log('[Worker] Stopped');
    }

    /**
     * Get worker statistics
     */
    getStats() {
        return this.queue.getStats();
    }
}

// ==================== Entry Point ====================

const worker = new BackgroundWorker();

// Handle graceful shutdown
process.on('SIGTERM', () => {
    console.log('[Worker] Shutting down...');
    worker.stop();
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('[Worker] Shutting down...');
    worker.stop();
    process.exit(0);
});

// Start the worker
worker.start();
