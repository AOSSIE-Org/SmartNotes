import { describe, it, expect, vi } from "vitest";
import { EmbeddingService } from "../embeddings.js";
import type { EmbedFn } from "../embeddings.js";
import type { TextChunk } from "../types.js";

/** Mock that generates deterministic vectors from text via char codes. */
function createMockEmbedFn(dimensions: number = 384): EmbedFn {
    return async (texts: string[]): Promise<number[][]> => {
        return texts.map((text) => {
            const vector = new Array(dimensions).fill(0);
            for (let i = 0; i < text.length; i++) {
                vector[i % dimensions] += text.charCodeAt(i) / 1000;
            }
            const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
            return norm > 0 ? vector.map((v) => v / norm) : vector;
        });
    };
}

describe("EmbeddingService", () => {
    describe("constructor", () => {
        it("uses default config when none provided", () => {
            const service = new EmbeddingService({}, createMockEmbedFn());
            expect(service.modelId).toBe("Xenova/all-MiniLM-L6-v2");
        });

        it("accepts custom config", () => {
            const service = new EmbeddingService(
                { modelId: "custom/model", maxTokenLength: 512 },
                createMockEmbedFn(),
            );
            expect(service.modelId).toBe("custom/model");
        });
    });

    describe("embed", () => {
        it("throws if not initialized and no custom embedFn", async () => {
            const service = new EmbeddingService();
            await expect(service.embed(["test"])).rejects.toThrow(
                "EmbeddingService not initialized",
            );
        });

        it("works immediately with injected embedFn", async () => {
            const service = new EmbeddingService({}, createMockEmbedFn());
            const result = await service.embed(["hello world"]);

            expect(result).toHaveLength(1);
            expect(result[0]).toHaveLength(384);
        });

        it("returns empty array for empty input", async () => {
            const service = new EmbeddingService({}, createMockEmbedFn());
            expect(await service.embed([])).toEqual([]);
        });

        it("produces different vectors for different texts", async () => {
            const service = new EmbeddingService({}, createMockEmbedFn());
            const results = await service.embed(["hello", "goodbye"]);

            expect(results).toHaveLength(2);
            const areDifferent = results[0].some(
                (v, i) => Math.abs(v - results[1][i]) > 0.001,
            );
            expect(areDifferent).toBe(true);
        });

        it("is deterministic for the same input", async () => {
            const service = new EmbeddingService({}, createMockEmbedFn());
            const a = await service.embed(["test text"]);
            const b = await service.embed(["test text"]);
            expect(a[0]).toEqual(b[0]);
        });

        it("truncates long texts based on maxTokenLength", async () => {
            const spy = vi.fn(createMockEmbedFn());
            const service = new EmbeddingService(
                { modelId: "test", maxTokenLength: 10 },
                spy,
            );

            await service.embed(["a".repeat(100)]);
            // 10 tokens * 4 chars = 40 char max
            expect(spy.mock.calls[0][0][0].length).toBe(40);
        });
    });

    describe("embedSingle", () => {
        it("returns a single vector", async () => {
            const service = new EmbeddingService({}, createMockEmbedFn());
            const vector = await service.embedSingle("hello");

            expect(vector).toHaveLength(384);
            expect(Array.isArray(vector)).toBe(true);
        });
    });

    describe("embedChunks", () => {
        it("preserves original chunk metadata", async () => {
            const service = new EmbeddingService({}, createMockEmbedFn());
            const chunks: TextChunk[] = [
                { id: "n1:0", noteId: "n1", content: "Hello world", chunkIndex: 0 },
                { id: "n1:1", noteId: "n1", content: "Goodbye world", chunkIndex: 1 },
            ];

            const results = await service.embedChunks(chunks);

            expect(results).toHaveLength(2);
            expect(results[0].chunk).toEqual(chunks[0]);
            expect(results[0].vector).toHaveLength(384);
        });

        it("prepends heading to content when available", async () => {
            const spy = vi.fn(createMockEmbedFn());
            const service = new EmbeddingService({}, spy);

            await service.embedChunks([
                {
                    id: "n1:0",
                    noteId: "n1",
                    content: "Some details",
                    heading: "Introduction",
                    chunkIndex: 0,
                },
            ]);
            expect(spy.mock.calls[0][0][0]).toBe("Introduction: Some details");
        });

        it("returns empty for empty input", async () => {
            const service = new EmbeddingService({}, createMockEmbedFn());
            expect(await service.embedChunks([])).toEqual([]);
        });
    });

    describe("initialize", () => {
        it("is a no-op when custom embedFn is provided", async () => {
            const service = new EmbeddingService({}, createMockEmbedFn());
            await expect(service.initialize()).resolves.toBeUndefined();
        });
    });
});
