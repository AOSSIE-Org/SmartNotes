import { KnowledgeGraph, getBacklinks } from "./knowledgeGraph";

/**
 * Finds related notes for a given note using the knowledge graph.
 * Combines outgoing links and backlinks to surface contextually related notes.
 */
export function getRelatedNotes(
  noteName: string,
  graph: KnowledgeGraph
): string[] {

  const outgoing = graph[noteName] || [];

  const backlinks = getBacklinks(graph)[noteName] || [];

  const related = new Set<string>();

  outgoing.forEach(n => related.add(n));
  backlinks.forEach(n => related.add(n));

  return Array.from(related).filter(n => n !== noteName);
}