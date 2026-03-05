/**
 * Build a graph of note relationships based on wiki links.
 */
import { extractWikiLinks } from "./linkParser";

export interface KnowledgeGraph {
    [noteName: string]: string[];
}
export function buildKnowledgeGraph(
    notes: Record<string, string>
): KnowledgeGraph {
    const graph: KnowledgeGraph = {};

    for (const [noteName, content] of Object.entries(notes)) {
        const links = extractWikiLinks(content);
        graph[noteName] = [...new Set(links)];
    }

    return graph;
}

/**
 * Computes backlinks (reverse edges) for a knowledge graph.
 *
 * Given a knowledge graph, returns a mapping where each note name points
 * to the list of notes that link **to** it. This is useful for "related notes"
 * sidebars and bidirectional link discovery.
 */
export function getBacklinks(
    graph: KnowledgeGraph
): Record<string, string[]> {
    const backlinks: Record<string, string[]> = {};

    for (const [noteName, links] of Object.entries(graph)) {
        for (const target of links) {
            if (!backlinks[target]) {
                backlinks[target] = [];
            }
            backlinks[target].push(noteName);
        }
    }

    return backlinks;
}
