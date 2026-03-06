// Shared types for the AI pipeline.

export interface TextChunk {
    id: string;
    noteId: string;
    content: string;
    heading?: string;
    chunkIndex: number;
}

export interface EmbeddedChunk {
    chunk: TextChunk;
    vector: number[];
}

export interface SearchResult {
    chunk: TextChunk;
    /** Cosine similarity score (-1 to 1; typically >= 0 for normalized embeddings). */
    score: number;
}

export interface EmbeddingConfig {
    modelId: string;
    /** Max tokens before truncation. */
    maxTokenLength: number;
}

export interface VectorStoreConfig {
    persistDir: string;
    indexFilename: string;
    /** Used to detect incompatible index files at load time. */
    modelId?: string;
}

export interface SerializedVectorStore {
    version: number;
    /** Model that produced the stored vectors. */
    modelId?: string;
    /** Embedding dimension — used to detect model changes at load time. */
    vectorDim?: number;
    entries: Array<{
        chunk: TextChunk;
        vector: number[];
    }>;
}

export interface SearchOptions {
    topK: number;
    minScore: number;
    /** Filter results to a single note. */
    noteId?: string;
}

export const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
    modelId: "Xenova/all-MiniLM-L6-v2",
    maxTokenLength: 256,
};

export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
    topK: 10,
    minScore: 0.3,
};
