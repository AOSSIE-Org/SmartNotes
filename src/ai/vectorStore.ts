// In-memory vector index with cosine similarity search and JSON persistence.
// Pure TypeScript — no native deps, works in Electron without platform builds.
// Brute-force search is fine for personal note collections (< 100K vectors).

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import type {
    TextChunk,
    EmbeddedChunk,
    SearchResult,
    VectorStoreConfig,
    SerializedVectorStore,
} from "./types.js";

const CURRENT_VERSION = 1;

export class VectorStore {
    private entries: Map<string, EmbeddedChunk> = new Map();
    private config: VectorStoreConfig;
    private dirty = false;

    constructor(config: VectorStoreConfig) {
        this.config = config;
    }

    /** Add chunks. Overwrites existing entries with the same ID. */
    add(embeddedChunks: EmbeddedChunk[]): void {
        if (embeddedChunks.length === 0) return;

        const expectedDim =
            this.entries.values().next().value?.vector.length ??
            embeddedChunks[0].vector.length;

        for (const ec of embeddedChunks) {
            if (ec.vector.length !== expectedDim) {
                throw new Error(
                    `VectorStore: expected ${expectedDim}-dim vectors, ` +
                    `got ${ec.vector.length} for chunk "${ec.chunk.id}".`,
                );
            }
        }

        for (const ec of embeddedChunks) {
            this.entries.set(ec.chunk.id, ec);
        }
        this.dirty = true;
    }

    /** Remove all chunks for a note. Returns count removed. */
    removeByNoteId(noteId: string): number {
        let removed = 0;
        for (const [id, entry] of this.entries) {
            if (entry.chunk.noteId === noteId) {
                this.entries.delete(id);
                removed++;
            }
        }
        if (removed > 0) this.dirty = true;
        return removed;
    }

    /** Find the most similar chunks to a query vector. */
    search(
        queryVector: number[],
        topK: number = 10,
        minScore: number = 0.3,
        noteId?: string,
    ): SearchResult[] {
        const results: SearchResult[] = [];

        for (const entry of this.entries.values()) {
            if (noteId && entry.chunk.noteId !== noteId) continue;

            const score = cosineSimilarity(queryVector, entry.vector);
            if (score >= minScore) {
                results.push({ chunk: entry.chunk, score });
            }
        }

        results.sort((a, b) => b.score - a.score);
        return results.slice(0, topK);
    }

    /** Find chunks related to a given chunk (excludes itself). */
    findRelated(
        chunkId: string,
        topK: number = 5,
        minScore: number = 0.4,
    ): SearchResult[] {
        const entry = this.entries.get(chunkId);
        if (!entry) return [];

        const results: SearchResult[] = [];
        for (const other of this.entries.values()) {
            if (other.chunk.id === chunkId) continue;

            const score = cosineSimilarity(entry.vector, other.vector);
            if (score >= minScore) {
                results.push({ chunk: other.chunk, score });
            }
        }

        results.sort((a, b) => b.score - a.score);
        return results.slice(0, topK);
    }

    /** Save to disk as JSON. Skips write if nothing changed. */
    async save(): Promise<void> {
        if (!this.dirty) return;

        const allEntries = Array.from(this.entries.values());
        const serialized: SerializedVectorStore = {
            version: CURRENT_VERSION,
            modelId: this.config.modelId,
            vectorDim: allEntries.length > 0 ? allEntries[0].vector.length : undefined,
            entries: allEntries.map((e) => ({
                chunk: e.chunk,
                vector: e.vector,
            })),
        };

        const filePath = join(this.config.persistDir, this.config.indexFilename);
        const dir = dirname(filePath);
        if (!existsSync(dir)) {
            await mkdir(dir, { recursive: true });
        }

        await writeFile(filePath, JSON.stringify(serialized), "utf-8");
        this.dirty = false;
    }

    /** Load from disk. Returns false if no index file exists. Throws on model mismatch. */
    async load(): Promise<boolean> {
        const filePath = join(this.config.persistDir, this.config.indexFilename);
        if (!existsSync(filePath)) return false;

        const raw = await readFile(filePath, "utf-8");
        let data: SerializedVectorStore;
        try {
            data = JSON.parse(raw);
        } catch {
            throw new Error(
                `VectorStore: failed to parse index file "${filePath}". ` +
                `The file may be corrupted — delete it to rebuild the index.`,
            );
        }

        if (data.version !== CURRENT_VERSION) {
            console.warn(
                `VectorStore: version mismatch (got ${data.version}, ` +
                `expected ${CURRENT_VERSION}). Rebuild recommended.`,
            );
        }

        // Fail fast on model mismatch rather than propagating bad vectors to search.
        if (data.modelId && this.config.modelId && data.modelId !== this.config.modelId) {
            throw new Error(
                `VectorStore: index was built with model "${data.modelId}" ` +
                `but current model is "${this.config.modelId}". ` +
                `Delete the index file to rebuild.`,
            );
        }
        if (data.vectorDim !== undefined && data.entries.length > 0) {
            const actualDim = data.entries[0].vector.length;
            if (actualDim !== data.vectorDim) {
                throw new Error(
                    `VectorStore: index vectorDim mismatch ` +
                    `(stored ${data.vectorDim}, found ${actualDim}). Index may be corrupted.`,
                );
            }
        }

        this.entries.clear();
        for (const entry of data.entries) {
            this.entries.set(entry.chunk.id, {
                chunk: entry.chunk,
                vector: entry.vector,
            });
        }

        this.dirty = false;
        return true;
    }

    get size(): number {
        return this.entries.size;
    }

    getIndexedNoteIds(): Set<string> {
        const noteIds = new Set<string>();
        for (const entry of this.entries.values()) {
            noteIds.add(entry.chunk.noteId);
        }
        return noteIds;
    }

    hasNote(noteId: string): boolean {
        for (const entry of this.entries.values()) {
            if (entry.chunk.noteId === noteId) return true;
        }
        return false;
    }

    /** Return all chunks for a note without any vector math. */
    getChunksByNoteId(noteId: string): TextChunk[] {
        const chunks: TextChunk[] = [];
        for (const entry of this.entries.values()) {
            if (entry.chunk.noteId === noteId) {
                chunks.push(entry.chunk);
            }
        }
        return chunks;
    }

    clear(): void {
        this.entries.clear();
        this.dirty = true;
    }
}

/** Cosine similarity between two vectors. Returns -1 to 1. */
export function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
        throw new Error(
            `Vector dimension mismatch: ${a.length} vs ${b.length}`,
        );
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;

    return dotProduct / denominator;
}
