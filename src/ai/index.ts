export { EmbeddingService } from "./embeddings.js";
export type { EmbedFn } from "./embeddings.js";

export { VectorStore, cosineSimilarity } from "./vectorStore.js";

export {
    SemanticSearchService,
    defaultChunker,
} from "./semanticSearch.js";
export type { ChunkFn } from "./semanticSearch.js";

export { KeywordSearchEngine, tokenize } from "./keywordSearch.js";

export {
    HybridSearchService,
    reciprocalRankFusion,
} from "./hybridSearch.js";

export type {
    TextChunk,
    EmbeddedChunk,
    SearchResult,
    EmbeddingConfig,
    VectorStoreConfig,
    SearchOptions,
    SerializedVectorStore,
    HybridSearchOptions,
} from "./types.js";

export {
    DEFAULT_EMBEDDING_CONFIG,
    DEFAULT_SEARCH_OPTIONS,
    DEFAULT_HYBRID_SEARCH_OPTIONS,
} from "./types.js";
