# SmartNotes — Offline-First AI Architecture

This document describes the system design, data flow, and module contracts for SmartNotes. The central principle is that every AI operation — embeddings, search, Q&A — runs entirely on the user's machine. No API keys. No cloud. No data leaving the device.

---

## Core Design Principles

**Offline by default.** The application is fully functional without an internet connection. AI features degrade gracefully rather than failing hard — semantic search works without Ollama, only Q&A requires it.

**Privacy first.** Notes never leave the device. The only network call SmartNotes makes is to `localhost:11434` (Ollama's local HTTP API). There are no telemetry endpoints, no analytics, no CDN model downloads at runtime.

**Single-process storage.** All persistence — notes, metadata, tags, links, and vector embeddings — lives in one SQLite file. No separate database server, no Docker containers, no external processes required beyond the optional Ollama daemon.

**Modular by design.** Each AI capability (embedding, retrieval, generation) is an independent module with a defined interface. Swapping the embedding model or LLM backend touches one file, not the whole codebase.

---

## System Layers

```
┌──────────────────────────────────────────────────────────────┐
│                        Electron App                           │
│                                                               │
│  ┌────────────────────┐        ┌────────────────────────┐    │
│  │    Main Process     │        │    Renderer Process    │    │
│  │                     │  IPC   │                        │    │
│  │  ┌──────────────┐  │◄──────►│  ┌──────────────────┐ │    │
│  │  │  SQLite DB   │  │        │  │   TipTap Editor   │ │    │
│  │  │  notes       │  │        │  │   Search Bar      │ │    │
│  │  │  metadata    │  │        │  │   Q&A Sidebar     │ │    │
│  │  │  links       │  │        │  │   Knowledge Graph │ │    │
│  │  │  embeddings  │  │        │  └──────────────────┘ │    │
│  │  │  (sqlite-vec)│  │        │                        │    │
│  │  └──────────────┘  │        │  ┌──────────────────┐ │    │
│  │                     │        │  │    Web Worker    │ │    │
│  │  ┌──────────────┐  │        │  │  Transformers.js  │ │    │
│  │  │ Ollama Mgr   │  │        │  │  (WASM embeds)    │ │    │
│  │  │ spawn/kill   │  │        │  │  Auto-link worker │ │    │
│  │  │ health check │  │        │  └──────────────────┘ │    │
│  │  └──────────────┘  │        └────────────────────────┘    │
│  │                     │                                       │
│  │  ┌──────────────┐  │                                       │
│  │  │ File System  │  │                                       │
│  │  │ import/export│  │                                       │
│  │  └──────────────┘  │                                       │
│  └────────────────────┘                                       │
└──────────────────────────────────────────────────────────────┘
                            │
                      localhost:11434
                            │
               ┌────────────────────────┐
               │      Ollama Daemon      │
               │  llama3.2 / phi3 /      │
               │  mistral (user choice) │
               └────────────────────────┘
```

---

## Module Contracts

### 1. Storage Layer (`VaultStorage`)

Handles all note CRUD and metadata. Backed by SQLite.

```typescript
interface NoteMetadata {
  id: string           // UUID
  title: string
  tags: string[]
  createdAt: Date
  updatedAt: Date
  wordCount: number
}

interface VaultReader {
  listNotes(): Promise<NoteMetadata[]>
  readNote(id: string): Promise<{ metadata: NoteMetadata; content: object }>
  searchFTS(query: string, limit?: number): Promise<NoteMetadata[]>
}

interface VaultWriter {
  createNote(title: string, content: object): Promise<string>  // returns id
  updateNote(id: string, content: object): Promise<void>
  deleteNote(id: string): Promise<void>
  renameNote(id: string, newTitle: string): Promise<void>
}

interface VaultWatcher {
  onChange(handler: (event: { type: 'created' | 'updated' | 'deleted'; id: string }) => void): () => void
}
```

SQLite schema:
```sql
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,       -- TipTap JSON serialized
  tags TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  word_count INTEGER NOT NULL DEFAULT 0
);

CREATE VIRTUAL TABLE notes_fts USING fts5(
  id UNINDEXED,
  title,
  content,
  content='notes',
  content_rowid='rowid'
);
```

---

### 2. Embedding Pipeline (`EmbeddingWorker`)

Runs in a Web Worker. Takes note text and returns a float32 vector.

```typescript
// Worker message protocol
type WorkerRequest =
  | { type: 'embed'; id: string; text: string }
  | { type: 'embedBatch'; items: { id: string; text: string }[] }

type WorkerResponse =
  | { type: 'embedding'; id: string; vector: Float32Array }
  | { type: 'batchDone'; count: number }
  | { type: 'modelReady' }
  | { type: 'error'; message: string }
```

Model: `all-MiniLM-L6-v2` (22MB WASM ONNX, 384 dimensions)
Loaded once on worker start, cached in memory for the session.

Embeddings are stored in SQLite via sqlite-vec:
```sql
CREATE VIRTUAL TABLE note_embeddings USING vec0(
  note_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  embedding FLOAT[384]
);
```

---

### 3. Retrieval Engine (`HybridRetriever`)

Combines BM25 full-text (SQLite FTS5) and cosine similarity (sqlite-vec) using Reciprocal Rank Fusion.

```typescript
interface SearchResult {
  noteId: string
  title: string
  chunkText: string
  score: number        // RRF combined score
  bm25Score: number
  vectorScore: number
}

interface HybridRetriever {
  search(query: string, topK?: number): Promise<SearchResult[]>
  searchSemantic(queryVector: Float32Array, topK?: number): Promise<SearchResult[]>
  searchKeyword(query: string, topK?: number): Promise<SearchResult[]>
}
```

RRF formula: `score = 1/(k + rank_bm25) + 1/(k + rank_vector)` where `k = 60`.

---

### 4. RAG Pipeline (`RAGEngine`)

Orchestrates retrieval + LLM generation using LlamaIndex.TS.

```typescript
interface RAGEngine {
  ask(question: string, history?: ChatMessage[]): AsyncIterable<string>
  // Streams tokens as they arrive from Ollama
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  sources?: string[]   // note IDs cited
}
```

System prompt template:
```
You are a helpful assistant with access to the user's personal notes.
Answer ONLY using the context provided. If the answer is not in the
context, say so. Always cite which note the information comes from.

Context:
{retrieved_chunks}
```

Ollama connection: `POST http://localhost:11434/api/chat` with `stream: true`.
Health check: `GET http://localhost:11434/api/tags` — returns 200 if running.

---

### 5. Link Graph (`LinkStore`)

Tracks both explicit wikilinks and auto-suggested links between notes.

```typescript
type LinkType = 'explicit' | 'suggested'
type SuggestionStatus = 'pending' | 'accepted' | 'dismissed'

interface Link {
  fromId: string
  toId: string
  type: LinkType
  similarity?: number        // only for suggested
  status?: SuggestionStatus  // only for suggested
}

interface LinkStore {
  getBacklinks(noteId: string): Promise<Link[]>
  getOutlinks(noteId: string): Promise<Link[]>
  addExplicitLink(fromId: string, toId: string): Promise<void>
  addSuggestedLink(fromId: string, toId: string, similarity: number): Promise<void>
  updateSuggestionStatus(fromId: string, toId: string, status: SuggestionStatus): Promise<void>
  getGraphData(): Promise<{ nodes: NoteNode[]; edges: GraphEdge[] }>
}
```

Auto-link threshold: similarity > 0.75 (configurable in settings).
Background computation: pairwise cosine between all note embeddings, runs in a Web Worker after 5 seconds of user inactivity.

---

## Data Flow: Note Save

```
User saves note in TipTap editor
    │
    ▼
main process: INSERT/UPDATE notes table + FTS5 index
    │
    ▼
renderer: post note text to EmbeddingWorker
    │
    ▼
EmbeddingWorker: chunk text (512 tokens, 128 overlap)
    │            → encode each chunk with all-MiniLM-L6-v2
    │            → return Float32Array[384] per chunk
    ▼
main process: UPSERT note_embeddings in sqlite-vec
    │
    ▼
AutoLinkWorker: re-run pairwise similarity for updated note
    │           → store new suggestions in suggested_links table
    ▼
renderer: show suggestion badge if new links found
```

---

## Data Flow: Semantic Search

```
User types query in search bar (150ms debounce)
    │
    ▼
renderer: post query to EmbeddingWorker
    │
    ▼
EmbeddingWorker: encode query → Float32Array[384]
    │
    ▼
main process:
    ├── FTS5 query → ranked BM25 results (list A)
    └── sqlite-vec KNN query → cosine results (list B)
    │
    ▼
RRF merge: combine A and B by rank position
    │
    ▼
renderer: display top results with snippet highlighting
```

---

## Data Flow: Q&A

```
User types question in Q&A sidebar
    │
    ▼
EmbeddingWorker: encode question → query vector
    │
    ▼
HybridRetriever: top-5 chunks by semantic similarity
    │
    ▼
RAGEngine: build prompt (system + context + question + history)
    │
    ▼
Ollama API: POST /api/chat (stream: true)
    │
    ▼
renderer: stream tokens into UI as they arrive
    │
    ▼
display source note titles as clickable citations
```

---

## Performance Targets

| Operation | Target | Notes |
|---|---|---|
| Embedding (single note) | < 200ms | allMiniLM on i5-class CPU |
| Semantic search (1000 notes) | < 50ms | sqlite-vec KNN |
| BM25 search (1000 notes) | < 10ms | SQLite FTS5 |
| Graph render (500 nodes) | < 100ms | D3 force layout |
| RAG first token | < 2s | llama3.2 on 8GB RAM |
| Model warm-up (first load) | 2–3s | WASM ONNX, cached after |

---

## Graceful Degradation

| Ollama status | Affected features | Unaffected features |
|---|---|---|
| Not installed | Q&A sidebar | Editor, search, graph, import/export |
| Installed, no model pulled | Q&A sidebar | All others |
| Running, model loaded | None | All features fully functional |

The app detects Ollama at startup via `GET localhost:11434/api/tags`. If unreachable, Q&A shows an "Install Ollama" prompt with a download link. Semantic search remains fully functional — it uses Transformers.js independently.

---

## File Structure (planned)

```
src/
├── main/
│   ├── index.ts          # Electron main process entry
│   ├── vault/
│   │   ├── storage.ts    # VaultReader + VaultWriter (SQLite)
│   │   └── migrations.ts # Schema versioning
│   ├── ai/
│   │   └── ollama.ts     # OllamaManager (spawn, health, models)
│   └── ipc/
│       └── handlers.ts   # IPC handler registration
├── renderer/
│   ├── components/
│   │   ├── Editor/       # TipTap integration
│   │   ├── Search/       # Search bar + results
│   │   ├── QA/           # Q&A sidebar
│   │   └── Graph/        # D3 knowledge graph
│   ├── workers/
│   │   ├── embedding.worker.ts   # Transformers.js WASM
│   │   └── autolink.worker.ts    # Pairwise similarity
│   └── lib/
│       ├── retriever.ts  # HybridRetriever
│       ├── rag.ts        # RAGEngine
│       └── links.ts      # LinkStore client
└── shared/
    └── types.ts          # Shared interfaces
```

---

## Related Issues

- [#17](https://github.com/AOSSIE-Org/SmartNotes/issues/17) — Document offline-first AI architecture (this document)
- [#20](https://github.com/AOSSIE-Org/SmartNotes/issues/20) — Define vault/storage layer API contracts
- [#36](https://github.com/AOSSIE-Org/SmartNotes/issues/36) — Initial project scaffold
