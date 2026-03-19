/**
 * Event System Type Definitions
 * 
 * Defines the event types and interfaces for the
 * event-driven architecture of SmartNotes.
 */

export type EventType =
    // Note lifecycle events
    | 'note:created'
    | 'note:updated'
    | 'note:deleted'
    | 'note:read'
    // AI events
    | 'ai:indexing:started'
    | 'ai:indexing:completed'
    | 'ai:indexing:failed'
    | 'ai:embedding:generated'
    // Search events
    | 'search:query'
    | 'search:results'
    // Agent events
    | 'agent:triggered'
    | 'agent:completed'
    | 'agent:failed'
    // System events
    | 'system:startup'
    | 'system:shutdown'
    | 'system:error';

export interface Event<T = unknown> {
    id: string;
    type: EventType;
    payload: T;
    metadata: EventMetadata;
    timestamp: Date;
}

export interface EventMetadata {
    correlationId?: string;
    causationId?: string;
    source: string;
    userId?: string;
    sessionId?: string;
}

export interface EventHandler<T = unknown> {
    (event: Event<T>): Promise<void> | void;
}

export interface EventSubscription {
    id: string;
    eventType: EventType | EventType[];
    handler: EventHandler;
    priority?: number;
    filter?: (event: Event) => boolean;
}

export interface EventBusOptions {
    enableLogging?: boolean;
    maxQueueSize?: number;
    retryAttempts?: number;
    retryDelay?: number;
}

// Note-specific event payloads
export interface NoteCreatedPayload {
    noteId: string;
    title: string;
    tags?: string[];
}

export interface NoteUpdatedPayload {
    noteId: string;
    previousVersion?: unknown;
    changes: string[];
}

export interface NoteDeletedPayload {
    noteId: string;
    permanently: boolean;
}

// AI-specific event payloads
export interface IndexingStartedPayload {
    noteId: string;
    content: string;
}

export interface IndexingCompletedPayload {
    noteId: string;
    embeddingDimension: number;
    vectorId?: string;
}

export interface IndexingFailedPayload {
    noteId: string;
    error: string;
}
