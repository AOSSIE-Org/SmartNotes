import { describe, it, expect, beforeEach } from "vitest";
import { HybridSearchService, reciprocalRankFusion } from "../hybridSearch.js";
import { KeywordSearchEngine } from "../keywordSearch.js";
import { SemanticSearchService } from "../semanticSearch.js";
import { EmbeddingService } from "../embeddings.js";
import { VectorStore } from "../vectorStore.js";
import type { EmbedFn } from "../embeddings.js";
import type { SearchResult, TextChunk } from "../types.js";


/** Topic-aware mock embedder — mirrors semanticSearch.test.ts convention. */
function createMockEmbedFn(dimensions: number = 384): EmbedFn {
    return async (texts: string[]): Promise<number[][]> => {
        return texts.map((text) => {
            const vector = new Array(dimensions).fill(0);
            const lower = text.toLowerCase();
            if (lower.includes("machine learning") || lower.includes("neural")) {
                vector[0] = 0.8; vector[1] = 0.6;
            }
            if (lower.includes("cooking") || lower.includes("recipe")) {
                vector[2] = 0.8; vector[3] = 0.6;
            }
            if (lower.includes("typescript") || lower.includes("javascript")) {
                vector[4] = 0.8; vector[5] = 0.6;
            }
            const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
            return norm > 0 ? vector.map((v) => v / norm) : vector;
        });
    };
}

function makeResult(noteId: string, chunkIndex: number, score: number): SearchResult {
    const chunk: TextChunk = {
        id: `${noteId}:${chunkIndex}`,
        noteId,
        content: "dummy",
        chunkIndex,
    };
    return { chunk, score };
}

function buildService(embedFn?: EmbedFn) {
    const embeddingService = new EmbeddingService({}, embedFn ?? createMockEmbedFn());
    const vectorStore = new VectorStore({
        persistDir: "/tmp/hybrid-test",
        indexFilename: "test-index.json",
    });
    const semantic = new SemanticSearchService(embeddingService, vectorStore);
    const keyword = new KeywordSearchEngine();
    return new HybridSearchService(semantic, keyword);
}

describe("reciprocalRankFusion", () => {
    it("returns empty for empty inputs", () => {
        expect(reciprocalRankFusion([])).toEqual([]);
        expect(reciprocalRankFusion([{ results: [], weight: 1 }])).toEqual([]);
    });

    it("accumulates scores for items appearing in multiple lists", () => {
        const list1 = [makeResult("n1", 0, 0.9), makeResult("n2", 0, 0.5)];
        const list2 = [makeResult("n2", 0, 0.8), makeResult("n3", 0, 0.4)];
        const fused = reciprocalRankFusion(
            [{ results: list1, weight: 1 }, { results: list2, weight: 1 }],
            60,
        );
        const n2 = fused.find((r) => r.chunk.noteId === "n2")!;
        const n1 = fused.find((r) => r.chunk.noteId === "n1")!;
        expect(n2.score).toBeGreaterThan(n1.score);
    });

    it("includes items from disjoint lists", () => {
        const list1 = [makeResult("n1", 0, 0.9)];
        const list2 = [makeResult("n2", 0, 0.9)];
        const fused = reciprocalRankFusion(
            [{ results: list1, weight: 1 }, { results: list2, weight: 1 }],
        );
        const noteIds = fused.map((r) => r.chunk.noteId);
        expect(noteIds).toContain("n1");
        expect(noteIds).toContain("n2");
    });

    it("respects weights — higher-weight list dominates when items differ", () => {
        // n1 is rank-1 in the low-weight list; n2 is rank-1 in the high-weight list
        const lowWeight = [makeResult("n1", 0, 0.99)];
        const highWeight = [makeResult("n2", 0, 0.99)];
        const fused = reciprocalRankFusion(
            [{ results: lowWeight, weight: 0.1 }, { results: highWeight, weight: 10 }],
            60,
        );
        expect(fused[0].chunk.noteId).toBe("n2");
    });

});

describe("HybridSearchService", () => {
    let service: HybridSearchService;

    beforeEach(async () => {
        service = buildService();
        await service.initialize();
    });

    describe("indexNote + search round-trip", () => {
        it("finds a note after indexing", async () => {
            await service.indexNote("ml-note", "machine learning and neural networks");
            const results = await service.search("machine learning");
            const noteIds = results.map((r) => r.chunk.noteId);
            expect(noteIds).toContain("ml-note");
        });

        it("returns results from keyword-only match", async () => {
            // Index a note whose content won't produce a high semantic score
            // (all zeros in mock embedder), but has exact keyword matches.
            await service.indexNote("kw-note", "zygomorphic floriculture botany");
            const results = await service.search("zygomorphic floriculture", {
                topK: 5,
            });
            const noteIds = results.map((r) => r.chunk.noteId);
            expect(noteIds).toContain("kw-note");
        });

        it("a note matching both modalities ranks at the top", async () => {
            await service.indexNote(
                "both-note",
                "machine learning neural networks deep learning",
            );
            await service.indexNote("kw-only-note", "zygomorphic floriculture exotic");
            const results = await service.search("machine learning");
            expect(results[0].chunk.noteId).toBe("both-note");
        });
    });

    describe("search options", () => {
        beforeEach(async () => {
            await service.indexNote("ml-note", "machine learning and neural networks");
            await service.indexNote("cooking-note", "pasta cooking recipe dinner");
            await service.indexNote("ts-note", "typescript javascript programming");
        });

        it("respects topK", async () => {
            const results = await service.search("general query text", { topK: 2 });
            expect(results.length).toBeLessThanOrEqual(2);
        });

        it("filters results by noteId", async () => {
            const results = await service.search("any query", {
                noteId: "cooking-note",
                topK: 10,
            });
            expect(results.length).toBeGreaterThan(0);
            expect(results.every((r) => r.chunk.noteId === "cooking-note")).toBe(true);
        });

        it("zeroing semanticWeight degrades to keyword-only ranking", async () => {
            const results = await service.search("machine learning", {
                semanticWeight: 0,
                keywordWeight: 1,
                topK: 5,
            });
            const noteIds = results.map((r) => r.chunk.noteId);
            expect(noteIds).toContain("ml-note");
        });

        it("zeroing keywordWeight degrades to semantic-only ranking", async () => {
            const results = await service.search("machine learning", {
                semanticWeight: 1,
                keywordWeight: 0,
                topK: 5,
            });
            expect(results[0].chunk.noteId).toBe("ml-note");
        });
    });

    describe("removeNote", () => {
        it("removed note does not appear in results", async () => {
            await service.indexNote("ml-note", "machine learning neural networks");
            service.removeNote("ml-note");
            const results = await service.search("machine learning", { topK: 10 });
            expect(results.every((r) => r.chunk.noteId !== "ml-note")).toBe(true);
        });
    });

    describe("empty index", () => {
        it("returns empty array without crashing", async () => {
            const results = await service.search("anything");
            expect(results).toEqual([]);
        });
    });
});
