import { chunkMarkdown } from "../chunker";

describe("chunkMarkdown", () => {
    test("splits text into chunks of given word size", () => {
        const text = "word ".repeat(600).trim();
        const chunks = chunkMarkdown("note1", text, 200);

        expect(chunks.length).toBe(3);
        expect(chunks[0].id).toBe("note1_chunk_0");
        expect(chunks[0].noteId).toBe("note1");
    });

    test("returns empty array for empty input", () => {
        expect(chunkMarkdown("note1", "")).toEqual([]);
        expect(chunkMarkdown("note1", "   ")).toEqual([]);
    });

    test("returns single chunk for small content", () => {
        const chunks = chunkMarkdown("note1", "Hello world");

        expect(chunks.length).toBe(1);
        expect(chunks[0].content).toBe("Hello world");
        expect(chunks[0].id).toBe("note1_chunk_0");
    });

    test("preserves content across chunks", () => {
        const words = Array.from({ length: 100 }, (_, i) => `w${i}`);
        const text = words.join(" ");
        const chunks = chunkMarkdown("note1", text, 50);

        const reconstructed = chunks.map((c) => c.content).join(" ");
        expect(reconstructed).toBe(text);
    });

    test("splits by headings to maintain semantic coherence", () => {
        const markdown = [
            "# Introduction",
            "This is the intro section with some words.",
            "",
            "## Details",
            "This is the details section with more words.",
        ].join("\n");

        const chunks = chunkMarkdown("note1", markdown, 250);

        // Should produce 2 chunks (one per heading section)
        expect(chunks.length).toBe(2);
        expect(chunks[0].content).toContain("Introduction");
        expect(chunks[1].content).toContain("Details");
    });

    test("sub-chunks large sections that exceed maxWords", () => {
        const longSection = "word ".repeat(500).trim();
        const markdown = `# Big Section\n${longSection}`;

        const chunks = chunkMarkdown("note1", markdown, 200);

        // ~502 words (2 heading words + 500) → 3 chunks
        expect(chunks.length).toBe(3);
    });

    test("assigns sequential IDs across all chunks", () => {
        const markdown = [
            "# Section 1",
            "Some content here.",
            "## Section 2",
            "More content here.",
            "## Section 3",
            "Even more content.",
        ].join("\n");

        const chunks = chunkMarkdown("note1", markdown);

        chunks.forEach((chunk, i) => {
            expect(chunk.id).toBe(`note1_chunk_${i}`);
        });
    });

    test("handles content before first heading", () => {
        const markdown = "Preamble text before any heading.\n\n# First Heading\nBody.";
        const chunks = chunkMarkdown("note1", markdown, 250);

        expect(chunks.length).toBe(2);
        expect(chunks[0].content).toContain("Preamble");
        expect(chunks[1].content).toContain("First Heading");
    });
});
