import open from "open";
import { setAuth, clearAuth } from "./config.js";

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface TokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
}

interface GitHubUser {
  id: number;
  login: string;
  name?: string;
  email?: string;
  avatar_url?: string;
}

const GITHUB_CLIENT_ID = "Ov23liEBcWb2Vush70Tr";

function getClientId(): string {
  return process.env.PROMPT_COMMONS_GITHUB_CLIENT_ID ?? GITHUB_CLIENT_ID;
}

export async function loginWithDeviceFlow(): Promise<{
  token: string;
  githubId: string;
  username: string;
}> {
  const clientId = getClientId();

  // Step 1: Request device code
  const codeRes = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      scope: "read:user user:email",
    }),
  });

  const codeData: DeviceCodeResponse = await codeRes.json();

  console.log("\n  Open this URL in your browser:\n");
  console.log(`    ${codeData.verification_uri}\n`);
  console.log(`  Enter code: ${codeData.user_code}\n`);

  // Try to open browser automatically
  try {
    await open(codeData.verification_uri);
  } catch {
    // Silent fail - user can open manually
  }

  // Step 2: Poll for token
  const token = await pollForToken(clientId, codeData);

  // Step 3: Get user info
  const userRes = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const user: GitHubUser = await userRes.json();

  setAuth(token, String(user.id), user.login);

  return {
    token,
    githubId: String(user.id),
    username: user.login,
  };
}

async function pollForToken(
  clientId: string,
  codeData: DeviceCodeResponse
): Promise<string> {
  const interval = (codeData.interval ?? 5) * 1000;
  const deadline = Date.now() + codeData.expires_in * 1000;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));

    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        device_code: codeData.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    const data: TokenResponse = await res.json();

    if (data.access_token) {
      return data.access_token;
    }

    if (data.error === "expired_token") {
      throw new Error("Authentication timed out. Run `prompt-commons auth` again.");
    }

    // authorization_pending or slow_down - keep polling
  }

  throw new Error("Authentication timed out.");
}

export function logout(): void {
  clearAuth();
}
