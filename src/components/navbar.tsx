"use client";

import Image from "next/image";
import Link from "next/link";
import { useSession, signIn, signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function Navbar() {
  const { data: session } = useSession();

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur-xl">
      <nav className="mx-auto flex h-15 max-w-7xl items-center justify-between px-5 sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-2 text-sm font-semibold"
        >
          <Image
            src="/brand/promptrelay-mark.png"
            alt=""
            aria-hidden="true"
            width={28}
            height={28}
            className="size-7 object-contain"
          />
          <span className="font-heading">PromptRelay</span>
        </Link>

        <div className="flex items-center gap-4">
          <div className="hidden items-center gap-5 text-xs font-medium text-muted-foreground sm:flex">
            <Link href="/how-it-works" className="hover:text-foreground">
              How it works
            </Link>
          </div>
          {session?.user ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button className="relative h-7 w-7 rounded-full ring-1 ring-border overflow-hidden focus:outline-none focus:ring-2 focus:ring-ring">
                    <Avatar className="h-7 w-7">
                      <AvatarImage
                        src={session.user.avatarUrl ?? session.user.image ?? ""}
                        alt={session.user.name ?? ""}
                      />
                      <AvatarFallback className="text-xs">
                        {(session.user.name ?? "U")[0].toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  </button>
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => signOut()}>
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button
              onClick={() => signIn("github")}
              variant="ghost"
              size="sm"
              className="text-xs font-medium"
            >
              Sign in
            </Button>
          )}
        </div>
      </nav>
    </header>
  );
}
