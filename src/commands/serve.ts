import { loadConfig } from "../config";
import { apiTokenFile } from "../paths";
import { createApiToken, loadOrCreateApiToken, startApiServer } from "../server";

// `am token` — print the API bearer token (creating one on first use).
export function tokenCommand(opts: { reset?: boolean }): void {
  const token = opts.reset ? createApiToken() : loadOrCreateApiToken();
  console.log(token);
  if (!process.env.AM_API_TOKEN) console.error(`(stored in ${apiTokenFile()})`);
}

// `am serve` — start the HTTP API + PWA for phones. Foreground; meant to run
// under systemd/tmux on the box the fleet lives on.
export function serveCommand(opts: { port?: number; bind?: string }): void {
  const config = loadConfig();
  const token = loadOrCreateApiToken();

  const handle = startApiServer({
    port: opts.port ?? config.apiPort,
    hostname: opts.bind ?? config.apiBind,
    token,
  });

  console.log(`am serve listening on ${handle.url}`);
  console.log(`  PWA:   open ${handle.url}/ on the phone, paste the token below`);
  console.log(`  token: ${token}`);
  if (handle.hostname === "127.0.0.1") {
    console.log(
      `  note:  bound to loopback — set config.apiBind to a tailnet IP, or front it with Caddy/tailscale serve (see docs/ios-app-exploration.md §4e)`,
    );
  }

  const shutdown = () => {
    handle.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
