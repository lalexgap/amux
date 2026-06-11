import { resolveAgent } from "../state";
import { queueAppend, queueDepth } from "../queue";
import { hasSession, sendEscape, sendText } from "../tmux";
import { deliverNext } from "../deliver";

function requireLiveSession(prefix: string) {
  const agent = resolveAgent(prefix);
  if (!hasSession(agent.tmuxSession)) {
    throw new Error(`agent "${agent.name}" has no live tmux session (status: ${agent.status})`);
  }
  return agent;
}

export function sendCommand(prefix: string, message: string, opts: { now: boolean }): void {
  const agent = requireLiveSession(prefix);

  if (opts.now) {
    // Inject immediately; Claude Code's native mid-turn steering handles the rest.
    sendText(agent.tmuxSession, message);
    console.log(`sent to "${agent.name}" (steering current turn)`);
    return;
  }

  const depth = queueAppend(agent.name, message);
  if (agent.status === "idle" || agent.status === "starting") {
    // Agent isn't working, so no Stop hook is coming — deliver right away.
    deliverNext(agent.name);
    console.log(`delivered to "${agent.name}" (was idle)`);
  } else {
    console.log(`queued for "${agent.name}" (${depth} in queue) — delivered when it goes idle`);
  }
}

export async function interruptCommand(prefix: string, message: string): Promise<void> {
  const agent = requireLiveSession(prefix);
  sendEscape(agent.tmuxSession);
  await Bun.sleep(400);
  sendText(agent.tmuxSession, message);
  console.log(`interrupted "${agent.name}" with new message`);
}
