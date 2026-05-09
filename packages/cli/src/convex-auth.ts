import { getConfig } from "./config.js";

type ConvexTokenResponse = {
  token?: string;
  error?: string;
};

export async function getConvexAuthToken(): Promise<string> {
  const config = getConfig();
  if (!config.githubToken) {
    throw new Error("GitHub authentication is required.");
  }
  if (!config.appUrl) {
    throw new Error("PromptRelay app URL is not configured.");
  }

  const res = await fetch(`${config.appUrl.replace(/\/$/, "")}/api/convex/token`, {
    headers: {
      Authorization: `Bearer ${config.githubToken}`,
      Accept: "application/json",
    },
  });

  const data = (await res.json().catch(() => ({}))) as ConvexTokenResponse;
  if (!res.ok || !data.token) {
    throw new Error(data.error ?? "Could not fetch Convex auth token.");
  }

  return data.token;
}
