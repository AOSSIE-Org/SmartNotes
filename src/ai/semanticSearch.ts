// High-level semantic search API.
// Pipeline: Notes -> Chunking -> Embedding -> Vector Index -> Search

import type { TextChunk, SearchResult, SearchOptions } from "./types.js";
import { DEFAULT_SEARCH_OPTIONS } from "./types.js";
import { EmbeddingService } from "./embeddings.js";
import { VectorStore } from "./vectorStore.js";

/** Splits a note into chunks. Signature compatible with PR #12's chunker. */
export type ChunkFn = (noteId: string, content: string) => TextChunk[];

/** Simple paragraph-based fallback chunker. */
export function defaultChunker(noteId: string, content: string): TextChunk[] {
    const paragraphs = content
        .split(/\n\n+/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

    return paragraphs.map((text, i) => ({
        id: `${noteId}:${i}`,
        noteId,
        content: text,
        chunkIndex: i,
    }));
}

export class SemanticSearchService {
    private embeddingService: EmbeddingService;
    private vectorStore: VectorStore;
    private chunkFn: ChunkFn;

    constructor(
        embeddingService: EmbeddingService,
        vectorStore: VectorStore,
        chunkFn: ChunkFn = defaultChunker,
    ) {
        this.embeddingService = embeddingService;
        this.vectorStore = vectorStore;
        this.chunkFn = chunkFn;
    }

    /** Load embedding model + persisted index. Call before anything else. */
    async initialize(): Promise<void> {
        await this.embeddingService.initialize();
        await this.vectorStore.load();
    }

    /** Index a note. Replaces any previously indexed chunks for this noteId. */
    async indexNote(noteId: string, content: string): Promise<number> {
        const chunks = this.chunkFn(noteId, content);
        if (chunks.length === 0) {
            this.vectorStore.removeByNoteId(noteId);
            return 0;
        }

        // Embed first — if this throws, the old index is left intact.
        const embeddedChunks = await this.embeddingService.embedChunks(chunks);
        this.vectorStore.removeByNoteId(noteId);
        this.vectorStore.add(embeddedChunks);

        return chunks.length;
    }

    removeNote(noteId: string): number {
        return this.vectorStore.removeByNoteId(noteId);
    }

    /** Search indexed notes with a natural language query. */
    async search(
        query: string,
        options: Partial<SearchOptions> = {},
    ): Promise<SearchResult[]> {
        const opts = { ...DEFAULT_SEARCH_OPTIONS, ...options };
        const queryVector = await this.embeddingService.embedSingle(query);

        return this.vectorStore.search(
            queryVector,
            opts.topK,
            opts.minScore,
            opts.noteId,
        );
    }

    /** Find notes semantically related to a given note, deduplicated by noteId. */
    async findRelatedNotes(
        noteId: string,
        topK: number = 5,
    ): Promise<SearchResult[]> {
        // Map keeps the highest-scoring chunk per note — the old Set approach
        // kept the first hit, which could discard a better score from a later
        // source chunk iteration.
        const bestByNoteId = new Map<string, SearchResult>();

        for (const entry of this.getAllChunksForNote(noteId)) {
            const related = this.vectorStore.findRelated(entry.id, topK * 2, 0.4);
            for (const result of related) {
                if (result.chunk.noteId === noteId) continue;
                const existing = bestByNoteId.get(result.chunk.noteId);
                if (!existing || result.score > existing.score) {
                    bestByNoteId.set(result.chunk.noteId, result);
                }
            }
        }

        return Array.from(bestByNoteId.values())
            .sort((a, b) => b.score - a.score)
            .slice(0, topK);
    }

    async save(): Promise<void> {
        await this.vectorStore.save();
    }

    get indexSize(): number {
        return this.vectorStore.size;
    }

    isNoteIndexed(noteId: string): boolean {
        return this.vectorStore.hasNote(noteId);
    }

    private getAllChunksForNote(noteId: string): TextChunk[] {
        return this.vectorStore.getChunksByNoteId(noteId);
    }
}
