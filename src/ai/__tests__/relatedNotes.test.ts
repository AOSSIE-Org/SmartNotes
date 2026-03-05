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