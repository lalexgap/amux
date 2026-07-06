import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureDirs, queueDir } from "./paths";
import { newMsgId } from "./msgid";

// One directory per agent, one file per message (maildir-style). Appends and
// pops touch different files, so a send can never race a pop into losing a
// message — the old single-JSONL queue rewrote the whole file on pop, and an
// append landing between its read and its rename was silently clobbered.
// File names are msgIds (time-sortable ULIDs), so lexicographic order = FIFO.

interface QueueEntry {
  message: string;
  queuedAt: string;
}

function agentQueueDir(name: string): string {
  return join(queueDir(), name);
}

function legacyQueueFile(name: string): string {
  return join(queueDir(), `${name}.jsonl`);
}

// The pre-maildir queue was a single `<name>.jsonl`. Migrate it on first
// touch: rename-first, so exactly one process wins the claim and performs the
// split — two migrators can't duplicate messages.
function migrateLegacy(name: string): void {
  const legacy = legacyQueueFile(name);
  if (!existsSync(legacy)) return;
  const claimed = `${legacy}.migrating.${process.pid}`;
  try {
    renameSync(legacy, claimed);
  } catch {
    return; // another process claimed the migration
  }
  let lines: string[] = [];
  try {
    lines = readFileSync(claimed, "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "");
  } catch {
    // unreadable — nothing to carry over
  }
  for (const line of lines) {
    try {
      writeEntry(name, JSON.parse(line) as QueueEntry);
    } catch {
      // skip a torn line rather than dropping the whole queue
    }
  }
  rmSync(claimed, { force: true });
}

// Atomic write: tmp + rename, so a reader never sees a half-written message.
function writeEntry(name: string, entry: QueueEntry): void {
  const dir = agentQueueDir(name);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${newMsgId()}.json`);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(entry) + "\n");
  renameSync(tmp, file);
}

function readEntry(file: string): QueueEntry | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as QueueEntry;
  } catch {
    return null; // torn/corrupt entry — callers skip it
  }
}

// A `.taking` claim whose popper crashed mid-pop would strand the message;
// reclaim it once it's clearly abandoned (delivery holds it ~a second).
const TAKING_STALE_MS = 30_000;

function entryFiles(name: string): string[] {
  const dir = agentQueueDir(name);
  if (!existsSync(dir)) return [];
  const names: string[] = [];
  for (const f of readdirSync(dir)) {
    if (f.endsWith(".json")) {
      names.push(f);
    } else if (f.endsWith(".taking")) {
      const path = join(dir, f);
      try {
        if (Date.now() - statSync(path).mtimeMs > TAKING_STALE_MS) {
          const restored = f.slice(0, -".taking".length);
          renameSync(path, join(dir, restored));
          names.push(restored);
        }
      } catch {
        // raced another reclaimer
      }
    }
  }
  return names.sort();
}

export function queueAppend(name: string, message: string): number {
  ensureDirs();
  migrateLegacy(name);
  writeEntry(name, { message, queuedAt: new Date().toISOString() });
  return queueDepth(name);
}

export function queueList(name: string): QueueEntry[] {
  migrateLegacy(name);
  const dir = agentQueueDir(name);
  const out: QueueEntry[] = [];
  for (const f of entryFiles(name)) {
    const entry = readEntry(join(dir, f));
    if (entry) out.push(entry);
  }
  return out;
}

export function queueDepth(name: string): number {
  migrateLegacy(name);
  return entryFiles(name).length;
}

export function queuePeek(name: string): string | null {
  migrateLegacy(name);
  const dir = agentQueueDir(name);
  for (const f of entryFiles(name)) {
    const entry = readEntry(join(dir, f));
    if (entry) return entry.message;
  }
  return null;
}

export function queuePop(name: string): string | null {
  migrateLegacy(name);
  const dir = agentQueueDir(name);
  for (const f of entryFiles(name)) {
    const file = join(dir, f);
    const claimed = `${file}.taking`;
    try {
      renameSync(file, claimed); // atomic claim — a racing popper loses and moves on
    } catch {
      continue;
    }
    const entry = readEntry(claimed);
    rmSync(claimed, { force: true });
    if (entry) return entry.message;
    // corrupt entry — dropped; try the next one
  }
  return null;
}

export function queueClear(name: string): void {
  rmSync(legacyQueueFile(name), { force: true });
  rmSync(agentQueueDir(name), { recursive: true, force: true });
}
