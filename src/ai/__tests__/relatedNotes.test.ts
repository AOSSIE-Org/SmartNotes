import { getRelatedNotes } from "../relatedNotes";

test("finds related notes using outgoing and backlinks", () => {

  const graph = {
    A: ["B"],
    B: ["C"],
    C: []
  };

  const related = getRelatedNotes("B", graph);

  expect(related).toEqual(expect.arrayContaining(["A", "C"]));
});

test("deduplicates when multiple paths lead to the same related note", () => {
  const graph = {
    A: ["B", "C"],
    B: ["C"],
    C: ["A"],
  };

  const related = getRelatedNotes("A", graph);

  expect(related).toEqual(expect.arrayContaining(["B", "C"]));
  expect(new Set(related).size).toBe(related.length);
});

test("excludes the source note when it links to itself", () => {
  const graph = {
    A: ["A", "B"],
    B: [],
  };

  const related = getRelatedNotes("A", graph);

  expect(related).toEqual(expect.arrayContaining(["B"]));
  expect(related).not.toContain("A");
});