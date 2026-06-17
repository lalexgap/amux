import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveTask } from "../src/task";

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "am-task-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("resolveTask", () => {
  const noStdin = async () => "";

  test("returns a literal -m message", async () => {
    expect(await resolveTask({ m: "do the thing" }, noStdin)).toBe("do the thing");
    expect(await resolveTask({ message: "via message" }, noStdin)).toBe("via message");
  });

  test("no task flags yields undefined (taskless spawn stays possible)", async () => {
    expect(await resolveTask({}, noStdin)).toBeUndefined();
  });

  test("--file reads and trims the task from a file", async () => {
    const f = join(tmp(), "task.txt");
    writeFileSync(f, "build the feature\n\n");
    expect(await resolveTask({ file: f }, noStdin)).toBe("build the feature");
  });

  test("--file plus -m is rejected", async () => {
    const f = join(tmp(), "task.txt");
    writeFileSync(f, "from file");
    await expect(resolveTask({ file: f, m: "from flag" }, noStdin)).rejects.toThrow(/not both/);
  });

  test("an empty --file errors rather than booting taskless", async () => {
    const f = join(tmp(), "empty.txt");
    writeFileSync(f, "   \n");
    await expect(resolveTask({ file: f }, noStdin)).rejects.toThrow(/empty/);
  });

  test("-m - reads the task from stdin", async () => {
    expect(await resolveTask({ m: "-" }, async () => "piped task\n")).toBe("piped task");
  });

  test("-m - with empty stdin errors", async () => {
    await expect(resolveTask({ m: "-" }, async () => "  \n")).rejects.toThrow(/no task on stdin/);
  });
});
