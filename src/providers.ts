import { writeHookSettings } from "./settings";
import { loadConfig } from "./config";
import { type AgentState, type Provider, agentSessionId } from "./state";

// Injected via --append-system-prompt (claude) or prepended to the initial
// prompt (codex, which has no system-prompt flag) so managed agents know they
// live under am — otherwise "spin up an agent" reaches for built-in subagents.
export function agentSystemPrompt(name: string): string {
  return `You are running as a managed agent named "${name}" in a tmux session controlled by the \`am\` CLI (agent-manager). Other managed agents may be running in parallel.

When asked to spin up, message, check on, or stop OTHER AGENTS, use the am CLI via Bash — not your built-in Task/subagent tool (keep that for quick scoped subtasks inside this session):
- am new <name> [-m "task"] [--dir <path> | --worktree <branch>] [--codex]   (names are global, pick a unique one)
- am send <name> "msg"          queue a message, delivered when that agent goes idle
- am send <name> --now "msg"    steer its current turn immediately
- am interrupt <name> "msg"     abort its turn and redirect it
- am ls --json                  every agent's status and queue depth
- am stop <name> · am resume <name> · am rm <name>

Caveat: an agent spawned into a directory the provider has never trusted blocks on a trust prompt — it lingers in "starting" with no activity. Unblock it with: tmux send-keys -t 'agentmgr-<name>:' Enter`;
}

// When `am new` runs inside a Claude Code session (or the tmux server was
// started from one), spawned agents inherit the CLAUDE_CODE_* family and
// Claude Code treats them as nested child sessions — which silently disables
// conversation persistence, breaking `am resume`. Always launch agents
// through `env -u` for that family.
const NESTED_SESSION_VARS = [
  "CLAUDECODE",
  "CLAUDE_EFFORT",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_SSE_PORT",
];

export function scrubNestedSessionEnv(command: string[]): string[] {
  const vars = new Set(NESTED_SESSION_VARS);
  for (const key of Object.keys(process.env)) {
    if (key === "CLAUDECODE" || key.startsWith("CLAUDE_CODE_") || key === "CLAUDE_EFFORT") {
      vars.add(key);
    }
  }
  return ["env", ...[...vars].sort().flatMap((v) => ["-u", v]), ...command];
}

export interface ConversationOpts {
  message?: string;
  // Adopt an existing conversation: a session id, or `true` to open the
  // provider's interactive session picker inside the new agent.
  resume?: string | boolean;
  continue?: boolean;
}

export function conversationArgs(opts: ConversationOpts): string[] {
  if (opts.resume && opts.continue) throw new Error("--resume and --continue are mutually exclusive");
  if (opts.resume === true) {
    if (opts.message) {
      // `claude --resume "msg"` would parse the message as a session id.
      throw new Error("-m needs a session id: use --resume <session-id>, or drop -m to pick interactively");
    }
    return ["--resume"];
  }
  if (typeof opts.resume === "string") return ["--resume", opts.resume];
  if (opts.continue) return ["--continue"];
  return [];
}

// Codex's resume forms are a subcommand: `codex resume [id|--last] [prompt]`.
export function codexConversationArgs(opts: ConversationOpts): string[] {
  if (opts.resume && opts.continue) throw new Error("--resume and --continue are mutually exclusive");
  if (opts.resume === true) {
    if (opts.message) {
      // `codex resume <msg>` would parse the message as a session/thread id.
      throw new Error("-m needs a session id: use --resume <session-id>, or drop -m to pick interactively");
    }
    return ["resume"];
  }
  if (typeof opts.resume === "string") return ["resume", opts.resume];
  if (opts.continue) return ["resume", "--last"];
  return [];
}

// Suppresses the blocking "Update available!" screen on launch; hooks can't
// ride along here (trust is keyed to the config file they live in — see
// codexHooks.ts), but plain settings overrides are fine.
const CODEX_LAUNCH_OVERRIDES = ["-c", "check_for_update_on_startup=false"];

// Remote control (claude.ai/code + mobile app) is on by default via config;
// an explicit per-agent flag wins over the config value. Claude-only —
// codex has no equivalent.
export function remoteControlArgs(override: boolean | undefined): string[] {
  return (override ?? loadConfig().remoteControl) ? ["--remote-control"] : [];
}

export interface LaunchOpts extends ConversationOpts {
  // Per-agent remote-control override; undefined = config default.
  remote?: boolean;
}

export interface LaunchPlan {
  command: string[];
  // --remote-control greedily consumes a following positional as the remote
  // session's display name — including what was meant to be the initial
  // prompt. With remote on, the message comes back here instead, for the
  // caller to queue; the SessionStart hook delivers it once the TUI is up.
  deferredMessage?: string;
}

function claudeCommand(name: string, conversation: string[], opts: LaunchOpts): LaunchPlan {
  const remoteArgs = remoteControlArgs(opts.remote);
  const command = [
    "claude",
    "--settings", writeHookSettings(),
    "--append-system-prompt", agentSystemPrompt(name),
    ...conversation,
  ];
  if (opts.message && remoteArgs.length === 0) command.push(opts.message);
  command.push(...remoteArgs);
  return {
    command,
    deferredMessage: opts.message && remoteArgs.length > 0 ? opts.message : undefined,
  };
}

export function buildLaunchCommand(provider: Provider, name: string, opts: LaunchOpts): LaunchPlan {
  if (provider === "codex") {
    const command = ["codex", ...CODEX_LAUNCH_OVERRIDES, ...codexConversationArgs(opts)];
    if (opts.message) command.push(`${agentSystemPrompt(name)}\n\n# Your task\n\n${opts.message}`);
    return { command };
  }
  return claudeCommand(name, conversationArgs(opts), opts);
}

export function buildResumeCommand(
  provider: Provider,
  agent: AgentState,
  opts: { message?: string; remote?: boolean },
): LaunchPlan {
  const sessionId = agentSessionId(agent);
  if (provider === "codex") {
    // Old state files may predate session-id capture; --last picks up the
    // most recent conversation instead.
    const command = ["codex", ...CODEX_LAUNCH_OVERRIDES, "resume", ...(sessionId ? [sessionId] : ["--last"])];
    if (opts.message) command.push(opts.message);
    return { command };
  }
  return claudeCommand(agent.name, sessionId ? ["--resume", sessionId] : ["--continue"], opts);
}
