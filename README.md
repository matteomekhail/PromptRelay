# PromptRelay

A GitHub-native volunteer AI execution network for open-source maintainers.

Maintainers submit public AI tasks from GitHub issues and pull requests with `/promptrelay` commands. Volunteers approve and run those tasks locally, those task will be runned on their codex / claude code instances.
An user can be both maintainer and volunteer
Results are sent back as GitHub comments, or PRs.

## Volunteer CLI Settings

Volunteer settings are managed from the CLI TUI:

```bash
promptrelay
```

Run the daemon explicitly with `promptrelay start`, or use
`promptrelay --foreground` for a foreground process.