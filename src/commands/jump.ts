import { readLastAttached, recordAttached, resolveAgent } from "../state";
import { attachOrSwitch, hasSession } from "../tmux";

export function jumpCommand(prefix: string): void {
  const agent = resolveAgent(prefix);
  if (!hasSession(agent.tmuxSession)) {
    throw new Error(`agent "${agent.name}" has no live tmux session (status: ${agent.status})`);
  }
  recordAttached(agent.name);
  attachOrSwitch(agent.tmuxSession);
}

export function jumpPreviousCommand(): void {
  const { previous } = readLastAttached();
  if (!previous) throw new Error("no previous agent to jump to");
  jumpCommand(previous);
}
