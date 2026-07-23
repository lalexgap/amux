import { fleetRows } from "../fleet";
import { buildFleetSummary, formatFleetSummary } from "../summary";

export function summaryCommand(opts: { json?: boolean; localOnly?: boolean } = {}): void {
  const summary = buildFleetSummary(fleetRows({ localOnly: opts.localOnly }));
  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  console.log(formatFleetSummary(summary).join("\n"));
}
