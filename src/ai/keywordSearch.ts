import type { TextChunk, SearchResult } from "./types.js";

const STOP_WORDS = new Set([
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "need", "dare", "ought",
    "used", "to", "of", "in", "for", "on", "with", "at", "by", "from",
    "as", "into", "through", "during", "before", "after", "above", "below",
    "between", "out", "off", "over", "under", "again", "further", "then",
    "once", "here", "there", "when", "where", "why", "how", "all", "each",
    "every", "both", "few", "more", "most", "other", "some", "such", "no",
    "nor", "not", "only", "own", "same", "so", "than", "too", "very",
    "just", "because", "but", "and", "or", "if", "while", "about", "up",
    "it", "its", "this", "that", "these", "those", "i", "me", "my",
    "we", "our", "you", "your", "he", "him", "his", "she", "her",
    "they", "them", "their", "what", "which", "who", "whom",
]);

// BM25 parameters (Robertson et al. defaults)
const K1 = 1.2;
const B = 0.75;

interface IndexedDoc {
    chunk: TextChunk;
    termFreqs: Map<string, number>;
    length: number;
}

export function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .split(/\W+/)
        .filter((t) => t.length > 0 && !STOP_WORDS.has(t));
}

export class KeywordSearchEngine {
    private docs: Map<string, IndexedDoc> = new Map();
    private invertedIndex: Map<string, Set<string>> = new Map();
    private avgDocLength = 0;

    get size(): number {
        return this.docs.size;
    }

    indexChunks(chunks: TextChunk[]): void {
        for (const chunk of chunks) {
            if (this.docs.has(chunk.id)) {
                this.removeDoc(chunk.id);
            }

            const tokens = tokenize(chunk.content);
            const termFreqs = new Map<string, number>();
            for (const token of tokens) {
                termFreqs.set(token, (termFreqs.get(token) ?? 0) + 1);
            }

            this.docs.set(chunk.id, { chunk, termFreqs, length: tokens.length });

            for (const term of termFreqs.keys()) {
                let posting = this.invertedIndex.get(term);
                if (!posting) {
                    posting = new Set();
                    this.invertedIndex.set(term, posting);
                }
                posting.add(chunk.id);
            }
        }

        this.recomputeAvgLength();
    }

    removeByNoteId(noteId: string): number {
        const toRemove: string[] = [];
        for (const [id, doc] of this.docs) {
            if (doc.chunk.noteId === noteId) toRemove.push(id);
        }
        for (const id of toRemove) this.removeDoc(id);
        this.recomputeAvgLength();
        return toRemove.length;
    }

    search(query: string, topK: number = 10): SearchResult[] {
        const queryTerms = tokenize(query);
        if (queryTerms.length === 0 || this.docs.size === 0) return [];

        const N = this.docs.size;
        const scores = new Map<string, number>();

        for (const term of queryTerms) {
            const posting = this.invertedIndex.get(term);
            if (!posting) continue;

            const df = posting.size;
            const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);

            for (const docId of posting) {
                const doc = this.docs.get(docId)!;
                const tf = doc.termFreqs.get(term) ?? 0;
                const numerator = tf * (K1 + 1);
                const denominator = tf + K1 * (1 - B + B * (doc.length / this.avgDocLength));
                const termScore = idf * (numerator / denominator);
                scores.set(docId, (scores.get(docId) ?? 0) + termScore);
            }
        }

        const results: SearchResult[] = [];
        for (const [docId, score] of scores) {
            results.push({ chunk: this.docs.get(docId)!.chunk, score });
        }

        results.sort((a, b) => b.score - a.score);
        return results.slice(0, topK);
    }

    clear(): void {
        this.docs.clear();
        this.invertedIndex.clear();
        this.avgDocLength = 0;
    }

    private removeDoc(id: string): void {
        const doc = this.docs.get(id);
        if (!doc) return;

        for (const term of doc.termFreqs.keys()) {
            const posting = this.invertedIndex.get(term);
            if (posting) {
                posting.delete(id);
                if (posting.size === 0) this.invertedIndex.delete(term);
            }
        }
        this.docs.delete(id);
    }

    private recomputeAvgLength(): void {
        if (this.docs.size === 0) {
            this.avgDocLength = 0;
            return;
        }
        let total = 0;
        for (const doc of this.docs.values()) total += doc.length;
        this.avgDocLength = total / this.docs.size;
    }
}
