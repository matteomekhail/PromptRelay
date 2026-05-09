import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";

export function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur-xl">
      <nav className="mx-auto flex h-15 max-w-7xl items-center justify-between px-5 sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-2 text-sm font-semibold"
        >
          <BrandMark className="size-7" decorative />
          <span className="font-heading">PromptRelay</span>
        </Link>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-5 text-xs font-medium text-muted-foreground">
            <Link href="/how-it-works" className="hover:text-foreground">
              How it works
            </Link>
          </div>
        </div>
      </nav>
    </header>
  );
}
