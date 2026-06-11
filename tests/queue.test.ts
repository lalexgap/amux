import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { queueAppend, queueClear, queueDepth, queueList, queuePop } from "../src/queue";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "am-test-"));
  process.env.AGENTMGR_HOME = home;
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  delete process.env.AGENTMGR_HOME;
});

describe("queue", () => {
  test("pops in FIFO order", () => {
    queueAppend("a", "first");
    queueAppend("a", "second");
    queueAppend("a", "third");

    expect(queueDepth("a")).toBe(3);
    expect(queuePop("a")).toBe("first");
    expect(queuePop("a")).toBe("second");
    expect(queuePop("a")).toBe("third");
    expect(queuePop("a")).toBeNull();
    expect(queueDepth("a")).toBe(0);
  });

  test("messages with newlines and quotes survive the round-trip", () => {
    const tricky = `line one\nline "two" with 'quotes' and $vars`;
    queueAppend("a", tricky);
    expect(queuePop("a")).toBe(tricky);
  });

  test("queues are per-agent", () => {
    queueAppend("a", "for a");
    queueAppend("b", "for b");
    expect(queuePop("b")).toBe("for b");
    expect(queueDepth("a")).toBe(1);
  });

  test("list shows messages with timestamps, clear empties", () => {
    queueAppend("a", "one");
    queueAppend("a", "two");
    const items = queueList("a");
    expect(items.map((i) => i.message)).toEqual(["one", "two"]);
    expect(items[0]!.queuedAt).toBeTruthy();

    queueClear("a");
    expect(queueDepth("a")).toBe(0);
  });

  test("pop on empty/missing queue returns null", () => {
    expect(queuePop("never-existed")).toBeNull();
  });
});
