import { createPrivateKey, createPublicKey } from "node:crypto";
import { SignJWT, importPKCS8, jwtVerify } from "jose";

export type ConvexTokenUser = {
  githubId: string;
  githubUsername: string;
  name?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
};

const TOKEN_AUDIENCE = "convex";
const TOKEN_TTL_SECONDS = 60 * 60;

export function getConvexAuthIssuer() {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3000";
  return appUrl.replace(/\/$/, "");
}

export function getConvexAuthKeyId() {
  return process.env.CONVEX_AUTH_KEY_ID ?? "promptrelay-convex-auth";
}

export function getConvexAuthJwks() {
  const configured = process.env.CONVEX_AUTH_PUBLIC_JWK;
  if (configured) {
    const key = JSON.parse(configured) as Record<string, unknown>;
    return {
      keys: [
        {
          ...key,
          kid: key.kid ?? getConvexAuthKeyId(),
          use: key.use ?? "sig",
          alg: key.alg ?? "RS256",
        },
      ],
    };
  }

  const publicKey = createPublicKey(createPrivateKey(getPrivateKey()));
  const jwk = publicKey.export({ format: "jwk" }) as Record<string, unknown>;
  return {
    keys: [
      {
        ...jwk,
        kid: getConvexAuthKeyId(),
        use: "sig",
        alg: "RS256",
      },
    ],
  };
}

export async function createConvexAuthToken(user: ConvexTokenUser) {
  const privateKey = await importPKCS8(getPrivateKey(), "RS256");
  const issuer = getConvexAuthIssuer();

  return await new SignJWT({
    githubId: user.githubId,
    preferred_username: user.githubUsername,
    nickname: user.githubUsername,
    name: user.name ?? user.githubUsername,
    email: user.email ?? undefined,
    picture: user.avatarUrl ?? undefined,
  })
    .setProtectedHeader({ alg: "RS256", kid: getConvexAuthKeyId() })
    .setIssuer(issuer)
    .setSubject(`github:${user.githubId}`)
    .setAudience(TOKEN_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(privateKey);
}

export async function verifyConvexAuthToken(token: string) {
  const publicKey = createPublicKey(createPrivateKey(getPrivateKey()));
  return await jwtVerify(token, publicKey, {
    issuer: getConvexAuthIssuer(),
    audience: TOKEN_AUDIENCE,
  });
}

function getPrivateKey() {
  const configured = process.env.CONVEX_AUTH_PRIVATE_KEY;
  if (!configured) {
    throw new Error("CONVEX_AUTH_PRIVATE_KEY is not configured");
  }

  if (configured.includes("BEGIN")) {
    return configured.replace(/\\n/g, "\n");
  }

  return Buffer.from(configured, "base64").toString("utf8");
}
