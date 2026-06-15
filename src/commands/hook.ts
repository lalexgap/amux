import { readAgent, writeAgent, type AgentStatus } from "../state";
import { queueAppend, queueDepth, queuePop } from "../queue";
import { acquireDeliverLock, deliverNext, releaseDeliverLock, spawnDeliver } from "../deliver";
import { notifyDaemon } from "../daemon";
import { loadConfig, shouldNotifyIdle } from "../config";
import { notify } from "../notify";
import { paneWaitingInfo } from "./ls";
import { writeSnapshot } from "../snapshots";
import { capturePane, hasAttachedClient, hasSession } from "../tmux";
import { attribute, hasMessagedSince, shouldReport } from "../comms";

async function readStdinPayload(): Promise<Record<string, unknown>> {
  if (process.stdin.isTTY) return {};
  try {
    const text = await Bun.stdin.text();
    return text.trim() ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h${Math.floor((seconds % 3600) / 60)}m`;
}

export interface HookEffects {
  status: AgentStatus;
  notify?: string;
  drainQueue?: boolean;
}

export function hookEffects(event: string, payload: Record<string, unknown>): HookEffects {
  switch (event) {
    case "session-start":
      // Drain so initial messages queued at spawn time (the remote-control
      // flag swallows positional prompts) are delivered as soon as the TUI
      // is up.
      return { status: "idle", drainQueue: true };
    case "user-prompt-submit":
    case "pre-tool-use":
    case "post-tool-use":
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
    // Codex's dedicated approval event (PermissionRequest) — unlike Claude's
    // Notification, it only ever means "waiting on the user".
    case "permission-request": {
      const tool = typeof payload.tool_name === "string" ? ` — ${payload.tool_name}` : "";
      return { status: "needs-attention", notify: `approval requested${tool}` };
    }
    case "session-end":
      return { status: "exited" };
    default:
      throw new Error(`unknown hook event: ${event}`);
  }
}

// Send a backstop report to a local, live reportTo target. Cross-host targets
// are out of scope for the hook (it must exit fast and can't block on ssh);
// the agent's own `am send` covers those via fleet resolution.
async function deliverReport(from: string, target: string, body: string): Promise<void> {
  const t = readAgent(target);
  if (!t || !hasSession(t.tmuxSession)) return;
  const att = attribute(from, target, body, "report");
  if (!att.allowed) {
    console.error(`am: report from ${from} to ${target} rate-limited (dropped)`);
    return; // a loop guard tripped
  }
  queueAppend(target, att.body);
  // Await so the verify-and-retry in deliverNext finishes before the hook exits.
  if (t.status === "idle" || t.status === "starting") await deliverNext(target);
}

// The context block shown to the agent for its pending peer messages. Pure.
export function formatInbox(messages: string[]): string {
  const n = messages.length;
  const header =
    n === 1
      ? "You have 1 message from another agent (it arrived while you were busy):"
      : `You have ${n} messages from other agents (they arrived while you were busy):`;
  return `[am inbox] ${header}\n\n${messages.join("\n")}\n\nAddress or act on these as appropriate, then continue with the prompt below.`;
}

// The JSON a UserPromptSubmit hook emits to inject context, or null if there's
// nothing to surface. Pure, for testing.
export function buildInboxOutput(messages: string[]): string | null {
  if (messages.length === 0) return null;
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: formatInbox(messages) },
  });
}

// On every prompt, drain this agent's queued peer messages and surface them as
// context for the turn — so it reads its inbox automatically, no idle-wait, no
// "check your messages" nudge. Drains under the delivery lock so it never races
// the idle-drain (deliverNext): atomic + lock-guarded means each message is
// consumed exactly once whether it's surfaced here or typed in on idle.
function surfaceInbox(name: string): void {
  if (!acquireDeliverLock(name)) return; // deliverNext is mid-delivery — it'll handle them
  try {
    const pending: string[] = [];
    let m: string | null;
    while ((m = queuePop(name)) !== null) pending.push(m);
    const out = buildInboxOutput(pending);
    if (out) process.stdout.write(out);
  } finally {
    releaseDeliverLock(name);
  }
}

export async function hookCommand(event: string): Promise<void> {
  const name = process.env.AGENTMGR_AGENT;
  if (!name) return; // not a managed session
  const agent = readAgent(name);
  if (!agent) return;

  const payload = await readStdinPayload();
  const effects = hookEffects(event, payload);

  const workingSince = agent.workingSince;
  const workedSeconds = workingSince
    ? Math.max(0, (Date.now() - Date.parse(workingSince)) / 1000)
    : 0;

  agent.status = effects.status;
  if (typeof payload.session_id === "string") agent.sessionId = payload.session_id;
  // Codex includes the rollout file path; saves `am transcript` a search.
  if (typeof payload.transcript_path === "string") agent.transcriptPath = payload.transcript_path;
  if (event === "user-prompt-submit" && !agent.workingSince) {
    agent.workingSince = new Date().toISOString();
  }
  if (event === "stop" || event === "session-end") agent.workingSince = undefined;
  writeAgent(agent);

  // Surface any queued peer messages into this turn's context so the agent reads
  // them automatically (UserPromptSubmit stdout is injected as context).
  if (event === "user-prompt-submit") surfaceInbox(name);

  // Keep a last-screen snapshot so the picker can preview dead agents.
  let pane: string[] | null = null;
  if (event === "stop" || event === "session-end") {
    pane = capturePane(agent.tmuxSession, { colors: true });
    if (pane && pane.length > 0) writeSnapshot(name, pane);
  }

  // Standing-relationship backstop: if the agent finished a real work stint
  // and didn't post its own update to reportTo, send a terse heads-up so the
  // lead always hears something. attribute() applies the rate limiter.
  if (event === "stop" && agent.reportTo) {
    const alreadyReported = workingSince
      ? hasMessagedSince(name, agent.reportTo, workingSince)
      : false;
    if (
      shouldReport({
        reportTo: agent.reportTo,
        workedSeconds,
        minSeconds: loadConfig().idleNotifyMinSeconds,
        alreadyReported,
      })
    ) {
      const body = `went idle after ${formatDuration(workedSeconds)}${agent.task ? ` · task: ${agent.task}` : ""}`;
      await deliverReport(name, agent.reportTo, body);
    }
  }

  if (effects.notify) notify(`am: ${name}`, effects.notify);

  if (effects.drainQueue) {
    const depth = queueDepth(name);
    if (depth > 0) {
      // Prefer the daemon as scheduler; fall back to a detached one-shot
      // delivery process when it isn't running.
      if (!(await notifyDaemon(name, "stop"))) spawnDeliver(name);
    } else if (
      event === "stop" &&
      // A waiting agent (scheduled wake-up, background task) hasn't really
      // finished — don't ping the human about it. Best-effort: the indicator
      // may not have rendered yet at hook time.
      !(pane && paneWaitingInfo(pane).waiting) &&
      shouldNotifyIdle({
        config: loadConfig(),
        workedSeconds,
        queueDepth: depth,
        attached: hasAttachedClient(agent.tmuxSession),
      })
    ) {
      notify(`am: ${name}`, `finished — idle after ${formatDuration(workedSeconds)}`);
    }
  }
}
