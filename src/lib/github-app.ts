import { createPrivateKey } from "node:crypto";
import { SignJWT } from "jose";

type InstallationTokenResponse = {
  token?: string;
  expires_at?: string;
  message?: string;
};

const GITHUB_API_VERSION = "2022-11-28";

export async function createGitHubInstallationToken(
  installationId: number | string
) {
  const appJwt = await createGitHubAppJwt();
  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${appJwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
        "User-Agent": "PromptRelay",
      },
    }
  );

  const data = (await res.json().catch(() => ({}))) as InstallationTokenResponse;
  if (!res.ok || !data.token) {
    throw new Error(data.message ?? "Could not create GitHub installation token");
  }

  return data.token;
}

async function createGitHubAppJwt() {
  const appId = process.env.GITHUB_APP_ID;
  if (!appId) throw new Error("GITHUB_APP_ID is not configured");

  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({})
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(appId)
    .setIssuedAt(now - 60)
    .setExpirationTime(now + 9 * 60)
    .sign(createPrivateKey(getGitHubAppPrivateKey()));
}

function getGitHubAppPrivateKey() {
  const configured = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!configured) throw new Error("GITHUB_APP_PRIVATE_KEY is not configured");

  if (configured.startsWith("SHA256:")) {
    throw new Error(
      "GITHUB_APP_PRIVATE_KEY must be the GitHub App private key PEM, not its fingerprint"
    );
  }

  if (configured.includes("BEGIN")) {
    return configured.replace(/\\n/g, "\n");
  }

  return Buffer.from(configured, "base64").toString("utf8");
}
