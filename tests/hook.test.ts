import { describe, expect, test } from "bun:test";
import { hookEffects } from "../src/commands/hook";

describe("hookEffects", () => {
  test("maps lifecycle events to statuses", () => {
    expect(hookEffects("session-start", {}).status).toBe("idle");
    expect(hookEffects("user-prompt-submit", {}).status).toBe("working");
    expect(hookEffects("session-end", {}).status).toBe("exited");
  });

  test("stop goes idle and drains the queue", () => {
    expect(hookEffects("stop", {})).toMatchObject({ status: "idle", drainQueue: true });
  });

  test("permission notifications flag needs-attention with a message", () => {
    const effects = hookEffects("notification", {
      message: "Claude needs your permission to use Bash",
    });
    expect(effects.status).toBe("needs-attention");
    expect(effects.notify).toContain("permission");
  });

  test("idle-timeout notification stays idle and does not notify", () => {
    const effects = hookEffects("notification", {
      message: "Claude is waiting for your input",
    });
    expect(effects.status).toBe("idle");
    expect(effects.notify).toBeUndefined();
  });

  test("unknown event throws", () => {
    expect(() => hookEffects("nope", {})).toThrow(/unknown hook event/);
  });
});
