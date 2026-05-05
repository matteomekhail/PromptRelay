"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { SyncUser } from "@/components/sync-user";

const command = "npx @promptrelay/volunteer";

export default function HomePage() {
  const [copied, setCopied] = useState(false);

  function copyCommand() {
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <>
      <SyncUser />
      <section className="relative min-h-[calc(100vh-3.75rem)] flex flex-col overflow-hidden">
        <div className="relay-hero-grid" aria-hidden="true" />

        <div className="relative z-10 mx-auto w-full max-w-7xl px-5 sm:px-8 flex flex-col flex-1">
          <div className="flex flex-1 flex-col items-center justify-center text-center py-16">
            <h1 className="hero-animate" style={{ "--stagger": 0 } as React.CSSProperties}>
              <span className="block font-heading text-[clamp(3.5rem,9vw,9rem)] leading-[0.9] tracking-[-0.02em]">
                AI work done.
              </span>
              <span className="block font-heading text-[clamp(3.5rem,9vw,9rem)] leading-[0.9] tracking-[-0.02em] mt-2">
                Volunteer compute.
              </span>
            </h1>

            <div
              className="hero-animate mt-12 md:mt-16 max-w-[36rem]"
              style={{ "--stagger": 2 } as React.CSSProperties}
            >
              <p className="text-lg sm:text-xl font-medium leading-snug">
                Volunteers apply with their own Claude Code or Codex.
                Maintainers get AI work done.
              </p>

              <button
                onClick={copyCommand}
                className="relay-command group mt-8"
                aria-label="Copy volunteer command"
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
    </>
  );
}
