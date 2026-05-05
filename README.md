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

### Auth flow

1. User signs in with GitHub via Auth.js
2. On first authenticated visit, the app upserts a Convex `users` record using the GitHub identity
3. User selects a role (Maintainer or Volunteer) at `/onboarding`
4. Role-based routing to dashboards

### Security model

- No provider API keys stored on the server
- No server-side AI execution
- Volunteers run tasks locally using their own setup
- Manual approval required for all tasks (locked in MVP)
- All role checks happen via server-side Convex queries/mutations
- GitHub identity is the only auth source

### Mock AI Worker

The MVP uses a deterministic mock worker (`src/lib/mock-worker.ts`) that generates realistic content based on the task's output type. No external AI APIs are called.

## Routes

| Route | Description |
|-------|-------------|
| `/` | Landing page |
| `/onboarding` | Role selection |
| `/maintainer` | Maintainer dashboard |
| `/maintainer/projects/new` | Create project |
| `/maintainer/tasks/new` | Create task |
| `/tasks/[id]` | Task detail + results |
| `/volunteer` | Volunteer dashboard + task queue |
| `/volunteer/settings` | Volunteer preferences |

## MVP Limitations

- No real AI provider execution (mock only)
- Single role per account
- No GitHub PR creation (future)
- No GitHub App integration
- No shell command execution
- No automatic task execution
- Manual volunteer approval only
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
