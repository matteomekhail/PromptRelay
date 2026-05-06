# PromptRelay

A volunteer AI execution network for open-source maintainers.

Maintainers submit public AI tasks (code review, docs, tests, bugfixes). Volunteers manually approve and run those tasks locally using their own AI setup. Results are sent back as answers, reviews, markdown, diffs, or PR drafts.

## Stack

- **Next.js 16** (App Router, TypeScript)
- **Tailwind CSS** + **shadcn/ui** (base-ui)
- **Convex** (database, backend functions)
- **Auth.js v5** (NextAuth) with GitHub OAuth
- **Zod** for form validation

## Setup

### Prerequisites

- Node.js 18+
- npm
- A GitHub OAuth App

### 1. Install dependencies

```bash
npm install
```

### 2. Create a GitHub OAuth App

1. Go to https://github.com/settings/developers
2. Click "New OAuth App"
3. Set:
   - Application name: `PromptRelay (dev)`
   - Homepage URL: `http://localhost:3000`
   - Authorization callback URL: `http://localhost:3000/api/auth/callback/github`
4. Copy the Client ID and generate a Client Secret

### 3. Configure environment variables

Copy `.env.example` to `.env.local` and fill in:

```bash
cp .env.example .env.local
```

Required variables:
- `NEXT_PUBLIC_CONVEX_URL` — set by `npx convex init` or `npx convex dev`
- `CONVEX_DEPLOYMENT` — set by Convex CLI
- `GITHUB_CLIENT_ID` — from your GitHub OAuth App
- `GITHUB_CLIENT_SECRET` — from your GitHub OAuth App
- `AUTH_SECRET` — generate with `npx auth secret`
- `NEXTAUTH_URL` — `http://localhost:3000` for local dev
- `NEXT_PUBLIC_APP_URL` — public app URL used as the Convex auth issuer
- `CONVEX_AUTH_PRIVATE_KEY` — RSA private key used to sign Convex auth JWTs

Convex also needs the auth issuer URL in its deployment environment because
`convex/auth.config.ts` reads it:

```bash
npx convex env set NEXT_PUBLIC_APP_URL http://localhost:3000
```

For the volunteer CLI, also set:

- `PROMPTRELAY_APP_URL` — app URL that issues Convex auth tokens
- `PROMPTRELAY_CONVEX_URL` — Convex deployment URL
- `PROMPTRELAY_GITHUB_CLIENT_ID` — GitHub OAuth device-flow app client ID

### 4. Start Convex

In one terminal:

```bash
npx convex dev
```

### 5. Start Next.js

In another terminal:

```bash
npm run dev
```

### 6. Seed sample data (optional)

Open the Convex dashboard and run the `seed:seedDev` mutation, or call it from a script:

```bash
npx convex run seed:seedDev
```

This creates sample users (with fake GitHub IDs), projects, and queued tasks for local testing.

## Architecture

### Roles

- **Maintainer** — creates projects, submits AI tasks, reviews results
- **Volunteer** — browses queued tasks, runs them locally, submits results

A single account can have both roles.

### Auth flow

1. User signs in with GitHub via Auth.js
2. The app exchanges the Auth.js session for a short-lived Convex JWT through `/api/convex/token`
3. Convex validates that JWT through the app's OIDC-compatible metadata and JWKS routes
4. On first authenticated visit, the app upserts a Convex `users` record from `ctx.auth.getUserIdentity()`
5. User can add Maintainer and/or Volunteer roles at `/onboarding`

### Security model

- No provider API keys stored on the server
- No server-side AI execution
- Volunteers run tasks locally using their own setup
- The volunteer daemon only auto-executes tasks from trusted repositories
- All role and ownership checks happen via server-side Convex identity, not client-supplied user IDs
- GitHub identity is the only auth source

### Mock AI Worker

The CLI includes a deterministic mock executor (`packages/cli/src/executors/mock.ts`) that generates realistic content based on the task's output type. No external AI APIs are called when the mock executor is selected.

## Routes

| Route | Description |
|-------|-------------|
| `/` | Landing page |
| `/onboarding` | Role selection |
| `/tasks/[id]` | Task detail + results |

## Volunteer CLI Settings

Volunteer settings are managed from the CLI TUI:

```bash
promptrelay
```

Run the daemon explicitly with `promptrelay start`, or use
`promptrelay --foreground` for a foreground process.

## MVP Limitations

- Maintainer project/task creation UI is not implemented yet
- No GitHub App integration
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
