import { spawn } from "node:child_process";

export function killProcessTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
      });
      killer.on("exit", () => resolve());
      killer.on("error", () => resolve());
    } else {
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          /* ignore */
        }
      }
      resolve();
    }
  });
}

export function spawnOptions(): { detached: boolean; windowsHide: boolean } {
  return {
    detached: process.platform !== "win32",
    windowsHide: true,
  };
}
