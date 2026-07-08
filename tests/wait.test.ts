import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { waitForStatus } from "../src/commands/wait";
import { formatPeek } from "../src/commands/peek";
import { writeAgent, type AgentState } from "../src/state";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "am-wait-"));
  process.env.AGENTMGR_HOME = home;
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  delete process.env.AGENTMGR_HOME;
});

function makeAgent(name: string, extra: Partial<AgentState> = {}): AgentState {
  const now = new Date().toISOString();
  return {
    name,
    status: "exited",
    dir: home,
    // No such tmux session: a non-exited status displays as "dead".
    tmuxSession: `agentmgr-wait-test-${name}`,
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
}

describe("waitForStatus", () => {
  test("resolves immediately when the status already matches", async () => {
    writeAgent(makeAgent("a", { status: "exited" }));
    expect(await waitForStatus("a", "exited", 5000)).toBe("reached");
  });

  test("display status is what's matched — a sessionless 'working' agent is dead", async () => {
    writeAgent(makeAgent("a", { status: "working" }));
    expect(await waitForStatus("a", "dead", 5000)).toBe("reached");
  });

  test("times out when the status never arrives", async () => {
    writeAgent(makeAgent("a", { status: "exited" }));
    expect(await waitForStatus("a", "working", 100)).toBe("timeout");
  });

  test("reports a removed agent instead of spinning", async () => {
    expect(await waitForStatus("never-existed", "idle", 5000)).toBe("removed");
  });
});

describe("formatPeek", () => {
  const colored = ["\x1b[32mgreen\x1b[0m line", "plain line", "last line"];

  test("keeps colors for a terminal, strips them for a pipe", () => {
    expect(formatPeek(colored, { colors: true })).toContain("\x1b[32m");
    const plain = formatPeek(colored, { colors: false });
    expect(plain).not.toContain("\x1b[");
    expect(plain).toBe("green line\nplain line\nlast line");
  });

  test("--lines tails the output", () => {
    expect(formatPeek(colored, { lines: 2, colors: false })).toBe("plain line\nlast line");
    // Zero/absent = everything.
    expect(formatPeek(colored, { lines: 0, colors: false }).split("\n")).toHaveLength(3);
  });
});
