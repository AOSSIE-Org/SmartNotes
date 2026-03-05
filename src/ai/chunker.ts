/**
 * @module chunker
 *
 * Markdown Chunking Utility for Smart Notes.
 * The chunker is heading-aware: it first splits content by markdown headings
 * to preserve section boundaries, then sub-chunks large sections by word count.
 * This produces chunks with better semantic coherence than naive word splitting.
 */
export interface Chunk {
    id: string;
    noteId: string;
    content: string;
    metadata?: Record<string, any>
}

/**
 * Splits a markdown document into semantically coherent chunks.
 *
 * The algorithm is heading-aware:
 * 1. Splits the document by markdown headings (`#`, `##`, `###`, etc.)
 * 2. Each section (heading + body) becomes a candidate chunk
 * 3. If a section exceeds `maxWords`, it is further split by word count
 * 4. Sections smaller than `maxWords` are kept intact
 */
export function chunkMarkdown(
    noteId: string,
    markdown: string,
    maxWords: number = 250
): Chunk[] {
    if (!markdown || !markdown.trim()) {
        return [];
    }

    const sections = splitByHeadings(markdown);
    const chunks: Chunk[] = [];
    let index = 0;

    for (const section of sections) {
        const words = section.split(/\s+/).filter((w) => w.length > 0);

        if (words.length === 0) {
            continue;
        }

        if (words.length <= maxWords) {
            chunks.push({
                id: `${noteId}_chunk_${index}`,
                noteId,
                content: words.join(" "),
            });
            index++;
        } else {
            for (let i = 0; i < words.length; i += maxWords) {
                const content = words.slice(i, i + maxWords).join(" ");
                chunks.push({
                    id: `${noteId}_chunk_${index}`,
                    noteId,
                    content,
                });
                index++;
            }
        }
    }

    return chunks;
}

function splitByHeadings(markdown: string): string[] {
    const headingPattern = /^(#{1,6})\s+/m;
    const lines = markdown.split(/\r?\n/);
    const sections: string[] = [];
    let currentSection: string[] = [];

    for (const line of lines) {
        if (headingPattern.test(line) && currentSection.length > 0) {
            sections.push(currentSection.join("\n"));
            currentSection = [line];
        } else {
            currentSection.push(line);
        }
    }

    if (currentSection.length > 0) {
        sections.push(currentSection.join("\n"));
    }

    return sections;
}
