import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SemanticSearchService, defaultChunker } from "../semanticSearch.js";
import { EmbeddingService } from "../embeddings.js";
import { VectorStore } from "../vectorStore.js";
import type { EmbedFn } from "../embeddings.js";
import type { TextChunk } from "../types.js";

/**
 * Mock embeddings that put similar topics near each other in vector space.
 * ML/AI content clusters around dimensions 0-1, cooking around 2-3, etc.
 */
function createSemanticMockEmbedFn(dimensions: number = 384): EmbedFn {
    return async (texts: string[]): Promise<number[][]> => {
        return texts.map((text) => {
            const vector = new Array(dimensions).fill(0);
            const lower = text.toLowerCase();

            if (lower.includes("machine learning") || lower.includes("neural")) { vector[0] = 0.8; vector[1] = 0.5; }
            if (lower.includes("cooking") || lower.includes("recipe")) { vector[2] = 0.8; vector[3] = 0.5; }
            if (lower.includes("typescript") || lower.includes("javascript")) { vector[4] = 0.8; vector[5] = 0.5; }
            if (lower.includes("ai") || lower.includes("artificial")) { vector[0] = 0.6; vector[6] = 0.7; }

            vector[10] = text.length / 1000;

            const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
            return norm > 0 ? vector.map((v) => v / norm) : vector;
        });
    };
}

describe("defaultChunker", () => {
    it("splits text by double newlines", () => {
        const chunks = defaultChunker("n1", "paragraph one\n\nparagraph two");
        expect(chunks).toHaveLength(2);
        expect(chunks[0].content).toBe("paragraph one");
        expect(chunks[1].content).toBe("paragraph two");
    });

    it("assigns correct IDs and indices", () => {
        const chunks = defaultChunker("my-note", "a\n\nb\n\nc");
        expect(chunks[0].id).toBe("my-note:0");
        expect(chunks[1].id).toBe("my-note:1");
        expect(chunks[2].id).toBe("my-note:2");
        expect(chunks.every((c) => c.noteId === "my-note")).toBe(true);
    });

    it("filters out empty paragraphs", () => {
        const chunks = defaultChunker("n1", "text\n\n\n\n\n\nmore text");
        expect(chunks).toHaveLength(2);
    });

    it("returns empty array for empty/whitespace content", () => {
        expect(defaultChunker("n1", "")).toEqual([]);
        expect(defaultChunker("n1", "   ")).toEqual([]);
    });
});

describe("SemanticSearchService", () => {
    let tempDir: string;
    let service: SemanticSearchService;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), "smartnotes-ss-"));

        const embeddingService = new EmbeddingService(
            {},
            createSemanticMockEmbedFn(),
        );
        const vectorStore = new VectorStore({
            persistDir: tempDir,
            indexFilename: "search-index.json",
        });

        service = new SemanticSearchService(embeddingService, vectorStore);
        await service.initialize();
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    describe("indexNote", () => {
        it("indexes a note and reports chunk count", async () => {
            const count = await service.indexNote(
                "n1",
                "First paragraph about machine learning.\n\n" +
                "Second paragraph about neural networks.",
            );
            expect(count).toBe(2);
            expect(service.indexSize).toBe(2);
        });

        it("replaces old chunks when re-indexing", async () => {
            await service.indexNote("n1", "old content\n\nmore old content");
            expect(service.indexSize).toBe(2);

            await service.indexNote("n1", "new single paragraph");
            expect(service.indexSize).toBe(1);
        });

        it("handles empty notes", async () => {
            expect(await service.indexNote("n1", "")).toBe(0);
        });
    });

    describe("search", () => {
        beforeEach(async () => {
            await service.indexNote(
                "ml-note",
                "Introduction to machine learning and neural networks.\n\n" +
                "Deep learning is a subset of machine learning.",
            );
            await service.indexNote(
                "cooking-note",
                "A delicious pasta recipe for dinner.\n\n" +
                "Cooking tips and kitchen techniques.",
            );
            await service.indexNote(
                "ts-note",
                "TypeScript fundamentals and type safety.\n\n" +
                "Advanced JavaScript patterns.",
            );
        });

        it("ranks relevant results higher", async () => {
            const results = await service.search("machine learning AI");
            expect(results.length).toBeGreaterThan(0);
            expect(results[0].chunk.noteId).toBe("ml-note");
        });

        it("respects topK option", async () => {
            const results = await service.search("general topic", {
                topK: 2,
                minScore: 0,
            });
            expect(results.length).toBeLessThanOrEqual(2);
        });

        it("filters by noteId", async () => {
            const results = await service.search("any query", {
                noteId: "cooking-note",
                minScore: 0,
            });
            // Assert non-empty first — results.every() is vacuously true on []
            expect(results.length).toBeGreaterThan(0);
            expect(results.every((r) => r.chunk.noteId === "cooking-note")).toBe(true);
        });

        it("returns empty when nothing meets minScore", async () => {
            const results = await service.search("completely unrelated xyz", {
                minScore: 0.99,
            });
            expect(results).toHaveLength(0);
        });
    });

    describe("removeNote", () => {
        it("removes a note from the index", async () => {
            await service.indexNote("n1", "some content\n\nmore content");
            expect(service.removeNote("n1")).toBe(2);
            expect(service.indexSize).toBe(0);
        });
    });

    describe("findRelatedNotes", () => {
        it("finds notes with similar content", async () => {
            await service.indexNote("ml-intro", "Introduction to machine learning.");
            await service.indexNote("ml-advanced", "Advanced machine learning and neural networks.");
            await service.indexNote("cooking", "How to make the perfect pasta recipe.");

            const related = await service.findRelatedNotes("ml-intro", 5);
            const noteIds = related.map((r) => r.chunk.noteId);

            // Unconditional — must return results, not guarded by if()
            expect(related.length).toBeGreaterThan(0);
            expect(noteIds).toContain("ml-advanced");
            expect(noteIds).not.toContain("cooking");
        });
    });

    describe("isNoteIndexed", () => {
        it("returns true for indexed notes", async () => {
            await service.indexNote("n1", "some content");
            expect(service.isNoteIndexed("n1")).toBe(true);
            expect(service.isNoteIndexed("n2")).toBe(false);
        });
    });

    describe("persistence", () => {
        it("saves and restores the index across instances", async () => {
            await service.indexNote("n1", "content about machine learning");
            await service.save();

            const service2 = new SemanticSearchService(
                new EmbeddingService({}, createSemanticMockEmbedFn()),
                new VectorStore({
                    persistDir: tempDir,
                    indexFilename: "search-index.json",
                }),
            );
            await service2.initialize();

            expect(service2.indexSize).toBe(1);
            expect(service2.isNoteIndexed("n1")).toBe(true);
        });
    });

    describe("custom chunker", () => {
        it("accepts a custom chunk function", async () => {
            const singleChunker = (noteId: string, content: string): TextChunk[] => [
                { id: `${noteId}:custom`, noteId, content, chunkIndex: 0 },
            ];

            const customService = new SemanticSearchService(
                new EmbeddingService({}, createSemanticMockEmbedFn()),
                new VectorStore({
                    persistDir: tempDir,
                    indexFilename: "custom-index.json",
                }),
                singleChunker,
            );
            await customService.initialize();

            // singleChunker always returns one chunk regardless of content
            expect(await customService.indexNote("n1", "hello\n\nworld")).toBe(1);
        });
    });
});
