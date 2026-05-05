import Conf from "conf";
import type { ProviderConfig } from "./executors/types.js";

interface VolunteerConfig {
  githubToken?: string;
  githubId?: string;
  githubUsername?: string;
  convexUrl: string;
  maxTasksPerDay: number;
  allowedCategories: string[];
  providers: ProviderConfig[];
  autoApprove: boolean;
  trustedProjects: string[];
  idleCheckIntervalMs: number;
}

const defaults: VolunteerConfig = {
  convexUrl: "",
  maxTasksPerDay: 10,
  allowedCategories: ["docs", "tests", "bugfix", "review", "refactor", "translation"],
  providers: [
    { provider: "claude-code", enabled: true },
    { provider: "codex", enabled: true },
    { provider: "mock", enabled: true },
  ],
  autoApprove: false,
  trustedProjects: [],
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

export function getConfigPath(): string {
  return config.path;
}
