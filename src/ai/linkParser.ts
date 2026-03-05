/**
 * Extract [[wiki links]] from markdown text.
 * Supports alias syntax: [[Page|Display]].
 */
export function extractWikiLinks(markdown: string): string[] {
    const regex = /\[\[([^\]]+)\]\]/g;
    const links: string[] = [];

    let match: RegExpExecArray | null;

    while ((match = regex.exec(markdown)) !== null) {
        const raw = match[1].trim();
        const pipeIndex = raw.indexOf("|");
        const pageName = pipeIndex !== -1 ? raw.substring(0, pipeIndex).trim() : raw;

        if (pageName.length > 0) {
            links.push(pageName);
        }
    }

    return links;
}
