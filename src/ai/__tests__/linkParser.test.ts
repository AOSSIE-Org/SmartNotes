import { extractWikiLinks } from "../linkParser";

describe("extractWikiLinks", () => {
    test("extracts wiki links from text", () => {
        const text = "Study [[Neural Networks]] and [[Gradient Descent]]";
        const links = extractWikiLinks(text);

        expect(links).toEqual(["Neural Networks", "Gradient Descent"]);
    });

    test("returns empty array when no links present", () => {
        expect(extractWikiLinks("No links here")).toEqual([]);
        expect(extractWikiLinks("")).toEqual([]);
    });

    test("handles aliased wiki links [[Page|Display]]", () => {
        const text = "See [[ML|Machine Learning]] and [[DL|Deep Learning]]";
        const links = extractWikiLinks(text);

        expect(links).toEqual(["ML", "DL"]);
    });

    test("handles mixed standard and aliased links", () => {
        const text = "Read [[Intro]], then [[Advanced|Adv Topics]], and [[Summary]]";
        const links = extractWikiLinks(text);

        expect(links).toEqual(["Intro", "Advanced", "Summary"]);
    });

    test("trims whitespace from link names", () => {
        const text = "[[ Spaced Link ]] and [[  Another  |  Display  ]]";
        const links = extractWikiLinks(text);

        expect(links).toEqual(["Spaced Link", "Another"]);
    });

    test("handles multiple links on same line", () => {
        const text = "[[A]] connects to [[B]] and [[C]]";
        const links = extractWikiLinks(text);

        expect(links).toEqual(["A", "B", "C"]);
    });

    test("handles links across multiple lines", () => {
        const text = "Line 1 [[Link1]]\nLine 2 [[Link2]]\nLine 3 [[Link3]]";
        const links = extractWikiLinks(text);

        expect(links).toEqual(["Link1", "Link2", "Link3"]);
    });

    test("preserves duplicate links", () => {
        const text = "[[A]] more text [[A]] and [[B]]";
        const links = extractWikiLinks(text);

        expect(links).toEqual(["A", "A", "B"]);
    });
});
