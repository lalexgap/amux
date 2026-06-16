# Search across agents (and their chat text) — plan

Goal (user's words): **search across all agents easily; also search the chat
text, maybe semantic; make it easiest to pick up an old session an agent was
running.**

## What already exists (touch-points)

- `src/transcript.ts` — `locateTranscript(agent)` finds the native JSONL
  (`~/.claude/projects/<slug>/<id>.jsonl`, `~/.codex/sessions/.../rollout-*-<id>.jsonl`);
  `parseTranscript()` → `Turn[]` (user/assistant/tool), already strips sidechain,
  meta, tool noise, and harness prefixes. This is the clean text source.
- `src/commands/ls.ts` — `agentRows()` / `AgentRow`, `displayStatus()`.
- `src/fleet.ts` — federation pattern: remote rows via `am ls --json --local-only`
  over ssh (`fetchRemoteRows`). `PickerItem.search` is today just
  `task + dir + provider + host` substring.
- `src/picker.ts` — `visibleItems()` filters by substring over `name + search`.
- `src/state.ts` — `listAgents()`, `resolveAgent()`, `agentSessionId()`.
- `src/trash.ts` — `listTrashed()` (removed-but-recoverable agents).
- Action mapping for "pick it up":
  - live session → `am j <name>`
  - registered + exited → `am resume <name>`
  - in trash → `am restore <name>`
  - **any historical session by id → `am new <name> --resume <session-id>`**
    (confirmed in `providers.ts`: both claude and codex support resume-by-id).

## Key facts established during exploration

- `/usr/bin/rg` is present. **`rg -l` over the whole 265 MB / 187-file corpus = 46 ms.**
  `rg --json` returns each matching line's full text → we JSON.parse only the
  matched lines (never the whole file).
- Transcripts get huge: largest is **98 MB**. So "parse the whole file into
  Turn[] and search" is unsafe for the `--all` corpus. rg-find-then-parse-matched-lines
  is safe at any size because rg streams and we only parse the lines that hit.
- Two corpora:
  - **Registered agents** (`listAgents()` + trash): small, map directly to
    jump/resume/restore. This is "search across all agents."
  - **All historical sessions** (everything under `~/.claude/projects` +
    `~/.codex/sessions`): 265 MB, recoverable via `am new --resume <id>`. This is
    "pick up an old session an agent was running" even when am never tracked it.

## Ranked approaches

### Tier 1 — `am search` ripgrep full-text  ✅ ship now, zero deps
Single code path that scales from a 4 KB transcript to the 98 MB monster:

1. Build the corpus (file → metadata):
   - registered: `listAgents()` → `locateTranscript()` (skip agents with no
     session yet), tag `{agentName, status, provider, dir, sessionId, action}`.
   - trash: `listTrashed()` → `action: restore`.
   - `--all`: walk `~/.claude/projects/**.jsonl` + `~/.codex/sessions/**.jsonl`;
     sessionId from the filename; dir/startedAt read lazily (first/last line)
     only for files that matched. De-dupe registered files by path.
2. `rg --json -F -i -m <cap> -e <query> -- <files…>` (fixed-string + smart-case
   by default; `--regex` opt-in later).
3. For each `type:match` line: `JSON.parse(data.lines.text)` = the transcript
   entry → run it through a shared `entryPlainText(provider, entry)` helper
   (factored out of `transcript.ts` so the role/harness/tool-noise rules live in
   one place). Build a highlighted snippet windowed on the submatch offset; skip
   pure tool-noise hits.
4. Group matches by file → `SearchResult { agentName?, sessionId, provider, dir,
   status, action, matchCount, snippets[], updatedAt }`.
5. Rank: live agents first, then recency (mtime), then matchCount.
6. Print: glyph + name/session, scope badge, match count, relative time, dir, the
   ready-to-run command, and 1–3 snippets. `--json` emits `SearchResult[]` (for
   the picker and for remote federation).

Scope flags: default = registered + trash; `--all` = history too; `--fleet` =
federate over `config.remotes` by running `am search --json --local-only` per
host and merging (exact mirror of `fetchRemoteRows`). `--limit N`.

Fallback: if `rg` is missing, a small pure-Bun line scanner over the same corpus
(slower, but keeps am self-contained and lets tests run without rg).

**Files:** new `src/search.ts` (core), `src/commands/search.ts` (CLI/format),
`tests/search.test.ts`; edit `src/index.ts` (case `search`/`s` + HELP +
VALUE_FLAGS for `--limit`), small refactor in `src/transcript.ts` to export
`entryPlainText`.

### Tier 1b — picker `/` chat-search mode  (same PR, separable)
A `/` mode in `picker.ts` that shells `am search --json <q>` async (debounced),
maps results → `PickerItem` with the snippet in `meta`, and on Enter runs the
result's action (jump/resume/restore/`new --resume`). Turns the hub into a
chat-searchable picker **without an index**. Medium risk (picker is the most
complex file); ship only if the CLI lands clean, else split to a follow-up.
Note: we do NOT make the live `visibleItems` filter run rg per keystroke — that
mode is explicit and async.

### Tier 2 — semantic search  ⏸ follow-up PR, only if full-text proves thin
- Embedder, pluggable via config: **API-first** (`voyage-3-lite` or OpenAI
  `text-embedding-3-small` — cheap, trivial deps = just `fetch`, needs a key +
  network). Local model (transformers.js / fastembed) avoids cost but adds a big
  dep + model download — not worth it for a single-user CLI v1.
- Store: **`bun:sqlite`** (built into Bun, zero dep). `chunks(session_id, file,
  turn_idx, role, text, ts, mtime, vec BLOB)`; brute-force cosine in JS (a single
  user is low-thousands of chunks → <100 ms). `sqlite-vec` only if it ever grows.
- `am index [--all]`: incremental embed of new/changed turns (track file mtime +
  last turn offset), skipping tool noise. Default semantic search auto-indexes
  only the small registered corpus; `--all` history is opt-in (embedding 265 MB
  is real tokens = cost/minutes).
- Surface: `am search --semantic <q>`, optional hybrid rank with full-text.
- **Why defer:** recurring API cost or a heavy local dep, plus index-freshness
  and complexity, against a need that 46 ms full-text already covers well.

## Recommendation

Ship **Tier 1** (`am search`, ripgrep, zero deps, local + `--all` + `--fleet`)
now; include **Tier 1b** (picker `/`) in the same PR if it lands cleanly, else as
a fast follow. Hold **Tier 2** (semantic) until we see full-text fall short.

## Open questions for sign-off

1. Default scope — registered+trash with `--all` opt-in (my pick), or search all
   history by default?
2. Picker `/` mode in this PR, or CLI-only first?
3. Semantic later at all, and if so API (cost) vs local (dep) for the embedder?
