import { existsSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentsDir, ensureDirs, lastAttachedFile } from "./paths";

export type AgentStatus =
  | "starting"
  | "idle"
  | "working"
  | "needs-attention"
  | "exited";

export type Provider = "claude" | "codex";

export interface AgentState {
  name: string;
  status: AgentStatus;
  dir: string;
  tmuxSession: string;
  // Absent in state files written before multi-provider support → claude.
  provider?: Provider;
  // Set only for --worktree agents, so `am rm --clean` can remove the worktree.
  worktreePath?: string;
  worktreeBranch?: string;
  repoRoot?: string;
  // Conversation/session id, captured from hook payloads — lets `am resume`
  // reopen the exact conversation after the session exits.
  sessionId?: string;
  // Legacy name for sessionId; still read as a fallback.
  claudeSessionId?: string;
  // Codex reports the rollout file location in hook payloads; saved so
  // `am transcript` doesn't have to search ~/.codex/sessions for it.
  transcriptPath?: string;
  // The initial -m message: what this agent is for. Searchable in the picker.
  task?: string;
  // Set when a turn starts, used to measure the work stint for idle
  // notifications.
  workingSince?: string;
  // Standing report relationship: this agent keeps `reportTo` posted. Drives
  // the primer briefing and the Stop-hook backstop heads-up.
  reportTo?: string;
  // The agent that ran `am new` to create this one (AGENTMGR_AGENT at spawn).
  // Lets `--report` / a bare report target default to "whoever made me".
  spawnedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export function agentProvider(state: AgentState): Provider {
  return state.provider ?? "claude";
}

export function agentSessionId(state: AgentState): string | undefined {
  return state.sessionId ?? state.claudeSessionId;
}

function stateFile(name: string): string {
  return join(agentsDir(), `${name}.json`);
}

// Tolerant read: a torn/corrupt state file is treated as absent instead of
// throwing — one bad byte must not brick every am command (and every hook).
function readStateFile(file: string): AgentState | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as AgentState;
  } catch {
    return null;
  }
}

export function readAgent(name: string): AgentState | null {
  const file = stateFile(name);
  if (!existsSync(file)) return null;
  return readStateFile(file);
}

// Unique tmp + rename: state files are written by several processes at once
// (hooks, the CLI, the daemon) and read constantly — a reader must never see
// a torn write, and two concurrent writers must never interleave into
// invalid JSON. Last rename wins with a complete document either way.
function writeJsonAtomic(file: string, value: unknown): void {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
  renameSync(tmp, file);
}

export function writeAgent(state: AgentState): void {
  ensureDirs();
  state.updatedAt = new Date().toISOString();
  writeJsonAtomic(stateFile(state.name), state);
}

export function setStatus(name: string, status: AgentStatus): void {
  const state = readAgent(name);
  if (!state) return;
  state.status = status;
  writeAgent(state);
}

export function removeAgent(name: string): void {
  rmSync(stateFile(name), { force: true });
}

export function listAgents(): AgentState[] {
  if (!existsSync(agentsDir())) return [];
  return readdirSync(agentsDir())
    .filter((f) => f.endsWith(".json"))
    .map((f) => readStateFile(join(agentsDir(), f)))
    .filter((s): s is AgentState => s !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Exact match wins; otherwise the prefix must be unambiguous.
export function resolveAgentName(prefix: string, names: string[]): string {
  if (names.includes(prefix)) return prefix;
  const matches = names.filter((n) => n.startsWith(prefix));
  if (matches.length === 1) return matches[0]!;
  if (matches.length === 0) throw new Error(`no agent matches "${prefix}"`);
  throw new Error(`"${prefix}" is ambiguous: ${matches.join(", ")}`);
}

export function resolveAgent(prefix: string): AgentState {
  const names = listAgents().map((a) => a.name);
  if (names.length === 0) throw new Error("no agents exist — create one with `am new <name>`");
  const name = resolveAgentName(prefix, names);
  return readAgent(name)!;
}

interface LastAttached {
  current?: string;
  previous?: string;
}

export function readLastAttached(): LastAttached {
  if (!existsSync(lastAttachedFile())) return {};
  try {
    return JSON.parse(readFileSync(lastAttachedFile(), "utf8")) as LastAttached;
  } catch {
    return {};
  }
}

export function recordAttached(name: string): void {
  ensureDirs();
  const last = readLastAttached();
  if (last.current === name) return;
  writeJsonAtomic(lastAttachedFile(), { current: name, previous: last.current });
}
