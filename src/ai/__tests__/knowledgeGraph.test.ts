import { buildKnowledgeGraph, getBacklinks } from "../knowledgeGraph";

describe("buildKnowledgeGraph", () => {
    test("handles aliased wiki links", () => {
        const notes = {
            A: "See [[B|Beta]] and [[C|Gamma]]",
            B: "Note B",
            C: "Note C",
        };

        const graph = buildKnowledgeGraph(notes);
        expect(graph["A"]).toEqual(["B", "C"]);
    });

    test("builds note graph from wiki links", () => {
        const notes = {
            A: "See [[B]]",
            B: "Related to [[C]]",
            C: "End note",
        };

        const graph = buildKnowledgeGraph(notes);

        expect(graph["A"]).toEqual(["B"]);
        expect(graph["B"]).toEqual(["C"]);
        expect(graph["C"]).toEqual([]);
    });

    test("handles empty notes collection", () => {
        const graph = buildKnowledgeGraph({});
        expect(graph).toEqual({});
    });

    test("handles notes with no links", () => {
        const notes = {
            A: "Just plain text",
            B: "Also plain text",
        };

        const graph = buildKnowledgeGraph(notes);

        expect(graph["A"]).toEqual([]);
        expect(graph["B"]).toEqual([]);
    });

    test("handles notes with multiple outgoing links", () => {
        const notes = {
            Hub: "Links to [[A]], [[B]], and [[C]]",
            A: "Leaf node",
        };

        const graph = buildKnowledgeGraph(notes);

        expect(graph["Hub"]).toEqual(["A", "B", "C"]);
        expect(graph["A"]).toEqual([]);
    });

    test("handles circular references", () => {
        const notes = {
            A: "Points to [[B]]",
            B: "Points to [[A]]",
        };

        const graph = buildKnowledgeGraph(notes);

        expect(graph["A"]).toEqual(["B"]);
        expect(graph["B"]).toEqual(["A"]);
    });

    test("deduplicates multiple links to the same note", () => {
        const notes = {
            A: "See [[B]] here and also [[B]] there",
        };

        const graph = buildKnowledgeGraph(notes);

        expect(graph["A"]).toEqual(["B"]);
        expect(graph["A"].length).toBe(1);
    });
});

describe("getBacklinks", () => {
    test("computes reverse links from a knowledge graph", () => {
        const graph = { A: ["B", "C"], B: ["C"], C: [] as string[] };
        const backlinks = getBacklinks(graph);

        expect(backlinks["B"]).toEqual(["A"]);
        expect(backlinks["C"]).toEqual(["A", "B"]);
        expect(backlinks["A"]).toBeUndefined();
    });

    test("returns empty object for empty graph", () => {
        expect(getBacklinks({})).toEqual({});
    });

    test("returns empty object when no note has links", () => {
        const graph = { A: [] as string[], B: [] as string[] };
        expect(getBacklinks(graph)).toEqual({});
    });

    test("handles self-referencing notes", () => {
        const graph = { A: ["A"] };
        const backlinks = getBacklinks(graph);

        expect(backlinks["A"]).toEqual(["A"]);
    });
});
