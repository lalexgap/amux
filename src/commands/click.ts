// Mouse-click URL handling: tmux's mouse_word splits URLs on its default
// word-separators (/ : . -), and per-session separator overrides don't reach
// the mouse_word format — so the click binding sends the whole line plus the
// click column instead, and the URL is extracted here.

const URL_RE = /https?:\/\/[^\s'"()\[\]{}<>]+/g;

export function extractUrlAt(line: string, x: number): string | null {
  for (const match of line.matchAll(URL_RE)) {
    const url = match[0].replace(/[.,;:!?]+$/, ""); // shed trailing punctuation
    if (x >= match.index && x < match.index + url.length) return url;
  }
  return null;
}

export function clickCommand(line: string, x: number): void {
  const url = extractUrlAt(line, x);
  if (!url) return;
  Bun.spawn({ cmd: ["open", url], stdin: "ignore", stdout: "ignore", stderr: "ignore" }).unref();
}
