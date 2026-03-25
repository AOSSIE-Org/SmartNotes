import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HybridSearchService, reciprocalRankFusion } from "../hybridSearch.js";
import { KeywordSearchEngine } from "../keywordSearch.js";
import { SemanticSearchService } from "../semanticSearch.js";
import { EmbeddingService } from "../embeddings.js";
import { VectorStore } from "../vectorStore.js";
import type { EmbedFn } from "../embeddings.js";
import type { SearchResult, TextChunk } from "../types.js";

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

let tempDir: string;

async function buildService(embedFn?: EmbedFn) {
    const embeddingService = new EmbeddingService({}, embedFn ?? createMockEmbedFn());
    const vectorStore = new VectorStore({
        persistDir: tempDir,
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
        expect(n2.fusionScore).toBeGreaterThan(n1.fusionScore);
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
        tempDir = await mkdtemp(join(tmpdir(), "smartnotes-hybrid-"));
        service = await buildService();
        await service.initialize();
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    describe("indexNote + search round-trip", () => {
        it("finds a note after indexing", async () => {
            await service.indexNote("n1", "Introduction to machine learning");
            const results = await service.search("machine learning");
            expect(results.length).toBeGreaterThan(0);
            expect(results[0].chunk.noteId).toBe("n1");
        });

        it("returns results from keyword-only match", async () => {
            await service.indexNote("n1", "Quantum entanglement in particle physics");
            const results = await service.search("quantum entanglement");
            expect(results.length).toBeGreaterThan(0);
        });

        it("a note matching both modalities ranks at the top", async () => {
            await service.indexNote("n1", "machine learning neural networks deep learning");
            await service.indexNote("n2", "cooking pasta recipes");
            const results = await service.search("machine learning");
            expect(results[0].chunk.noteId).toBe("n1");
        });
    });

    describe("search options", () => {
        it("respects topK", async () => {
            await service.indexNote("n1", "machine learning basics");
            await service.indexNote("n2", "machine learning advanced");
            await service.indexNote("n3", "machine learning expert");
            const results = await service.search("machine learning", { topK: 2 });
            expect(results.length).toBeLessThanOrEqual(2);
        });

        it("filters results by noteId", async () => {
            await service.indexNote("n1", "machine learning basics");
            await service.indexNote("n2", "machine learning advanced");
            const results = await service.search("machine learning", { noteId: "n1" });
            expect(results.every((r) => r.chunk.noteId === "n1")).toBe(true);
        });

        it("zeroing semanticWeight degrades to keyword-only ranking", async () => {
            await service.indexNote("n1", "machine learning");
            const results = await service.search("machine learning", {
                semanticWeight: 0,
                keywordWeight: 1,
            });
            expect(results.length).toBeGreaterThan(0);
        });

        it("zeroing keywordWeight degrades to semantic-only ranking", async () => {
            await service.indexNote("n1", "machine learning");
            const results = await service.search("machine learning", {
                semanticWeight: 1,
                keywordWeight: 0,
            });
            expect(results.length).toBeGreaterThan(0);
        });
    });

    describe("removeNote", () => {
        it("removed note does not appear in results", async () => {
            await service.indexNote("n1", "machine learning");
            await service.indexNote("n2", "machine learning advanced");
            service.removeNote("n1");
            const results = await service.search("machine learning");
            expect(results.every((r) => r.chunk.noteId !== "n1")).toBe(true);
        });
    });

    describe("empty index", () => {
        it("returns empty array without crashing", async () => {
            const results = await service.search("anything");
            expect(results).toEqual([]);
        });
    });
});
