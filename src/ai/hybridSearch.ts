import type { TextChunk, SearchResult, HybridSearchResult, HybridSearchOptions } from "./types.js";
import { DEFAULT_HYBRID_SEARCH_OPTIONS } from "./types.js";
import { SemanticSearchService } from "./semanticSearch.js";
import { KeywordSearchEngine } from "./keywordSearch.js";

export function reciprocalRankFusion(
    rankedLists: Array<{ results: SearchResult[]; weight: number }>,
    k: number = 60,
): HybridSearchResult[] {
    const fused = new Map<string, { chunk: TextChunk; score: number; fusionScore: number }>();

    for (const { results, weight } of rankedLists) {
        for (let rank = 0; rank < results.length; rank++) {
            const item = results[rank];
            const rrfScore = weight / (k + rank + 1);

            const existing = fused.get(item.chunk.id);
            if (existing) {
                existing.fusionScore += rrfScore;
            } else {
                fused.set(item.chunk.id, {
                    chunk: item.chunk,
                    score: item.score,
                    fusionScore: rrfScore,
                });
            }
        }
    }

    return Array.from(fused.values())
        .sort((a, b) => b.fusionScore - a.fusionScore)
        .map(({ chunk, score, fusionScore }) => ({ chunk, score, fusionScore }));
}

export class HybridSearchService {
    private semanticSearch: SemanticSearchService;
    private keywordEngine: KeywordSearchEngine;

    constructor(
        semanticSearch: SemanticSearchService,
        keywordEngine: KeywordSearchEngine,
    ) {
        this.semanticSearch = semanticSearch;
        this.keywordEngine = keywordEngine;
    }

    async initialize(): Promise<void> {
        await this.semanticSearch.initialize();
        this.rebuildKeywordIndex();
    }

    async indexNote(noteId: string, content: string): Promise<number> {
        const chunkCount = await this.semanticSearch.indexNote(noteId, content);
        const chunks = this.semanticSearch.chunkFn(noteId, content);
        this.keywordEngine.removeByNoteId(noteId);
        this.keywordEngine.indexChunks(chunks);
        return chunkCount;
    }

    removeNote(noteId: string): number {
        const removed = this.semanticSearch.removeNote(noteId);
        this.keywordEngine.removeByNoteId(noteId);
        return removed;
    }

    async search(
        query: string,
        options: Partial<HybridSearchOptions> = {},
    ): Promise<HybridSearchResult[]> {
        const opts = { ...DEFAULT_HYBRID_SEARCH_OPTIONS, ...options };
        const broadK = opts.topK * 3;

        const [semanticResults, keywordResults] = await Promise.all([
            this.semanticSearch.search(query, {
                topK: broadK,
                minScore: 0,
                noteId: opts.noteId,
            }),
            Promise.resolve(this.keywordEngine.search(query, broadK)),
        ]);

        const filteredKeyword = opts.noteId
            ? keywordResults.filter((r) => r.chunk.noteId === opts.noteId)
            : keywordResults;

        const fused = reciprocalRankFusion(
            [
                { results: semanticResults, weight: opts.semanticWeight },
                { results: filteredKeyword, weight: opts.keywordWeight },
            ],
            opts.rrfK,
        );

        return fused.slice(0, opts.topK);
    }

    async save(): Promise<void> {
        await this.semanticSearch.save();
    }

    get indexSize(): number {
        return this.semanticSearch.indexSize;
    }

    private rebuildKeywordIndex(): void {
        this.keywordEngine.clear();
        const chunks = this.semanticSearch.getAllChunks();
        if (chunks.length > 0) {
            this.keywordEngine.indexChunks(chunks);
        }
    }
}
