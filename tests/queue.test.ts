import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { queueAppend, queueClear, queueDepth, queueList, queuePeek, queuePop } from "../src/queue";

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

  test("appends during a pending queue never disturb earlier messages", () => {
    // Maildir semantics: each message is its own file, so an append can't
    // clobber (or be clobbered by) a concurrent pop's rewrite.
    queueAppend("a", "first");
    queueAppend("a", "second");
    expect(queuePop("a")).toBe("first");
    queueAppend("a", "third");
    expect(queueList("a").map((m) => m.message)).toEqual(["second", "third"]);
  });

  test("migrates a legacy single-file queue on first touch", () => {
    const dir = join(home, "queue");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "old.jsonl"),
      `${JSON.stringify({ message: "one", queuedAt: "2026-01-01T00:00:00Z" })}\n` +
        `${JSON.stringify({ message: "two", queuedAt: "2026-01-01T00:00:01Z" })}\n` +
        `not json — torn line\n`,
    );

    expect(queueDepth("old")).toBe(2);
    expect(queuePeek("old")).toBe("one");
    expect(queuePop("old")).toBe("one");
    expect(queuePop("old")).toBe("two");
    expect(queuePop("old")).toBeNull();
  });

  test("a corrupt message file is skipped and dropped, not fatal", () => {
    queueAppend("a", "good");
    // Sorts before the real message (msgIds start with a timestamp digit).
    writeFileSync(join(home, "queue", "a", "0000000000AAAAAAAAAAAAAAAA.json"), "{torn");

    expect(queuePeek("a")).toBe("good");
    expect(queuePop("a")).toBe("good");
    expect(queuePop("a")).toBeNull();
  });
});
