import Link from "next/link";

export default function HowItWorksPage() {
  return (
    <section className="mx-auto max-w-3xl px-5 py-16 sm:px-8 md:py-24">
      <h1 className="font-heading text-4xl sm:text-5xl tracking-tight">
        How it works
      </h1>

      <p className="mt-6 text-[15px] leading-7 text-muted-foreground max-w-152">
        PromptRelay coordinates AI execution between maintainers and
        volunteers. GitHub is the maintainer interface; the volunteer CLI/TUI is
        the execution interface. The platform never touches provider
        credentials or compute. It only routes tasks and collects results.
      </p>

      <div className="mt-14 space-y-12 text-[15px] leading-7">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            1. Maintainer installs the GitHub App
          </h2>
          <p className="mt-3 text-muted-foreground">
            PromptRelay receives maintainer requests through a GitHub App. The
            maintainer installs the app on the repositories where{" "}
            <code className="text-foreground font-mono text-[13px]">
              @promptrelay
            </code>{" "}
            should work, then selects repository access during installation.
            Without the GitHub App, GitHub will not send PromptRelay issue or
            pull request comments, and PromptRelay cannot post results or open
            PRs.
          </p>
          <p className="mt-4">
            <Link
              href="https://github.com/apps/promptrelay/installations/new"
              className="inline-flex rounded-md border border-border bg-secondary/70 px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
            >
              Install the PromptRelay GitHub App
            </Link>
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-foreground">
            2. Volunteer installs the CLI daemon
          </h2>
          <p className="mt-3 text-muted-foreground">
            A volunteer opens the settings TUI, authenticates via GitHub device
            flow, and configures their local daemon. The daemon is started
            explicitly with{" "}
            <code className="text-foreground font-mono text-[13px]">
              promptrelay start
            </code>
            .
            The daemon polls Convex for queued tasks from trusted projects.
            Configuration lives in{" "}
            <code className="text-foreground font-mono text-[13px]">
              ~/.config/promptrelay-volunteer
            </code>
            , including max tasks per day, trusted projects, manual approval,
            and enabled providers.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-foreground">
            3. Maintainer creates a task
          </h2>
          <p className="mt-3 text-muted-foreground">
            In a GitHub issue or pull request, a maintainer invokes PromptRelay
            with a free-form prompt such as{" "}
            <code className="text-foreground font-mono text-[13px]">
              @promptrelay add a regression test for the login callback
            </code>
            . The GitHub webhook verifies the request and queues the maintainer&apos;s
            message in Convex with status{" "}
            <code className="text-foreground font-mono text-[13px]">queued</code>.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-foreground">
            4. Daemon claims and executes
          </h2>
          <p className="mt-3 text-muted-foreground">
            When the daemon finds an eligible task, the volunteer approves it
            unless auto-approve is enabled. After approval, it claims the task
            (status moves to{" "}
            <code className="text-foreground font-mono text-[13px]">claimed</code>,
            then <code className="text-foreground font-mono text-[13px]">running</code>).
            Under the hood, the executor spawns{" "}
            <code className="text-foreground font-mono text-[13px]">
              claude -p {"<"}prompt{">"} --output-format text --permission-mode bypassPermissions
            </code>{" "}
            (or the Codex equivalent:{" "}
            <code className="text-foreground font-mono text-[13px]">
              codex exec --dangerously-bypass-approvals-and-sandbox {"<"}prompt{">"}
            </code>
            ) as a child process inside the cloned repo. The executor gets a
            basic system prompt explaining that the repo is already cloned, that
            it should follow the maintainer&apos;s prompt, and that PromptRelay will
            handle commit, push, and PR creation if files are changed. If the task
            has a{" "}
            <code className="text-foreground font-mono text-[13px]">publicRepoUrl</code>,
            the daemon clones or pulls the repo into{" "}
            <code className="text-foreground font-mono text-[13px]">
              ~/.promptrelay/repos/
            </code>{" "}
            and creates a working branch{" "}
            <code className="text-foreground font-mono text-[13px]">
              promptrelay/{"<"}task-id{">"}
            </code>{" "}
            before execution. Streaming output from Claude Code is pushed back
            to the maintainer in real time every 500ms via{" "}
            <code className="text-foreground font-mono text-[13px]">
              tasks:updateStream
            </code>.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-foreground">
            5. Result posted back to GitHub
          </h2>
          <p className="mt-3 text-muted-foreground">
            On completion, the daemon writes the result back through{" "}
            <code className="text-foreground font-mono text-[13px]">
              tasks:complete
            </code>{" "}
            with the output content, provider used, model, and execution
            duration. If execution only produces text, PromptRelay posts that
            result back to the GitHub thread. If files changed, the daemon
            commits the diff, pushes the working branch, and opens a pull
            request via the GitHub CLI automatically.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-foreground">
            6. What stays local
          </h2>
          <p className="mt-3 text-muted-foreground">
            API keys, model access, and compute are the volunteer&apos;s. The
            platform stores task metadata, prompts, and results in Convex.
            No credentials cross the network. The volunteer&apos;s daemon controls
            what it runs: daily limits, manual approval mode, enabled providers,
            and a trusted-projects allowlist.
          </p>
        </div>
      </div>
    </section>
  );
}
