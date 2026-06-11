import { removeAgent, resolveAgent } from "../state";
import { queueClear } from "../queue";
import { hasSession, killSession } from "../tmux";

export function rmCommand(prefix: string, opts: { clean: boolean }): void {
  const agent = resolveAgent(prefix);

  if (hasSession(agent.tmuxSession)) killSession(agent.tmuxSession);

  if (opts.clean && agent.worktreePath && agent.repoRoot) {
    const result = Bun.spawnSync([
      "git", "-C", agent.repoRoot,
      "worktree", "remove", "--force", agent.worktreePath,
    ]);
    if (result.exitCode !== 0) {
      console.error(`warning: failed to remove worktree: ${result.stderr.toString().trim()}`);
    } else {
      console.log(`removed worktree ${agent.worktreePath}`);
    }
  }

  queueClear(agent.name);
  removeAgent(agent.name);
  console.log(`removed agent "${agent.name}"`);
}
