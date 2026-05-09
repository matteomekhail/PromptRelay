#!/usr/bin/env node
import chalk from "chalk";
import ora from "ora";
import type { FunctionReference } from "convex/server";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loginWithDeviceFlow, logout } from "./auth.js";
import {
  getConfig,
  setConvexUrl,
  setAppUrl,
  isAuthenticated,
} from "./config.js";
import { detectAvailableProviders } from "./executors/index.js";
import { Daemon } from "./daemon.js";
import { runSettingsTui } from "./settings-tui.js";
import {
  installService,
  uninstallService,
  getServiceStatus,
} from "./service.js";

const arg = process.argv[2];

async function main() {
  // Handle sub-commands
  if (arg === "login") {
    const { username } = await loginWithDeviceFlow();
    await ensureVolunteerRole();
    console.log(chalk.green(`\n  Signed in as ${username}\n`));
    return;
  }

  if (arg === "logout") {
    logout();
    console.log(chalk.dim("\n  Signed out.\n"));
    return;
  }

  if (arg === "whoami") {
    const config = getConfig();
    if (!isAuthenticated()) {
      console.log(chalk.yellow("\n  Not signed in.\n"));
      process.exit(1);
    }
    console.log(chalk.dim("\n  PromptRelay — Account\n"));
    console.log(`  GitHub: ${config.githubUsername}`);
    console.log(`  App:    ${config.appUrl}`);
    console.log(`  Convex: ${config.convexUrl}`);
    console.log();
    return;
  }

  if (arg === "stop") {
    await uninstallService();
    console.log(chalk.dim("\n  PromptRelay daemon stopped and uninstalled.\n"));
    return;
  }

  if (arg === "status") {
    const status = await getServiceStatus();
    const currentTasks = await getCurrentTasks().catch(() => []);
    console.log(chalk.dim("\n  PromptRelay — Status\n"));
    console.log(`  Installed: ${status.installed ? chalk.green("yes") : "no"}`);
    console.log(`  Running: ${status.running ? chalk.green("yes") : "no"}`);
    if (currentTasks.length > 0) {
      for (const task of currentTasks) {
        console.log(`  Current: ${chalk.cyan(task.title)} (${task.status})`);
        if (task.githubIssueUrl) {
          console.log(`  Issue:   ${chalk.dim(task.githubIssueUrl)}`);
        }
        if (task.lastHeartbeatAt) {
          console.log(`  Sync:    ${chalk.dim(timeAgo(task.lastHeartbeatAt))}`);
        }
      }
    } else {
      console.log(`  Current: ${chalk.dim("none")}`);
    }
    console.log(`  Logs: ${chalk.dim(status.logFile)}`);
    console.log();
    return;
  }

  if (arg === "logs") {
    const status = await getServiceStatus();
    const { execFile } = await import("node:child_process");
    execFile("tail", ["-f", status.logFile], (err, stdout) => {
      if (stdout) process.stdout.write(stdout);
    }).stdout?.pipe(process.stdout);
    return;
  }

  if (!arg || arg === "settings" || arg === "config") {
    await runSettingsTui();
    return;
  }

  if (arg !== "start" && arg !== "--foreground") {
    console.log(chalk.red(`\n  Unknown command: ${arg}\n`));
    console.log(chalk.dim("  Usage: promptrelay [login|logout|whoami|settings|start|--foreground|status|logs|stop]\n"));
    process.exit(1);
  }

  // ─── Main flow ─────────────────────────────────────────────────────────────

  console.log(chalk.dim("\n  ┌─────────────────────────────────────────┐"));
  console.log(chalk.dim("  │") + "  PromptRelay — Volunteer Daemon     " + chalk.dim("│"));
  console.log(chalk.dim("  └─────────────────────────────────────────┘\n"));

  // Ensure Convex URL
  const envConvexUrl = process.env.PROMPTRELAY_CONVEX_URL;
  const envAppUrl = process.env.PROMPTRELAY_APP_URL;
  if (envConvexUrl) {
    setConvexUrl(envConvexUrl);
  }
  if (envAppUrl) {
    setAppUrl(envAppUrl);
  }
  if (!getConfig().convexUrl) {
    throw new Error("PROMPTRELAY_CONVEX_URL is not configured.");
  }

  // Auth
  if (!isAuthenticated()) {
    console.log(chalk.dim("  First run — signing in with GitHub...\n"));
    try {
      const { username } = await loginWithDeviceFlow();
      console.log(chalk.green(`\n  Signed in as ${username}\n`));
    } catch (err) {
      console.error(chalk.red(`  ${(err as Error).message}\n`));
      process.exit(1);
    }
  } else {
    const config = getConfig();
    console.log(`  ${chalk.dim("User:")} ${config.githubUsername}`);
  }

  // Register as volunteer
  const config = getConfig();
  await ensureVolunteerRole();

  // Detect providers
  const spinner = ora("  Detecting AI providers...").start();
  const available = await detectAvailableProviders();
  spinner.stop();

  if (available.length > 0) {
    console.log(`  ${chalk.dim("Providers:")} ${available.map((e) => e.displayName).join(", ")}`);
  } else {
    console.log(`  ${chalk.dim("Providers:")} ${chalk.yellow("none (install Claude Code or Codex)")}`);
  }

  console.log(`  ${chalk.dim("Max tasks/day:")} ${config.maxTasksPerDay}`);
  console.log(
    `  ${chalk.dim("Execution:")} ${
      config.allowUnsafeExecution ? chalk.yellow("full access") : chalk.green("sandboxed")
    }`
  );

  // If --foreground flag, run in foreground (used by the background service)
  if (arg === "--foreground") {
    await runForeground();
    return;
  }

  if (!config.autoApprove) {
    console.log(chalk.dim("\n  Manual approval is enabled; running in foreground.\n"));
    console.log(chalk.dim("  Enable auto-approve in `promptrelay` settings to install a background service.\n"));
    await runForeground();
    return;
  }

  // Default: install as background service
  console.log(chalk.dim("\n  Installing background service...\n"));

  try {
    await installService();
    await getServiceStatus();

    console.log(chalk.green("  ✓ Daemon installed and running in background.\n"));
    console.log(chalk.dim("  It will:"));
    console.log(chalk.dim("    • Start automatically on login"));
    console.log(chalk.dim("    • Watch for tasks 24/7"));
    console.log(chalk.dim("    • Execute using your local AI tools\n"));
    console.log(`  ${chalk.dim("Logs:")}    promptrelay logs`);
    console.log(`  ${chalk.dim("Status:")}  promptrelay status`);
    console.log(`  ${chalk.dim("Config:")}  promptrelay`);
    console.log(`  ${chalk.dim("Stop:")}    promptrelay stop`);
    console.log();
  } catch (err) {
    console.log(chalk.yellow(`  Could not install background service: ${(err as Error).message}`));
    console.log(chalk.dim("  Running in foreground instead...\n"));
    await runForeground();
  }
}

async function runForeground() {
  console.log(chalk.dim("  Watching for tasks...\n"));

  const daemon = new Daemon({
    onTaskFound: (task) => {
      log(`${chalk.cyan("→")} Found: ${task.title} [${task.priority}]`);
    },
    onTaskApprovalRequired: async (task) => {
      if (!process.stdin.isTTY) {
        log(`${chalk.yellow("!")} Manual approval required; skipping ${task.title}`);
        return false;
      }

      const rl = readline.createInterface({ input, output });
      try {
        const answer = await rl.question(
          `  Run this task locally? ${chalk.bold(task.title)} [y/N]: `
        );
        return ["y", "yes"].includes(answer.trim().toLowerCase());
      } finally {
        rl.close();
      }
    },
    onTaskClaimed: (task) => {
      log(`${chalk.blue("◆")} Claimed: ${task.title}`);
    },
    onTaskRunning: (task, provider) => {
      log(`${chalk.magenta("▶")} Running (${provider}): ${task.title}`);
    },
    onTaskPreview: (_task, _provider, command) => {
      log(`${chalk.dim("preview:")} ${command}`);
    },
    onTaskCompleted: (task, durationMs) => {
      log(`${chalk.green("✓")} Done: ${task.title} (${(durationMs / 1000).toFixed(1)}s)`);
    },
    onTaskError: (task, error) => {
      log(`${chalk.red("✗")} Failed: ${task.title} — ${error.message}`);
    },
    onIdle: () => {},
    onError: (error) => {
      log(`${chalk.red("!")} ${error.message}`);
    },
  });

  process.on("SIGINT", () => {
    daemon.stop();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    daemon.stop();
    process.exit(0);
  });

  await daemon.start();
}

function log(msg: string) {
  const ts = new Date().toLocaleTimeString();
  console.log(`  ${chalk.dim(ts)} ${msg}`);
}

async function ensureVolunteerRole(): Promise<void> {
  const { ConvexHttpClient } = await import("convex/browser");
  const { getConvexAuthToken } = await import("./convex-auth.js");
  const config = getConfig();
  const token = await getConvexAuthToken();
  const client = new ConvexHttpClient(config.convexUrl, { auth: token });

  try {
    await client.mutation(
      "users:upsertFromGitHub" as unknown as FunctionReference<"mutation">,
      {}
    );
    await client.mutation("users:setRole" as unknown as FunctionReference<"mutation">, {
      role: "VOLUNTEER",
    });
  } catch {
    // Already registered
  }
}

type CurrentTask = {
  title: string;
  status: string;
  githubIssueUrl?: string;
  lastHeartbeatAt?: number;
};

async function getCurrentTasks(): Promise<CurrentTask[]> {
  if (!isAuthenticated()) return [];
  const { ConvexHttpClient } = await import("convex/browser");
  const { getConvexAuthToken } = await import("./convex-auth.js");
  const config = getConfig();
  const token = await getConvexAuthToken();
  const client = new ConvexHttpClient(config.convexUrl, { auth: token });
  return await client.query(
    "tasks:currentForVolunteer" as unknown as FunctionReference<"query">,
    {}
  ) as CurrentTask[];
}

function timeAgo(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

main().catch((err) => {
  console.error(chalk.red(`\n  Fatal: ${err.message}\n`));
  process.exit(1);
});
