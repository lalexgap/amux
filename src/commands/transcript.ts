import { readFileSync, writeFileSync } from "node:fs";
import { agentProvider, resolveAgent } from "../state";
import { locateTranscript, parseTranscript, renderTranscript } from "../transcript";

export function transcriptCommand(prefix: string, opts: { full?: boolean; out?: string }): void {
  const agent = resolveAgent(prefix);
  const file = locateTranscript(agent);
  const transcript = parseTranscript(agentProvider(agent), readFileSync(file, "utf8"));
  const markdown = renderTranscript(transcript, { full: opts.full, agentName: agent.name });
  if (opts.out) {
    writeFileSync(opts.out, markdown);
    console.log(`wrote ${opts.out}`);
  } else {
    console.log(markdown);
  }
}
