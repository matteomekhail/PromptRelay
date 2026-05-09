"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

const command = "npm install -g promptrelay";

export default function HomePage() {
  const [copied, setCopied] = useState(false);

  async function copyCommand() {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <section className="relative min-h-[calc(100vh-3.75rem)] flex flex-col overflow-hidden">
      <div className="relay-hero-grid" aria-hidden="true" />

      <div className="relative z-10 mx-auto w-full max-w-7xl px-5 sm:px-8 flex flex-col flex-1">
        <div className="flex flex-1 flex-col items-center justify-center text-center py-16">
          <h1
            className="hero-animate"
            style={{ "--stagger": 0 } as React.CSSProperties}
          >
            <span className="block font-heading text-5xl leading-[0.92] sm:text-7xl md:text-8xl lg:text-9xl">
              PromptRelay
            </span>
            <span className="mt-3 block font-heading text-3xl leading-[0.96] text-muted-foreground sm:text-5xl md:text-6xl lg:text-7xl">
              AI tasks, run by volunteers.
            </span>
          </h1>

          <div
            className="hero-animate mt-10 max-w-[42rem] md:mt-14"
            style={{ "--stagger": 2 } as React.CSSProperties}
          >
            <p className="text-lg font-medium leading-relaxed text-foreground/90 sm:text-xl">
              Maintainers invoke tasks from GitHub. Volunteers approve them in
              the terminal and run Claude Code or Codex locally.
            </p>

            <button
              onClick={copyCommand}
              className="group mt-8 inline-flex min-h-12 items-center gap-3 rounded-md border border-border bg-secondary/70 px-4 py-3 font-mono text-sm text-foreground shadow-[0_0_0_1px_oklch(0.891902_0.024069_59.362_/_0.04)] transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-base"
              aria-label="Copy npm install command"
            >
              <code>{command}</code>
              {copied ? (
                <Check className="size-3.5 shrink-0 text-foreground" />
              ) : (
                <Copy className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
              )}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
