import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      role="img"
      aria-label="PromptRelay"
      className={cn("size-8", className)}
      fill="none"
    >
      <rect
        x="8"
        y="13"
        width="32"
        height="22"
        rx="4"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        d="M10 15.5 24 26l14-10.5"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 18h8M4 30h8M36 18h8M36 30h8"
        stroke="oklch(0.814138 0.039715 188.343)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M16 35 24 26l8 9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
