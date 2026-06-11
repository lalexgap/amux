export interface PickerItem {
  name: string;
  label: string;
}

const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const CLEAR_LINE = "\x1b[2K";

export async function pick(items: PickerItem[]): Promise<string | null> {
  if (items.length === 0) return null;
  if (!process.stdin.isTTY) throw new Error("interactive picker needs a TTY (use `am ls` / `am j <name>`)");

  let filter = "";
  let cursor = 0;
  let renderedLines = 0;

  const out = (s: string) => process.stdout.write(s);

  const filtered = () => items.filter((i) => i.name.includes(filter));

  const render = () => {
    if (renderedLines > 0) out(`\x1b[${renderedLines}A`);
    const matches = filtered();
    if (cursor >= matches.length) cursor = Math.max(0, matches.length - 1);

    const lines = [
      `filter: ${filter}\x1b[0m`,
      ...matches.map((item, i) => (i === cursor ? `\x1b[7m❯ ${item.label}\x1b[0m` : `  ${item.label}`)),
      ...(matches.length === 0 ? ["  (no matches)"] : []),
      "\x1b[2m(type to filter · ↑/↓ · enter jumps · esc cancels)\x1b[0m",
    ];
    // Pad with blank lines so shrinking the match list leaves no stale rows.
    while (lines.length < renderedLines) lines.push("");
    out(lines.map((l) => CLEAR_LINE + "\r" + l).join("\n") + "\n");
    renderedLines = lines.length;
  };

  process.stdin.setRawMode(true);
  process.stdin.resume();
  out(HIDE_CURSOR);
  render();

  const result = await new Promise<string | null>((resolve) => {
    const onData = (data: Buffer) => {
      const key = data.toString();
      if (key === "\x03" || key === "\x1b") return finish(null); // ctrl-c / esc
      if (key === "\r" || key === "\n") {
        const match = filtered()[cursor];
        return finish(match ? match.name : null);
      }
      if (key === "\x1b[A") cursor = Math.max(0, cursor - 1);
      else if (key === "\x1b[B") cursor = Math.min(filtered().length - 1, cursor + 1);
      else if (key === "\x7f" || key === "\b") filter = filter.slice(0, -1);
      else if (key >= " " && !key.startsWith("\x1b")) filter += key;
      render();
    };

    const finish = (value: string | null) => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      // Erase the picker so the attach starts on a clean screen.
      out(`\x1b[${renderedLines}A`);
      for (let i = 0; i < renderedLines; i++) out(CLEAR_LINE + "\n");
      out(`\x1b[${renderedLines}A` + SHOW_CURSOR);
      resolve(value);
    };

    process.stdin.on("data", onData);
  });

  return result;
}
