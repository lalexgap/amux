import { readFileSync } from "node:fs";
import { expandHome } from "./paths";

// The initial task for `am new` / `am run`, from the parsed flags:
//   -m <text>        literal
//   -m -             read from stdin
//   --file <path>    read the task from a file
// The last two dodge shell-quoting a long prompt. Mutually exclusive with -m.
// Crucially this ERRORS rather than silently booting a taskless agent — which is
// what used to happen when --file (unsupported here) was quietly ignored.
export async function resolveTask(
  flags: { m?: unknown; message?: unknown; file?: unknown },
  readStdin: () => Promise<string> = () => Bun.stdin.text(),
): Promise<string | undefined> {
  let message = (flags.m ?? flags.message) as string | undefined;
  const file = flags.file as string | undefined;
  if (file) {
    if (message !== undefined) throw new Error("pass the task with either -m or --file, not both");
    const body = readFileSync(expandHome(file), "utf8").replace(/\s+$/, "");
    if (!body) throw new Error(`--file ${file} is empty`);
    return body;
  }
  if (message === "-") {
    message = (await readStdin()).replace(/\s+$/, "");
    if (!message) throw new Error("no task on stdin");
  }
  return message;
}
