import { cn } from "@/lib/utils";

export function BrandMark({
  className,
  decorative = false,
}: {
  className?: string;
  decorative?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 48 48"
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : "PromptRelay"}
      aria-hidden={decorative ? true : undefined}
      className={cn("size-8", className)}
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M8 12h9.25L30 24 17.25 36H8l12.25-12L8 12Zm8.15 5.65h2.55L25.38 24 18.7 30.35h-2.55L22.85 24l-6.7-6.35Z"
      />
      <rect x="33.5" y="12" width="6.5" height="24" rx="1.25" fill="currentColor" />
    </svg>
  );
}
