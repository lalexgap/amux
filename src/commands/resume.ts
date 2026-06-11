import { existsSync } from "node:fs";
import { agentProvider, resolveAgent, writeAgent } from "../state";
import { hasSession, newSession } from "../tmux";
import { ensureDaemon } from "../daemon";
import { queueAppend } from "../queue";
import { buildResumeCommand, scrubNestedSessionEnv } from "../providers";
import { ensureCodexHooks } from "../codexHooks";
import { agentEnv } from "./new";

export async function resumeCommand(
  prefix: string,
  opts: { message?: string; remote?: boolean },
): Promise<void> {
  const agent = resolveAgent(prefix);
  if (hasSession(agent.tmuxSession)) {
    throw new Error(`agent "${agent.name}" is already running — jump with \`am j ${agent.name}\``);
  }
  if (!existsSync(agent.dir)) throw new Error(`agent directory no longer exists: ${agent.dir}`);

  const provider = agentProvider(agent);
  if (!(await ensureDaemon())) {
    console.error("warning: daemon failed to start — falling back to hook-only delivery");
  }
  if (provider === "codex") ensureCodexHooks();

  const plan = buildResumeCommand(provider, agent, opts);
  // Queue before the session starts so the SessionStart hook finds it.
  if (plan.deferredMessage) queueAppend(agent.name, plan.deferredMessage);

  newSession({
    session: agent.tmuxSession,
    dir: agent.dir,
    env: agentEnv(agent.name),
    command: scrubNestedSessionEnv(plan.command),
  });
  agent.status = "starting";
  writeAgent(agent);

  console.log(`resumed agent "${agent.name}" in ${agent.dir}`);
  console.log(`  jump to it:  am j ${agent.name}`);
}
