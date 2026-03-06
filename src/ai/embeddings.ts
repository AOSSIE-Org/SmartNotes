// Wraps Hugging Face Transformers.js for on-device text embedding.
// Default model: Xenova/all-MiniLM-L6-v2 (384-dim, runs via ONNX Runtime).

import type { TextChunk, EmbeddingConfig, EmbeddedChunk } from "./types.js";
import { DEFAULT_EMBEDDING_CONFIG } from "./types.js";

// Lazy-import to avoid loading ONNX runtime until actually needed.
let pipelineFn: typeof import("@huggingface/transformers").pipeline | null =
    null;

async function getPipeline() {
    if (!pipelineFn) {
        const module = await import("@huggingface/transformers");
        pipelineFn = module.pipeline;
    }
    return pipelineFn;
}

/** Pluggable embedding function — allows swapping backends or mocking in tests. */
export type EmbedFn = (texts: string[]) => Promise<number[][]>;

export class EmbeddingService {
    private config: EmbeddingConfig;
    private embedFn: EmbedFn | null = null;
    private initPromise: Promise<void> | null = null;

    constructor(
        config: Partial<EmbeddingConfig> = {},
        embedFn?: EmbedFn,
    ) {
        this.config = { ...DEFAULT_EMBEDDING_CONFIG, ...config };
        if (embedFn) {
            this.embedFn = embedFn;
        }
    }

    /** Load and cache the model. No-op if a custom embedFn was provided. */
    async initialize(): Promise<void> {
        if (this.embedFn) return;
        if (this.initPromise) return this.initPromise;

        this.initPromise = (async () => {
            try {
                const pipeline = await getPipeline();
                const extractor = await pipeline(
                    "feature-extraction",
                    this.config.modelId,
                    { dtype: "fp32" },
                );

                this.embedFn = async (texts: string[]): Promise<number[][]> => {
                    const output = await extractor(texts, {
                        pooling: "mean",
                        normalize: true,
                    });
                    return output.tolist() as number[][];
                };
            } catch (error) {
                // Clear so the next initialize() call can retry instead of
                // returning this cached rejected Promise forever.
                this.initPromise = null;
                throw error;
            }
        })();

        return this.initPromise;
    }

    /** Embed multiple texts. Throws if not initialized. */
    async embed(texts: string[]): Promise<number[][]> {
        if (!this.embedFn) {
            throw new Error(
                "EmbeddingService not initialized. Call initialize() first, " +
                "or provide a custom embedFn in the constructor.",
            );
        }
        if (texts.length === 0) return [];

        // ~4 chars per token as rough estimate
        const maxChars = this.config.maxTokenLength * 4;
        const truncated = texts.map((t) =>
            t.length > maxChars ? t.slice(0, maxChars) : t,
        );

        return this.embedFn(truncated);
    }

    async embedSingle(text: string): Promise<number[]> {
        const results = await this.embed([text]);
        return results[0];
    }

    /** Embed TextChunks, prepending heading context when available. */
    async embedChunks(chunks: TextChunk[]): Promise<EmbeddedChunk[]> {
        if (chunks.length === 0) return [];

        const texts = chunks.map((c) =>
            c.heading ? `${c.heading}: ${c.content}` : c.content,
        );
        const vectors = await this.embed(texts);

        return chunks.map((chunk, i) => ({
            chunk,
            vector: vectors[i],
        }));
    }

    get modelId(): string {
        return this.config.modelId;
    }
}
