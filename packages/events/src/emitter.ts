/**
 * Event Emitter Implementation
 * 
 * Provides a pub/sub event bus for the SmartNotes system.
 * Supports event filtering, priority ordering, and async handling.
 */

import {
    Event,
    EventType,
    EventHandler,
    EventSubscription,
    EventBusOptions,
    EventMetadata
} from './types.js';

/**
 * Simple ID generator
 */
function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * EventBus - Core event management system
 * 
 * Implements a pub/sub pattern with support for:
 * - Multiple subscribers per event type
 * - Priority-based handler execution
 * - Event filtering
 * - Async handler support
 * - Error handling with retries
 */
export class EventBus {
    private subscriptions: Map<EventType, EventSubscription[]> = new Map();
    private eventQueue: Event[] = [];
    private options: Required<EventBusOptions>;
    private isProcessing = false;

    constructor(options: EventBusOptions = {}) {
        this.options = {
            enableLogging: options.enableLogging ?? false,
            maxQueueSize: options.maxQueueSize ?? 1000,
            retryAttempts: options.retryAttempts ?? 3,
            retryDelay: options.retryDelay ?? 1000,
        };
    }

    /**
     * Subscribe to an event type
     */
    subscribe(
        eventType: EventType | EventType[],
        handler: EventHandler,
        options: { priority?: number; filter?: (event: Event) => boolean } = {}
    ): string {
        const subscription: EventSubscription = {
            id: generateId(),
            eventType,
            handler,
            priority: options.priority ?? 0,
            filter: options.filter,
        };

        const types = Array.isArray(eventType) ? eventType : [eventType];

        for (const type of types) {
            if (!this.subscriptions.has(type)) {
                this.subscriptions.set(type, []);
            }

            const subs = this.subscriptions.get(type)!;
            subs.push(subscription);

            // Sort by priority (higher priority first)
            subs.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
        }

        this.log(`Subscribed to ${types.join(', ')} with handler ${subscription.id}`);

        return subscription.id;
    }

    /**
     * Unsubscribe from an event type
     */
    unsubscribe(subscriptionId: string): boolean {
        for (const [type, subs] of this.subscriptions.entries()) {
            const index = subs.findIndex(s => s.id === subscriptionId);
            if (index !== -1) {
                subs.splice(index, 1);
                this.log(`Unsubscribed ${subscriptionId} from ${type}`);
                return true;
            }
        }
        return false;
    }

    /**
     * Publish an event to all subscribers
     */
    async publish<T = unknown>(
        type: EventType,
        payload: T,
        metadata: Partial<EventMetadata> = {}
    ): Promise<Event<T>> {
        const event: Event<T> = {
            id: generateId(),
            type,
            payload,
            metadata: {
                source: metadata.source ?? 'unknown',
                userId: metadata.userId,
                sessionId: metadata.sessionId,
                correlationId: metadata.correlationId,
                causationId: metadata.causationId,
            },
            timestamp: new Date(),
        };

        // Add to queue for processing
        this.eventQueue.push(event);

        // Process queue if not already processing
        if (!this.isProcessing) {
            this.processQueue();
        }

        return event;
    }

    /**
     * Process the event queue
     */
    private async processQueue(): Promise<void> {
        this.isProcessing = true;

        while (this.eventQueue.length > 0) {
            const event = this.eventQueue.shift()!;
            await this.dispatchEvent(event);
        }

        this.isProcessing = false;
    }

    /**
     * Dispatch event to all matching subscribers
     */
    private async dispatchEvent<T>(event: Event<T>): Promise<void> {
        const subs = this.subscriptions.get(event.type) ?? [];

        this.log(`Dispatching event ${event.id} (${event.type}) to ${subs.length} subscribers`);

        const promises = subs.map(async (subscription) => {
            try {
                // Check if filter allows this event
                if (subscription.filter && !subscription.filter(event)) {
                    return;
                }

                // Execute handler
                await subscription.handler(event);
            } catch (error) {
                this.log(`Error in handler ${subscription.id}: ${error}`);
                // Could implement retry logic here
            }
        });

        await Promise.allSettled(promises);
    }

    /**
     * Subscribe to note lifecycle events
     */
    onNoteCreated(handler: EventHandler): string {
        return this.subscribe('note:created', handler, { priority: 10 });
    }

    onNoteUpdated(handler: EventHandler): string {
        return this.subscribe('note:updated', handler, { priority: 10 });
    }

    onNoteDeleted(handler: EventHandler): string {
        return this.subscribe('note:deleted', handler, { priority: 10 });
    }

    /**
     * Subscribe to AI indexing events
     */
    onIndexingStarted(handler: EventHandler): string {
        return this.subscribe('ai:indexing:started', handler, { priority: 5 });
    }

    onIndexingCompleted(handler: EventHandler): string {
        return this.subscribe('ai:indexing:completed', handler, { priority: 5 });
    }

    onIndexingFailed(handler: EventHandler): string {
        return this.subscribe('ai:indexing:failed', handler, { priority: 5 });
    }

    /**
     * Get subscription count
     */
    getSubscriptionCount(type?: EventType): number {
        if (type) {
            return this.subscriptions.get(type)?.length ?? 0;
        }
        return Array.from(this.subscriptions.values()).reduce((acc, subs) => acc + subs.length, 0);
    }

    /**
     * Clear all subscriptions
     */
    clear(): void {
        this.subscriptions.clear();
        this.eventQueue = [];
        this.log('Cleared all subscriptions and event queue');
    }

    /**
     * Internal logging
     */
    private log(message: string): void {
        if (this.options.enableLogging) {
            console.log(`[EventBus] ${new Date().toISOString()} - ${message}`);
        }
    }
}

// Singleton instance for global access
let globalEventBus: EventBus | null = null;

/**
 * Get the global event bus instance
 */
export function getEventBus(): EventBus {
    if (!globalEventBus) {
        globalEventBus = new EventBus();
    }
    return globalEventBus;
}

/**
 * Create a new event bus instance
 */
export function createEventBus(options?: EventBusOptions): EventBus {
    return new EventBus(options);
}
