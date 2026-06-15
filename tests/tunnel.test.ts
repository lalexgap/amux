import { describe, expect, test } from "bun:test";
import { nextBackoffMs, reverseTunnelArgs } from "../src/tunnel";

describe("reverseTunnelArgs", () => {
  test("builds a keepalive'd reverse forward pinned to server loopback", () => {
    const argv = reverseTunnelArgs("server", 2222, 22);
    expect(argv[0]).toBe("ssh");
    expect(argv).toContain("-N");
    expect(argv).toContain("-R");
    // explicit localhost: bind so the server can't expose it on its LAN
    expect(argv).toContain("localhost:2222:localhost:22");
    expect(argv).toContain("ExitOnForwardFailure=yes");
    expect(argv).toContain("ServerAliveInterval=15");
    // dedicated connection — never multiplex onto a user ControlMaster
    expect(argv).toContain("ControlMaster=no");
    expect(argv).toContain("ControlPath=none");
    expect(argv.at(-1)).toBe("server"); // host is last
  });

  test("honors a custom server port and local sshd port", () => {
    expect(reverseTunnelArgs("box", 9000, 2200)).toContain("localhost:9000:localhost:2200");
  });
});

describe("nextBackoffMs", () => {
  test("doubles up to a 30s cap, and resets after a healthy uptime", () => {
    expect(nextBackoffMs(1000, 0)).toBe(2000); // crashed fast → back off
    expect(nextBackoffMs(2000, 0)).toBe(4000);
    expect(nextBackoffMs(20000, 0)).toBe(30000); // capped
    expect(nextBackoffMs(30000, 0)).toBe(30000); // stays capped
    expect(nextBackoffMs(30000, 120000)).toBe(1000); // was up 2min → reset to floor
  });
});
