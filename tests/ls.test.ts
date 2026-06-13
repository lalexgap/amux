import { describe, expect, test } from "bun:test";
import { paneWaitingInfo } from "../src/commands/ls";

const SEP = "─".repeat(40);

describe("paneWaitingInfo", () => {
  test("detects indicators in the status region with display detail", () => {
    const info = paneWaitingInfo(["⏺ Done.", SEP, "❯ ", SEP, "  ✶ next wake-up in 4m (watching CI)"]);
    expect(info.waiting).toBe(true);
    expect(info.detail).toBe("next wake-up in 4m (watching CI)");

    expect(paneWaitingInfo([SEP, "1 background task running"]).waiting).toBe(true);
    expect(paneWaitingInfo([SEP, "2 bashes running · 30k tokens"]).detail).toBe("2 bashes running · 30k tokens");
  });

  test("conversation text above the separator can't false-positive", () => {
    const info = paneWaitingInfo(["⏺ I started a background task for you.", SEP, "❯ ", SEP, "  42k tokens"]);
    expect(info.waiting).toBe(false);
  });

  test("strips SGR color codes from matches", () => {
    const info = paneWaitingInfo([SEP, "\x1b[2m✶ wake-up in 90s\x1b[0m"]);
    expect(info.waiting).toBe(true);
    expect(info.detail).toBe("wake-up in 90s");
  });

  test("no separator falls back to the last few lines only", () => {
    expect(paneWaitingInfo(["background task mentioned early", "a", "b", "c", "d", "e"]).waiting).toBe(false);
    expect(paneWaitingInfo(["a", "b", "1 background task running"]).waiting).toBe(true);
  });

  test("plain idle panes are not waiting", () => {
    expect(paneWaitingInfo([SEP, "  ⏵⏵ auto mode on · 30k tokens"]).waiting).toBe(false);
  });
});

describe("background task surfacing", () => {
  test("lastNonEmptyLine strips ANSI and trailing blanks", async () => {
    const { lastNonEmptyLine } = await import("../src/commands/ls");
    expect(lastNonEmptyLine("a\nb\n\n\x1b[32mDEPLOYED: web=abc\x1b[0m\n\n")).toBe("DEPLOYED: web=abc");
    expect(lastNonEmptyLine("\n\n")).toBeNull();
  });

  test("sessionTasksDir mirrors claude's slug/session layout", async () => {
    const { sessionTasksDir } = await import("../src/commands/ls");
    const dir = sessionTasksDir({
      name: "x", status: "idle", dir: "/home/u/code/app", tmuxSession: "agentmgr-x",
      sessionId: "abc-123", createdAt: "", updatedAt: "",
    } as never);
    expect(dir).toMatch(/^\/tmp\/claude-\d+\/-home-u-code-app\/abc-123\/tasks$/);
    expect(sessionTasksDir({ name: "x", status: "idle", dir: "/d", tmuxSession: "t", createdAt: "", updatedAt: "" } as never)).toBeNull();
  });

  test("backgroundTasks reads the freshest output tail", async () => {
    const { backgroundTasks, sessionTasksDir } = await import("../src/commands/ls");
    const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const agent = {
      name: "x", status: "idle", dir: "/tmp/am-bg-fixture", tmuxSession: "agentmgr-x",
      sessionId: "fixture-session", createdAt: "", updatedAt: "",
    } as never;
    const dir = sessionTasksDir(agent)!;
    mkdirSync(dir, { recursive: true });
    try {
      writeFileSync(`${dir}/old.output`, "stale watcher\n");
      await Bun.sleep(20);
      writeFileSync(`${dir}/fresh.output`, "polling…\ntick-7\n");
      const bg = backgroundTasks(agent)!;
      expect(bg.lastLine).toBe("tick-7");
      expect(bg.count).toBe(2);
    } finally {
      rmSync(dir.replace(/\/tasks$/, ""), { recursive: true, force: true });
    }
  });
});
