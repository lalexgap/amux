import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listAgents,
  readAgent,
  readLastAttached,
  recordAttached,
  removeAgent,
  resolveAgentName,
  resolveAgent,
  setStatus,
  updateAgentStatus,
  writeAgent,
  type AgentState,
} from "../src/state";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "am-test-"));
  process.env.AGENTMGR_HOME = home;
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  delete process.env.AGENTMGR_HOME;
});

function makeAgent(name: string): AgentState {
  const now = new Date().toISOString();
  return {
    name,
    status: "starting",
    dir: "/tmp",
    tmuxSession: `agentmgr-${name}`,
    createdAt: now,
    updatedAt: now,
  };
}

describe("agent state", () => {
  test("write, read, list, remove round-trip", () => {
    writeAgent(makeAgent("alpha"));
    writeAgent(makeAgent("beta"));

    expect(readAgent("alpha")?.name).toBe("alpha");
    expect(listAgents().map((a) => a.name)).toEqual(["alpha", "beta"]);

    removeAgent("alpha");
    expect(readAgent("alpha")).toBeNull();
    expect(listAgents().map((a) => a.name)).toEqual(["beta"]);
  });

  test("setStatus updates status, reason, and transition timestamp", () => {
    writeAgent(makeAgent("alpha"));
    setStatus("alpha", "needs-attention", "approval requested — shell");
    expect(readAgent("alpha")).toMatchObject({
      status: "needs-attention",
      statusReason: "approval requested — shell",
    });
    expect(readAgent("alpha")?.statusChangedAt).toBeTruthy();
  });

  test("a new transition clears a stale reason", () => {
    const state = makeAgent("alpha");
    updateAgentStatus(state, "needs-attention", "permission requested", "2026-01-01T00:01:00Z");
    updateAgentStatus(state, "working", undefined, "2026-01-01T00:02:00Z");
    expect(state.status).toBe("working");
    expect(state.statusReason).toBeUndefined();
    expect(state.statusChangedAt).toBe("2026-01-01T00:02:00Z");
  });

  test("repeated status writes preserve the original transition time", () => {
    const state = makeAgent("alpha");
    updateAgentStatus(state, "working", undefined, "2026-01-01T00:01:00Z");
    updateAgentStatus(state, "working", undefined, "2026-01-01T00:02:00Z");
    expect(state.statusChangedAt).toBe("2026-01-01T00:01:00Z");
  });

  test("setStatus on unknown agent is a no-op", () => {
    setStatus("ghost", "working");
    expect(readAgent("ghost")).toBeNull();
  });

  test("a corrupt state file is quarantined, not fatal", () => {
    writeAgent(makeAgent("alpha"));
    writeFileSync(join(home, "agents", "torn.json"), '{"name": "torn", "status"');

    expect(readAgent("torn")).toBeNull();
    expect(listAgents().map((a) => a.name)).toEqual(["alpha"]);
    // Moved aside (name freed, damage visible) rather than silently shadowing.
    const files = readdirSync(join(home, "agents")).sort();
    expect(files).toEqual(["alpha.json", "torn.json.corrupt"]);
  });

  test("writes are atomic — no lingering partial .json files", () => {
    writeAgent(makeAgent("alpha"));
    const files = readdirSync(join(home, "agents"));
    expect(files).toEqual(["alpha.json"]);
  });
});

describe("resolveAgentName", () => {
  const names = ["api-refactor", "api-docs", "bugfix"];

  test("exact match wins even when it is a prefix of another", () => {
    expect(resolveAgentName("api-docs", ["api-docs", "api-docs-2"])).toBe("api-docs");
  });

  test("unambiguous prefix resolves", () => {
    expect(resolveAgentName("bug", names)).toBe("bugfix");
    expect(resolveAgentName("api-r", names)).toBe("api-refactor");
  });

  test("ambiguous prefix throws with candidates", () => {
    expect(() => resolveAgentName("api", names)).toThrow(/ambiguous.*api-refactor.*api-docs/);
  });

  test("no match throws", () => {
    expect(() => resolveAgentName("zzz", names)).toThrow(/no agent matches/);
  });
});

describe("agent aliases", () => {
  test("resolveAgent accepts exact aliases but not alias prefixes", () => {
    writeAgent(makeAgent("current"));
    const renamed = readAgent("current")!;
    renamed.aliases = ["former-name"];
    writeAgent(renamed);

    expect(resolveAgent("former-name").name).toBe("current");
    expect(() => resolveAgent("former")).toThrow(/no agent matches/);
  });
});

describe("last attached", () => {
  test("tracks current and previous", () => {
    recordAttached("alpha");
    recordAttached("beta");
    expect(readLastAttached()).toMatchObject({ current: "beta", previous: "alpha" });
  });

  test("re-attaching the same agent does not clobber previous", () => {
    recordAttached("alpha");
    recordAttached("beta");
    recordAttached("beta");
    expect(readLastAttached()).toMatchObject({ current: "beta", previous: "alpha" });
  });
});
