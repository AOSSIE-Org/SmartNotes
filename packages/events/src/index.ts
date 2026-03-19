/**
 * Events Package - Main Entry Point
 * 
 * @smartnotes/events provides the event-driven architecture
 * for note lifecycle management and AI pipeline integration.
 */

export * from './types.js';
export * from './emitter.js';

// Re-export commonly used items
export type { EventBus } from './emitter.js';
