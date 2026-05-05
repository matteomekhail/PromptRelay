import { writeFile, unlink, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir, platform } from "node:os";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

const SERVICE_LABEL = "com.promptrelay.volunteer";
const LOG_DIR = join(homedir(), ".promptrelay");
const LOG_FILE = join(LOG_DIR, "daemon.log");

function getPlistPath(): string {
  return join(homedir(), "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`);
}

function getDaemonScript(): string {
  // Points to the globally linked CLI
  return join(homedir(), ".promptrelay", "run-daemon.sh");
}

export async function installService(): Promise<void> {
  if (platform() !== "darwin") {
    throw new Error("Background service auto-install only supports macOS for now. Use `promptrelay --foreground` on other systems.");
  }

  await mkdir(LOG_DIR, { recursive: true });

  // Create a runner script that the service will execute
  const scriptPath = getDaemonScript();
  const cliPath = process.argv[1]; // path to the running script

  const script = `#!/bin/bash
export PATH="$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"
exec node "${cliPath}" --foreground >> "${LOG_FILE}" 2>&1
`;
  await writeFile(scriptPath, script, { mode: 0o755 });

  // Create launchd plist
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${SERVICE_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${scriptPath}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${LOG_FILE}</string>
    <key>StandardErrorPath</key>
    <string>${LOG_FILE}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${homedir()}/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>
`;

  const plistPath = getPlistPath();
  await writeFile(plistPath, plist);

  // Load the service
  await execFileAsync("launchctl", ["load", plistPath]);
}

export async function uninstallService(): Promise<void> {
  const plistPath = getPlistPath();

  if (existsSync(plistPath)) {
    try {
      await execFileAsync("launchctl", ["unload", plistPath]);
    } catch {
      // May already be unloaded
    }
    await unlink(plistPath);
  }

  const scriptPath = getDaemonScript();
  if (existsSync(scriptPath)) {
    await unlink(scriptPath);
  }
}

export async function isServiceRunning(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("launchctl", ["list"]);
    return stdout.includes(SERVICE_LABEL);
  } catch {
    return false;
  }
}

export async function getServiceStatus(): Promise<{
  installed: boolean;
  running: boolean;
  logFile: string;
}> {
  const installed = existsSync(getPlistPath());
  const running = await isServiceRunning();
  return { installed, running, logFile: LOG_FILE };
}

export async function restartService(): Promise<void> {
  const plistPath = getPlistPath();
  try {
    await execFileAsync("launchctl", ["unload", plistPath]);
  } catch { /* ignore */ }
  await execFileAsync("launchctl", ["load", plistPath]);
}
