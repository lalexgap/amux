import { describe, expect, test } from "bun:test";
import { scrubNestedSessionEnv } from "../src/commands/new";

describe("scrubNestedSessionEnv", () => {
  test("wraps the command in env -u for the CLAUDE_CODE_* family", () => {
    const wrapped = scrubNestedSessionEnv(["claude", "--settings", "/x.json"]);
    expect(wrapped[0]).toBe("env");
    expect(wrapped.slice(-3)).toEqual(["claude", "--settings", "/x.json"]);

    const unset = wrapped.filter((_, i) => wrapped[i - 1] === "-u");
    expect(unset).toContain("CLAUDECODE");
    expect(unset).toContain("CLAUDE_CODE_CHILD_SESSION");
    expect(unset).toContain("CLAUDE_CODE_SESSION_ID");
  });

  test("picks up extra CLAUDE_CODE_ vars from the current environment", () => {
    process.env.CLAUDE_CODE_TEST_EXTRA = "1";
    try {
      const wrapped = scrubNestedSessionEnv(["claude"]);
      expect(wrapped).toContain("CLAUDE_CODE_TEST_EXTRA");
    } finally {
      delete process.env.CLAUDE_CODE_TEST_EXTRA;
    }
  });
});
