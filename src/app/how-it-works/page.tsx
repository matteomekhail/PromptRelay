export default function HowItWorksPage() {
  return (
    <section className="mx-auto max-w-3xl px-5 py-16 sm:px-8 md:py-24">
      <h1 className="font-heading text-4xl sm:text-5xl tracking-tight">
        How it works
      </h1>

      <p className="mt-6 text-[15px] leading-7 text-muted-foreground max-w-[38rem]">
        PromptRelay coordinates AI execution between maintainers and
        volunteers. The platform never touches credentials, code, or compute.
        It only routes tasks and collects results.
      </p>

      <div className="mt-14 space-y-12 text-[15px] leading-7">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            1. Volunteer installs the CLI daemon
          </h2>
          <p className="mt-3 text-muted-foreground">
            A volunteer opens the settings TUI, authenticates via GitHub OAuth,
            and configures their local daemon. The daemon is started explicitly with{" "}
            <code className="text-foreground font-mono text-[13px]">
              promptrelay start
            </code>
            .
            The daemon polls Convex for queued tasks matching the volunteer&apos;s
            allowed categories (docs, tests, bugfix, review, refactor,
            translation). Configuration lives in{" "}
            <code className="text-foreground font-mono text-[13px]">
              ~/.config/promptrelay-volunteer
            </code>
            , including max tasks per day, trusted projects, and enabled
            providers.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-foreground">
            2. Maintainer creates a task
          </h2>
          <p className="mt-3 text-muted-foreground">
            Through the web dashboard, a maintainer links a GitHub repo,
            writes a prompt, and selects a category and output type (answer,
            review, markdown, diff, or PR draft). The task enters the queue
            with status <code className="text-foreground font-mono text-[13px]">queued</code>.
            Maintainers can optionally specify a preferred provider or model.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-foreground">
            3. Daemon claims and executes
          </h2>
          <p className="mt-3 text-muted-foreground">
            When the daemon finds an eligible task, it claims it (status moves
            to <code className="text-foreground font-mono text-[13px]">claimed</code>,
            then <code className="text-foreground font-mono text-[13px]">running</code>).
            Under the hood, the executor spawns{" "}
            <code className="text-foreground font-mono text-[13px]">
              claude -p {"<"}prompt{">"} --output-format text --dangerously-skip-permissions
            </code>{" "}
            (or the Codex equivalent:{" "}
            <code className="text-foreground font-mono text-[13px]">
              codex --quiet --approval-mode full-auto {"<"}prompt{">"}
            </code>
            ) as a child process inside the cloned repo. Claude Code gets a
            system prompt with the project name and task category, reads the
            codebase, and makes real file changes. Codex runs in full-auto
            mode with an equivalent prompt. If the task has a{" "}
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
            4. Result submitted for review
          </h2>
          <p className="mt-3 text-muted-foreground">
            On completion, the daemon writes the result back through{" "}
            <code className="text-foreground font-mono text-[13px]">
              tasks:complete
            </code>{" "}
            with the output content, provider used, model, and execution
            duration. The maintainer reviews the result and accepts or
            rejects it. For diff/PR outputs, the daemon can push a branch
            and open a pull request via the GitHub CLI automatically.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-foreground">
            5. What stays local
          </h2>
          <p className="mt-3 text-muted-foreground">
            API keys, model access, and compute are the volunteer&apos;s. The
            platform stores task metadata, prompts, and results in Convex.
            No credentials cross the network. The volunteer&apos;s daemon controls
            what it runs: category filters, daily limits, manual approval
            mode, and a trusted-projects allowlist.
          </p>
        </div>
      </div>
    </section>
  );
}
