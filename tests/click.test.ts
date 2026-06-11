import { describe, expect, test } from "bun:test";
import { extractUrlAt } from "../src/commands/click";

describe("extractUrlAt", () => {
  const line = "visit https://example.com/a-b.c?x=1 and (https://two.dev/p) end";

  test("returns the URL spanning the clicked column", () => {
    expect(extractUrlAt(line, 6)).toBe("https://example.com/a-b.c?x=1"); // first char
    expect(extractUrlAt(line, 20)).toBe("https://example.com/a-b.c?x=1"); // middle
    expect(extractUrlAt(line, 42)).toBe("https://two.dev/p"); // second URL
  });

  test("clicks outside any URL return null", () => {
    expect(extractUrlAt(line, 0)).toBeNull(); // "visit"
    expect(extractUrlAt(line, 36)).toBeNull(); // "and"
    expect(extractUrlAt("no links here", 5)).toBeNull();
  });

  test("sheds trailing punctuation and closing brackets", () => {
    expect(extractUrlAt("see https://x.dev/p.", 10)).toBe("https://x.dev/p");
    expect(extractUrlAt("(https://x.dev/p), yes", 5)).toBe("https://x.dev/p");
    // a click on punctuation just past the trimmed URL is not a hit
    expect(extractUrlAt("see https://x.dev/p.", 19)).toBeNull();
  });

  test("dashes, queries, and fragments stay part of the URL", () => {
    const long = "https://github.com/lalexgap/agent-manager/pull/12#issuecomment-99";
    expect(extractUrlAt(long, 50)).toBe(long);
  });
});
