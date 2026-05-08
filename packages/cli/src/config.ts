import Conf from "conf";
import type { ProviderConfig } from "./executors/types.js";

const PRODUCTION_APP_URL = "https://promptrelay.dev";
const PRODUCTION_CONVEX_URL = "https://successful-ox-560.convex.cloud";

export interface VolunteerConfig {
  githubToken?: string;
  githubId?: string;
  githubUsername?: string;
  convexUrl: string;
  appUrl: string;
  maxTasksPerDay: number;
  allowedCategories: string[];
  providers: ProviderConfig[];
  autoApprove: boolean;
  trustedProjects: string[];
  githubPat?: string;
  allowUnsafeExecution: boolean;
  idleCheckIntervalMs: number;
}

const defaults: VolunteerConfig = {
  convexUrl: process.env.PROMPTRELAY_CONVEX_URL ?? PRODUCTION_CONVEX_URL,
  appUrl: process.env.PROMPTRELAY_APP_URL ?? PRODUCTION_APP_URL,
  maxTasksPerDay: 10,
  allowedCategories: ["docs", "tests", "bugfix", "review", "refactor", "translation"],
  providers: [
    { provider: "claude-code", enabled: true },
    { provider: "codex", enabled: true },
    { provider: "mock", enabled: true },
  ],
  autoApprove: false,
  trustedProjects: [],
  allowUnsafeExecution: process.env.PROMPTRELAY_ALLOW_UNSAFE_EXECUTION === "1",
  idleCheckIntervalMs: 5000,
};

const config = new Conf<VolunteerConfig>({
  projectName: "promptrelay-volunteer",
  defaults,
});

export function getConfig(): VolunteerConfig {
  return config.store;
}

export function setConfig(key: keyof VolunteerConfig, value: unknown): void {
  config.set(key, value);
}

export function setAuth(token: string, githubId: string, username: string): void {
  config.set("githubToken", token);
  config.set("githubId", githubId);
  config.set("githubUsername", username);
}

export function clearAuth(): void {
  config.delete("githubToken");
  config.delete("githubId");
  config.delete("githubUsername");
}

export function isAuthenticated(): boolean {
  return !!config.get("githubToken") && !!config.get("githubId");
}

export function getEnabledProviders(): string[] {
  const providers = config.get("providers") ?? [];
  return providers.filter((p) => p.enabled).map((p) => p.provider);
}

export function setConvexUrl(url: string): void {
  config.set("convexUrl", url);
}

export function setAppUrl(url: string): void {
  config.set("appUrl", url);
}

export function getConfigPath(): string {
  return config.path;
}

export function isUnsafeExecutionAllowed(): boolean {
  return (
    config.get("allowUnsafeExecution") ||
    process.env.PROMPTRELAY_ALLOW_UNSAFE_EXECUTION === "1"
  );
}
