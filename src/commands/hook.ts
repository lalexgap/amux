import { readAgent, writeAgent, type AgentStatus } from "../state";
import { queueDepth } from "../queue";
import { spawnDeliver } from "../deliver";
import { notifyDaemon } from "../daemon";

async function readStdinPayload(): Promise<Record<string, unknown>> {
  if (process.stdin.isTTY) return {};
  try {
    const text = await Bun.stdin.text();
    return text.trim() ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

function notifyMac(title: string, message: string): void {
  const esc = (s: string) => s.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  Bun.spawnSync([
    "osascript",
    "-e",
    `display notification "${esc(message)}" with title "${esc(title)}"`,
  ]);
}

export interface HookEffects {
  status: AgentStatus;
  notify?: string;
  drainQueue?: boolean;
}

export function hookEffects(event: string, payload: Record<string, unknown>): HookEffects {
  switch (event) {
    case "session-start":
      return { status: "idle" };
    case "user-prompt-submit":
      return { status: "working" };
    case "stop":
      return { status: "idle", drainQueue: true };
    case "notification": {
      const message = typeof payload.message === "string" ? payload.message : "needs attention";
      // Claude Code also sends a notification after ~60s of idleness; that
      // isn't "needs attention" — treating it as such would make sends queue
      // forever (no turn → no Stop hook to drain them).
      if (/waiting for .*input/i.test(message)) return { status: "idle" };
      return { status: "needs-attention", notify: message };
    }
    case "session-end":
      return { status: "exited" };
    default:
      throw new Error(`unknown hook event: ${event}`);
  }
}

export async function hookCommand(event: string): Promise<void> {
  const name = process.env.AGENTMGR_AGENT;
  if (!name) return; // not a managed session
  const agent = readAgent(name);
  if (!agent) return;

  const payload = await readStdinPayload();
  const effects = hookEffects(event, payload);

  agent.status = effects.status;
  if (typeof payload.session_id === "string") agent.claudeSessionId = payload.session_id;
  writeAgent(agent);

  if (effects.notify) notifyMac(`am: ${name}`, effects.notify);
  if (effects.drainQueue && queueDepth(name) > 0) {
    // Prefer the daemon as scheduler; fall back to a detached one-shot
    // delivery process when it isn't running.
    if (!(await notifyDaemon(name, "stop"))) spawnDeliver(name);
  }
}
