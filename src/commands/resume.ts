import { existsSync } from "node:fs";
import { resolveAgent, writeAgent } from "../state";
import { hasSession, newSession } from "../tmux";
import { writeHookSettings } from "../settings";
import { ensureDaemon } from "../daemon";
import { queueAppend } from "../queue";
import { agentEnv, agentSystemPrompt, remoteControlArgs, scrubNestedSessionEnv } from "./new";

export async function resumeCommand(
  prefix: string,
  opts: { message?: string; remote?: boolean },
): Promise<void> {
  const agent = resolveAgent(prefix);
  if (hasSession(agent.tmuxSession)) {
    throw new Error(`agent "${agent.name}" is already running — jump with \`am j ${agent.name}\``);
  }
  if (!existsSync(agent.dir)) throw new Error(`agent directory no longer exists: ${agent.dir}`);

  const settingsFile = writeHookSettings();
  if (!(await ensureDaemon())) {
    console.error("warning: daemon failed to start — falling back to hook-only delivery");
  }

  const command = [
    "claude",
    "--settings", settingsFile,
    "--append-system-prompt", agentSystemPrompt(agent.name),
  ];
  // Old state files may predate session-id capture; --continue picks up the
  // most recent conversation in the agent's directory instead.
  if (agent.claudeSessionId) command.push("--resume", agent.claudeSessionId);
  else command.push("--continue");
  // --remote-control last: it would swallow a following positional (like the
  // message) as the remote session's display name. With remote on, the
  // message is queued and delivered by the SessionStart hook instead.
  const remoteArgs = remoteControlArgs(opts.remote);
  if (opts.message && remoteArgs.length === 0) command.push(opts.message);
  command.push(...remoteArgs);
  if (opts.message && remoteArgs.length > 0) queueAppend(agent.name, opts.message);

  newSession({
    session: agent.tmuxSession,
    dir: agent.dir,
    env: agentEnv(agent.name),
    command: scrubNestedSessionEnv(command),
  });
  agent.status = "starting";
  writeAgent(agent);

  console.log(`resumed agent "${agent.name}" in ${agent.dir}`);
  console.log(`  jump to it:  am j ${agent.name}`);
}
