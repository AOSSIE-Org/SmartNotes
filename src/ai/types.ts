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
    /** Cosine similarity in [-1, 1] for semantic results; BM25 score for keyword results. */
    score: number;
}

export interface HybridSearchResult extends SearchResult {
    /** RRF-derived rank fusion score. Use this for ranking; not comparable to cosine similarity. */
    fusionScore: number;
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

export interface HybridSearchOptions extends SearchOptions {
    /** Weight for the semantic (vector) ranked list in RRF. */
    semanticWeight: number;
    /** Weight for the keyword (BM25) ranked list in RRF. */
    keywordWeight: number;
    /** RRF smoothing constant. Higher values reduce the impact of rank differences. */
    rrfK: number;
}

export const DEFAULT_HYBRID_SEARCH_OPTIONS: HybridSearchOptions = {
    topK: 10,
    minScore: 0, // RRF handles relevance ranking; cosine thresholding doesn't apply here
    semanticWeight: 1.0,
    keywordWeight: 1.0,
    rrfK: 60,
};
