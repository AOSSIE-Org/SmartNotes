import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VectorStore, cosineSimilarity } from "../vectorStore.js";
import type { EmbeddedChunk, VectorStoreConfig } from "../types.js";

function makeChunk(
    noteId: string,
    index: number,
    vector: number[],
): EmbeddedChunk {
    return {
        chunk: {
            id: `${noteId}:${index}`,
            noteId,
            content: `Chunk ${index} of note ${noteId}`,
            chunkIndex: index,
        },
        vector,
    };
}

function unitVector(angle: number): number[] {
    return [Math.cos(angle), Math.sin(angle), 0];
}

describe("cosineSimilarity", () => {
    it("returns 1 for identical vectors", () => {
        expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1.0);
    });

    it("returns 0 for orthogonal vectors", () => {
        expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0.0);
    });

    it("returns -1 for opposite vectors", () => {
        expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0);
    });

    it("handles non-unit vectors", () => {
        expect(cosineSimilarity([2, 0, 0], [3, 0, 0])).toBeCloseTo(1.0);
    });

    it("returns 0 for zero vectors", () => {
        expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    });

    it("throws for mismatched dimensions", () => {
        expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow(
            "Vector dimension mismatch",
        );
    });
});

describe("VectorStore", () => {
    let tempDir: string;
    let config: VectorStoreConfig;
    let store: VectorStore;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), "smartnotes-vs-"));
        config = { persistDir: tempDir, indexFilename: "test-index.json" };
        store = new VectorStore(config);
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    describe("add and search", () => {
        it("finds added chunks by similarity", () => {
            store.add([
                makeChunk("n1", 0, [1, 0, 0]),
                makeChunk("n2", 0, [0, 1, 0]),
            ]);

            const results = store.search([1, 0, 0], 10, 0);
            expect(results).toHaveLength(2);
            expect(results[0].chunk.noteId).toBe("n1");
            expect(results[0].score).toBeCloseTo(1.0);
        });

        it("respects minScore threshold", () => {
            store.add([
                makeChunk("n1", 0, [1, 0, 0]),
                makeChunk("n2", 0, [0, 1, 0]),
            ]);

            const results = store.search([1, 0, 0], 10, 0.5);
            expect(results).toHaveLength(1);
        });

        it("respects topK limit", () => {
            store.add([
                makeChunk("n1", 0, [1, 0, 0]),
                makeChunk("n2", 0, [0.9, 0.1, 0]),
                makeChunk("n3", 0, [0.8, 0.2, 0]),
            ]);

            expect(store.search([1, 0, 0], 2, 0)).toHaveLength(2);
        });

        it("filters by noteId", () => {
            store.add([
                makeChunk("n1", 0, [1, 0, 0]),
                makeChunk("n1", 1, [0.9, 0.1, 0]),
                makeChunk("n2", 0, [0.95, 0.05, 0]),
            ]);

            const results = store.search([1, 0, 0], 10, 0, "n1");
            expect(results).toHaveLength(2);
            expect(results.every((r) => r.chunk.noteId === "n1")).toBe(true);
        });

        it("overwrites chunks with the same ID", () => {
            store.add([makeChunk("n1", 0, [1, 0, 0])]);
            store.add([makeChunk("n1", 0, [0, 1, 0])]);

            expect(store.size).toBe(1);
            const results = store.search([0, 1, 0], 1, 0);
            expect(results[0].score).toBeCloseTo(1.0);
        });
    });

    describe("removeByNoteId", () => {
        it("removes all chunks for a note", () => {
            store.add([
                makeChunk("n1", 0, [1, 0, 0]),
                makeChunk("n1", 1, [0.9, 0.1, 0]),
                makeChunk("n2", 0, [0, 1, 0]),
            ]);

            expect(store.removeByNoteId("n1")).toBe(2);
            expect(store.size).toBe(1);
        });

        it("returns 0 for unknown note", () => {
            store.add([makeChunk("n1", 0, [1, 0, 0])]);
            expect(store.removeByNoteId("nonexistent")).toBe(0);
        });
    });

    describe("findRelated", () => {
        it("finds related chunks, excluding the query chunk", () => {
            store.add([
                makeChunk("n1", 0, unitVector(0)),
                makeChunk("n2", 0, unitVector(0.2)),
                makeChunk("n3", 0, unitVector(Math.PI / 2)),
            ]);

            const results = store.findRelated("n1:0", 5, 0);
            expect(results).toHaveLength(2);
            expect(results.every((r) => r.chunk.id !== "n1:0")).toBe(true);
            expect(results[0].chunk.id).toBe("n2:0");
        });

        it("returns empty for unknown chunk", () => {
            expect(store.findRelated("unknown:0")).toEqual([]);
        });
    });

    describe("persistence", () => {
        it("round-trips save and load", async () => {
            store.add([
                makeChunk("n1", 0, [1, 0, 0]),
                makeChunk("n2", 0, [0, 1, 0]),
            ]);
            await store.save();

            const store2 = new VectorStore(config);
            expect(await store2.load()).toBe(true);
            expect(store2.size).toBe(2);

            const results = store2.search([1, 0, 0], 1, 0);
            expect(results[0].chunk.noteId).toBe("n1");
        });

        it("returns false when no file exists", async () => {
            expect(await store.load()).toBe(false);
        });

        it("skips write when nothing changed", async () => {
            store.add([makeChunk("n1", 0, [1, 0, 0])]);
            await store.save();
            await store.save(); // second save should be no-op

            const content = await readFile(
                join(tempDir, "test-index.json"),
                "utf-8",
            );
            const data = JSON.parse(content);
            expect(data.version).toBe(1);
            expect(data.entries).toHaveLength(1);
        });

        it("creates directories recursively", async () => {
            const nestedStore = new VectorStore({
                persistDir: join(tempDir, "deep", "nested", "dir"),
                indexFilename: "index.json",
            });
            nestedStore.add([makeChunk("n1", 0, [1, 0, 0])]);
            await expect(nestedStore.save()).resolves.toBeUndefined();
        });
    });

    describe("utility methods", () => {
        it("tracks indexed note IDs", () => {
            store.add([
                makeChunk("n1", 0, [1, 0, 0]),
                makeChunk("n1", 1, [0.9, 0.1, 0]),
                makeChunk("n2", 0, [0, 1, 0]),
            ]);

            const noteIds = store.getIndexedNoteIds();
            expect(noteIds.size).toBe(2);
            expect(noteIds.has("n1")).toBe(true);
            expect(noteIds.has("n2")).toBe(true);
        });

        it("checks if a note is indexed", () => {
            store.add([makeChunk("n1", 0, [1, 0, 0])]);
            expect(store.hasNote("n1")).toBe(true);
            expect(store.hasNote("n2")).toBe(false);
        });

        it("clears all entries", () => {
            store.add([makeChunk("n1", 0, [1, 0, 0])]);
            store.clear();
            expect(store.size).toBe(0);
        });
    });
});
