import { describe, expect, test } from "bun:test";
import { agentSystemPrompt, conversationArgs, scrubNestedSessionEnv } from "../src/commands/new";

describe("agentSystemPrompt", () => {
  test("names the agent and teaches the am command surface", () => {
    const prompt = agentSystemPrompt("worker-1");
    expect(prompt).toContain('"worker-1"');
    expect(prompt).toContain("am new");
    expect(prompt).toContain("am ls --json");
    expect(prompt).toContain("trust prompt");
  });
});
import { clipLine } from "../src/picker";

describe("clipLine", () => {
  test("passes short lines through and clips long ones with an ellipsis", () => {
    expect(clipLine("short", 10)).toBe("short");
    expect(clipLine("exactly-10", 10)).toBe("exactly-10");
    expect(clipLine("definitely too long", 10)).toBe("definitel…");
  });
});

describe("conversationArgs", () => {
  const base = { name: "x" };

  test("defaults to a fresh conversation", () => {
    expect(conversationArgs(base)).toEqual([]);
  });

  test("--resume with an id and --continue map through", () => {
    expect(conversationArgs({ ...base, resume: "abc-123" })).toEqual(["--resume", "abc-123"]);
    expect(conversationArgs({ ...base, continue: true })).toEqual(["--continue"]);
  });

  test("bare --resume opens the picker, but not with -m", () => {
    expect(conversationArgs({ ...base, resume: true })).toEqual(["--resume"]);
    expect(() => conversationArgs({ ...base, resume: true, message: "hi" })).toThrow(/session id/);
  });

  test("--resume and --continue conflict", () => {
    expect(() => conversationArgs({ ...base, resume: "abc", continue: true })).toThrow(/mutually exclusive/);
  });
});

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
