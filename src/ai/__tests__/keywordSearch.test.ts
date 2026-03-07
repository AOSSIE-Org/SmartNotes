import { describe, it, expect, beforeEach } from "vitest";
import { KeywordSearchEngine, tokenize } from "../keywordSearch.js";
import type { TextChunk } from "../types.js";


function makeChunk(noteId: string, index: number, content: string): TextChunk {
    return { id: `${noteId}:${index}`, noteId, content, chunkIndex: index };
}


describe("tokenize", () => {
    it("lowercases and splits on non-word characters", () => {
        expect(tokenize("Hello, World!")).toEqual(["hello", "world"]);
    });

    it("removes stop words", () => {
        const tokens = tokenize("the cat is a mammal");
        expect(tokens).toContain("cat");
        expect(tokens).toContain("mammal");
        expect(tokens).not.toContain("the");
        expect(tokens).not.toContain("is");
        expect(tokens).not.toContain("a");
    });

    it("returns empty array for empty input", () => {
        expect(tokenize("")).toEqual([]);
    });

    it("returns empty array when all tokens are stop words", () => {
        expect(tokenize("the is a an")).toEqual([]);
    });
});


describe("KeywordSearchEngine", () => {
    let engine: KeywordSearchEngine;

    beforeEach(() => {
        engine = new KeywordSearchEngine();
    });

    describe("indexChunks + search", () => {
        it("returns the indexed chunk for a matching query", () => {
            engine.indexChunks([makeChunk("n1", 0, "machine learning is fascinating")]);
            const results = engine.search("machine learning");
            expect(results).toHaveLength(1);
            expect(results[0].chunk.noteId).toBe("n1");
            expect(results[0].score).toBeGreaterThan(0);
        });

        it("returns empty array when nothing matches", () => {
            engine.indexChunks([makeChunk("n1", 0, "pasta and cooking recipes")]);
            expect(engine.search("quantum physics")).toEqual([]);
        });

        it("ranks the doc with more matching terms higher", () => {
            engine.indexChunks([
                makeChunk("n1", 0, "neural networks"),
                makeChunk("n2", 0, "neural networks deep learning machine learning"),
            ]);
            const results = engine.search("neural networks machine learning");
            expect(results.length).toBe(2);
            expect(results[0].chunk.noteId).toBe("n2");
        });

        it("handles partial query matches — returns docs with any matching term", () => {
            engine.indexChunks([
                makeChunk("n1", 0, "apple orange banana"),
                makeChunk("n2", 0, "quantum gravity"),
            ]);
            const results = engine.search("apple quantum");
            // Both docs should appear since each matches one term
            const noteIds = results.map((r) => r.chunk.noteId);
            expect(noteIds).toContain("n1");
            expect(noteIds).toContain("n2");
        });

        it("respects topK limit", () => {
            for (let i = 0; i < 10; i++) {
                engine.indexChunks([makeChunk(`n${i}`, 0, "machine learning ai")]);
            }
            const results = engine.search("machine", 3);
            expect(results.length).toBeLessThanOrEqual(3);
        });

        it("returns empty array on empty index", () => {
            expect(engine.search("anything")).toEqual([]);
        });
    });

    describe("removeByNoteId", () => {
        it("removes all chunks for a note; subsequent search excludes it", () => {
            engine.indexChunks([
                makeChunk("n1", 0, "machine learning"),
                makeChunk("n1", 1, "deep learning"),
                makeChunk("n2", 0, "machine learning"),
            ]);
            const removed = engine.removeByNoteId("n1");
            expect(removed).toBe(2);

            const results = engine.search("machine learning");
            expect(results.every((r) => r.chunk.noteId !== "n1")).toBe(true);
            expect(results.some((r) => r.chunk.noteId === "n2")).toBe(true);
        });
    });

    describe("clear", () => {
        it("empties the entire index", () => {
            engine.indexChunks([makeChunk("n1", 0, "machine learning")]);
            engine.clear();
            expect(engine.size).toBe(0);
            expect(engine.search("machine")).toEqual([]);
        });
    });

    describe("re-indexing", () => {
        it("updates a chunk when re-indexed with the same id", () => {
            engine.indexChunks([makeChunk("n1", 0, "cooking pasta")]);
            engine.indexChunks([makeChunk("n1", 0, "machine learning")]);
            expect(engine.search("pasta")).toEqual([]);
            expect(engine.search("machine")).toHaveLength(1);
        });
    });
});
