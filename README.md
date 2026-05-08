# PromptRelay

A GitHub-native volunteer AI execution network for open-source maintainers.

Maintainers submit public AI tasks from GitHub issues and pull requests with `/promptrelay` commands. Volunteers approve and run those tasks locally from the PromptRelay CLI/TUI using their own AI setup. Results are sent back as GitHub comments, markdown, diffs, or PRs.

## Stack

- **Next.js 16** (API routes and minimal static docs)
- **Tailwind CSS** + **shadcn/ui** (base-ui)
- **Convex** (database, backend functions)
- **Zod** for form validation

## Setup

### Prerequisites

- Node.js 18+
- npm
- A GitHub App for repository installation and webhooks
- A GitHub OAuth App client ID for volunteer CLI device flow

### 1. Install dependencies

```bash
npm install
```

### 2. Create a GitHub App

1. Go to https://github.com/settings/apps/new
2. Set:
   - GitHub App name: `PromptRelay`
   - Homepage URL: your public app URL
   - Webhook URL: `https://your-domain.com/api/github/webhook`
   - Webhook secret: a long random string
3. Enable repository permissions:
   - Metadata: read-only
   - Issues: read/write
   - Pull requests: read/write
   - Contents: read/write
4. Subscribe to:
   - Issue comment
   - Pull request review comment
   - Pull request
5. Generate and download a private key.

### 3. Create a GitHub OAuth App for the CLI

1. Go to https://github.com/settings/developers
2. Click "New OAuth App"
3. Set:
   - Application name: `PromptRelay CLI`
   - Homepage URL: your public app URL
   - Authorization callback URL: your public app URL
4. Copy the Client ID. The CLI uses GitHub device flow and does not need a client secret.

### 4. Configure environment variables

Copy `.env.example` to `.env.local` and fill in:

```bash
cp .env.example .env.local
```

Required variables:
- `NEXT_PUBLIC_CONVEX_URL` — set by `npx convex init` or `npx convex dev`
- `CONVEX_DEPLOYMENT` — set by Convex CLI
- `NEXT_PUBLIC_APP_URL` — public app URL used as the Convex auth issuer
- `CONVEX_AUTH_PRIVATE_KEY` — RSA private key used to sign Convex auth JWTs
- `GITHUB_APP_ID` — from your GitHub App settings
- `GITHUB_APP_PRIVATE_KEY` — the downloaded GitHub App private key PEM, or a base64-encoded PEM
- `GITHUB_WEBHOOK_SECRET` — shared secret used by GitHub webhook signature verification and Convex task creation

Convex also needs the auth issuer URL in its deployment environment because
`convex/auth.config.ts` reads it:

```bash
npx convex env set NEXT_PUBLIC_APP_URL http://localhost:3000
npx convex env set GITHUB_WEBHOOK_SECRET your-webhook-secret
```

For the volunteer CLI, also set:

- `PROMPTRELAY_APP_URL` — app URL that issues Convex auth tokens
- `PROMPTRELAY_CONVEX_URL` — Convex deployment URL
- `PROMPTRELAY_GITHUB_CLIENT_ID` — GitHub OAuth device-flow app client ID

### 5. Start Convex

In one terminal:

```bash
npx convex dev
```

### 6. Start Next.js

In another terminal:

```bash
npm run dev
```

### 7. Seed sample data (optional)

Open the Convex dashboard and run the `seed:seedDev` mutation, or call it from a script:

```bash
npx convex run seed:seedDev
```

This creates sample users (with fake GitHub IDs), projects, and queued tasks for local testing.

## Architecture

### Roles

- **Maintainer** — creates tasks from GitHub issues/PRs with `/promptrelay`
- **Volunteer** — reviews queued tasks in the CLI/TUI, runs them locally, submits results

A single account can have both roles.

### Auth flow

1. The volunteer CLI signs in with GitHub device flow
2. The CLI exchanges the GitHub access token for a short-lived Convex JWT through `/api/convex/token`
3. Convex validates that JWT through the app's OIDC-compatible metadata and JWKS routes
4. On first CLI startup, the CLI upserts a Convex `users` record and grants the Volunteer role
5. Maintainer identities are created from verified GitHub webhook payloads when they invoke `/promptrelay`

### Security model

- No provider API keys stored on the server
- No server-side AI execution
- Volunteers run tasks locally using their own setup
- The volunteer daemon only executes tasks from trusted repositories, and requires manual approval unless auto-approve is enabled
- All role and ownership checks happen via server-side Convex identity, not client-supplied user IDs
- GitHub identity is the only auth source

### Mock AI Worker

The CLI includes a deterministic mock executor (`packages/cli/src/executors/mock.ts`) that generates realistic content based on the task's output type. No external AI APIs are called when the mock executor is selected.

## Web Surface

PromptRelay is not intended to have a maintainer dashboard. The web app exists
for static documentation and machine endpoints:

| Route | Description |
|-------|-------------|
| `/api/github/webhook` | GitHub slash-command webhook |
| `/api/convex/token` | GitHub bearer token to Convex JWT bridge |
| `/api/convex/jwks` | JWKS for Convex auth |
| `/.well-known/openid-configuration` | OIDC metadata for Convex auth |

## Volunteer CLI Settings

Volunteer settings are managed from the CLI TUI:

```bash
promptrelay
```

Run the daemon explicitly with `promptrelay start`, or use
`promptrelay --foreground` for a foreground process.

## MVP Limitations

- No maintainer web UI by design; GitHub is the maintainer interface
- GitHub App integration uses installation tokens for webhook comments and permission checks
- CLI execution is restricted to trusted repositories by default
- Public/open-source content only

## Future Roadmap

- Desktop volunteer app with real local AI execution
- GitHub PR creation from accepted diffs
- Maintainer reputation system
- Volunteer reputation system
- Project trust lists
- Duplicate result verification
- Multi-provider support (OpenAI, Anthropic, local models)
- Task categories and difficulty ratings
- Organization-level projects
