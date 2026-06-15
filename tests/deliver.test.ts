import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireDeliverLock,
  releaseDeliverLock,
  __lockPath,
  __lockStaleMs,
} from "../src/deliver";
import { ensureDirs } from "../src/paths";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "am-test-"));
  process.env.AGENTMGR_HOME = home;
  ensureDirs();
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  delete process.env.AGENTMGR_HOME;
});

describe("delivery lock", () => {
  test("is mutually exclusive while held, and frees on release", () => {
    expect(acquireDeliverLock("api")).toBe(true);
    expect(acquireDeliverLock("api")).toBe(false); // already held
    expect(acquireDeliverLock("other")).toBe(true); // per-agent, independent
    releaseDeliverLock("api");
    expect(acquireDeliverLock("api")).toBe(true); // freed
  });

  test("a stale lock (crashed holder) is reclaimed; a fresh one is not", () => {
    expect(acquireDeliverLock("api")).toBe(true);
    // fresh → a second caller can't steal
    expect(acquireDeliverLock("api")).toBe(false);
    // backdate the lock past the staleness window → now stealable
    const old = (Date.now() - __lockStaleMs - 5000) / 1000;
    utimesSync(__lockPath("api"), old, old);
    expect(acquireDeliverLock("api")).toBe(true); // stolen, and read-back confirms ownership
    // having stolen it, it's now fresh again → not re-stealable
    expect(acquireDeliverLock("api")).toBe(false);
  });
});
