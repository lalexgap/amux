import { readAgent } from "./state";
import { queuePop } from "./queue";
import { hasSession, sendText } from "./tmux";
import { cliEntrypoint } from "./settings";

// Pop the queue head and type it into the agent's session.
export function deliverNext(name: string): boolean {
  const agent = readAgent(name);
  if (!agent || !hasSession(agent.tmuxSession)) return false;
  const message = queuePop(name);
  if (message === null) return false;
  sendText(agent.tmuxSession, message);
  return true;
}

// Fire-and-forget delivery from inside a hook. The hook must exit promptly
// (Claude Code blocks on it), and the TUI needs a beat to get back to its
// prompt — so a detached process sleeps briefly, then delivers.
export function spawnDeliver(name: string): void {
  Bun.spawn({
    cmd: [process.execPath, cliEntrypoint(), "__deliver", name],
    env: { ...process.env },
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  }).unref();
}

export async function deliverCommand(name: string): Promise<void> {
  await Bun.sleep(500);
  deliverNext(name);
}
