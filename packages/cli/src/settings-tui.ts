import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import chalk from "chalk";
import { ConvexHttpClient } from "convex/browser";
import type { FunctionReference } from "convex/server";
import {
  getConfig,
  setConfig,
  SUPPORTED_PROVIDERS,
  type VolunteerConfig,
} from "./config.js";
import { getConvexAuthToken } from "./convex-auth.js";

const ALL_CATEGORIES = ["docs", "tests", "bugfix", "review", "refactor", "translation"];
const ALL_PROVIDERS: string[] = [...SUPPORTED_PROVIDERS];

export async function runSettingsTui(): Promise<void> {
  const rl = readline.createInterface({ input, output });

  try {
    let done = false;
    let preferencesChanged = false;
    while (!done) {
      renderSettings();
      const choice = await ask(rl, "Select an option");

      switch (choice.trim()) {
        case "1":
          await editNumber(rl, "Max tasks per day", "maxTasksPerDay", 1, 50);
          preferencesChanged = true;
          break;
        case "2":
          await editCategoryToggles(rl);
          preferencesChanged = true;
          break;
        case "3":
          await editProviderToggles(rl);
          preferencesChanged = true;
          break;
        case "4":
          await editTrustedProjects(rl);
          preferencesChanged = true;
          break;
        case "5":
          toggleBoolean("allowUnsafeExecution");
          preferencesChanged = true;
          break;
        case "6":
          toggleBoolean("autoApprove");
          preferencesChanged = true;
          break;
        case "0":
        case "q":
        case "Q":
          done = true;
          break;
        default:
          await pause(rl, "Unknown option.");
      }
    }
    if (preferencesChanged) {
      await savePreferences();
    }
  } finally {
    rl.close();
  }
}

function renderSettings() {
  const config = getConfig();
  console.clear();
  console.log(chalk.dim("┌─────────────────────────────────────────┐"));
  console.log(chalk.dim("│") + "  PromptRelay — Volunteer Settings  " + chalk.dim("│"));
  console.log(chalk.dim("└─────────────────────────────────────────┘\n"));
  console.log(`${chalk.dim("Account:")} ${config.githubUsername ?? "not signed in"}`);
  console.log(`${chalk.dim("Connection:")} ${formatConnection(config)}`);
  console.log();
  console.log(`  1. Max tasks/day        ${chalk.cyan(config.maxTasksPerDay)}`);
  console.log(`  2. Categories           ${formatList(config.allowedCategories)}`);
  console.log(`  3. Providers            ${formatProviders(config.providers)}`);
  console.log(`  4. Trusted projects     ${formatList(config.trustedProjects)}`);
  console.log(`  5. Protected execution  ${formatProtectedExecution(config.allowUnsafeExecution)}`);
  console.log(`  6. Auto-approve trusted ${formatBoolean(config.autoApprove)}`);
  console.log();
  console.log(`  0. Save and exit\n`);
}

async function editNumber(
  rl: readline.Interface,
  label: string,
  key: "maxTasksPerDay" | "idleCheckIntervalMs",
  min: number,
  max: number
) {
  const current = getConfig()[key];
  const value = await ask(rl, `${label} (${min}-${max})`, String(current));
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    await pause(rl, `Enter a whole number between ${min} and ${max}.`);
    return;
  }
  setConfig(key, parsed);
}

async function editCategoryToggles(rl: readline.Interface) {
  await editStringToggles(rl, {
    title: "Allowed Categories",
    values: ALL_CATEGORIES,
    getSelected: () => getConfig().allowedCategories,
    save: (selected) => setConfig("allowedCategories", selected),
  });
}

async function editProviderToggles(rl: readline.Interface) {
  await editStringToggles(rl, {
    title: "Enabled Providers",
    values: ALL_PROVIDERS,
    getSelected: () =>
      getConfig()
        .providers.filter((provider) => provider.enabled)
        .map((provider) => provider.provider),
    save: (selected) =>
      setConfig(
        "providers",
        ALL_PROVIDERS.map((provider) => ({
          provider,
          enabled: selected.includes(provider),
        }))
      ),
  });
}

async function editStringToggles(
  rl: readline.Interface,
  options: {
    title: string;
    values: string[];
    getSelected: () => string[];
    save: (selected: string[]) => void;
  }
) {
  let selected = options.getSelected();
  let done = false;

  while (!done) {
    console.clear();
    console.log(chalk.bold(options.title));
    console.log();
    options.values.forEach((value, index) => {
      const mark = selected.includes(value) ? chalk.green("●") : chalk.dim("○");
      console.log(`  ${index + 1}. ${mark} ${value}`);
    });
    console.log("\n  0. Back\n");

    const choice = await ask(rl, "Toggle option");
    const index = Number(choice) - 1;
    if (choice === "0") {
      done = true;
    } else if (index >= 0 && index < options.values.length) {
      const value = options.values[index];
      selected = selected.includes(value)
        ? selected.filter((item) => item !== value)
        : [...selected, value];
      options.save(selected);
    }
  }
}

async function editTrustedProjects(rl: readline.Interface) {
  const current = getConfig().trustedProjects.join(", ");
  const value = await ask(
    rl,
    "Trusted GitHub repos (owner/repo or URL, comma-separated, * for all)",
    current
  );
  const projects = value
    .split(",")
    .map((project) => project.trim())
    .filter(Boolean);
  setConfig("trustedProjects", projects);
}

function toggleBoolean(key: "allowUnsafeExecution" | "autoApprove") {
  setConfig(key, !getConfig()[key]);
}

async function savePreferences() {
  const config = getConfig();
  if (!config.convexUrl) {
    console.log(chalk.yellow("\nSaved locally. Connect your account to use these preferences on PromptRelay."));
    return;
  }

  try {
    const token = await getConvexAuthToken();
    const client = new ConvexHttpClient(config.convexUrl, { auth: token });
    await client.mutation(
      "volunteerSettings:upsert" as unknown as FunctionReference<"mutation">,
      {
        maxTasksPerDay: config.maxTasksPerDay,
        allowedCategories: config.allowedCategories,
        trustedProjects: config.trustedProjects,
      }
    );
    console.log(chalk.green("\nPreferences saved."));
  } catch {
    console.log(chalk.yellow("\nSaved locally. PromptRelay will retry when the connection is available."));
  }
}

async function ask(
  rl: readline.Interface,
  prompt: string,
  defaultValue?: string
) {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const answer = await rl.question(`${prompt}${suffix}: `);
  return answer.trim() || defaultValue || "";
}

async function pause(rl: readline.Interface, message = "Press Enter to continue.") {
  console.log(message);
  await rl.question("");
}

function formatList(values: string[]) {
  return values.length > 0 ? chalk.cyan(values.join(", ")) : chalk.dim("none");
}

function formatBoolean(value: boolean) {
  return value ? chalk.green("enabled") : chalk.dim("disabled");
}

function formatConnection(config: VolunteerConfig) {
  return config.githubToken && config.convexUrl
    ? chalk.green("connected")
    : chalk.red("needs login");
}

function formatProtectedExecution(allowUnsafeExecution: boolean) {
  return allowUnsafeExecution ? chalk.red("disabled") : chalk.green("enabled");
}

function formatProviders(providers: VolunteerConfig["providers"]) {
  const enabled = providers
    .filter((provider) => provider.enabled && ALL_PROVIDERS.includes(provider.provider))
    .map((provider) => provider.provider);
  return formatList(enabled);
}
