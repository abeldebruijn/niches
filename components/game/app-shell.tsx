import Link from "next/link";
import { ReactNode } from "react";

import { SignOutButton } from "@/components/game/sign-out-button";
import { Badge } from "@/components/ui/badge";

type AppShellProps = {
  children: ReactNode;
  title: string;
  subtitle: string;
  username?: string | null;
  backHref?: string;
  backLabel?: string;
  accent?: string;
};

export function AppShell({
  children,
  title,
  subtitle,
  username,
  backHref,
  backLabel,
  accent = "bg-[#fff2a8]",
}: AppShellProps) {
  return (
    <main className="relative min-h-screen overflow-x-hidden px-4 pb-10 pt-6 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-24 left-[-5rem] h-72 w-72 rounded-full bg-[#ff9b9b]/35 blur-3xl" />
        <div className="absolute right-[-6rem] top-28 h-80 w-80 rounded-full bg-[#64d7ff]/30 blur-3xl" />
        <div className="absolute bottom-[-8rem] left-1/3 h-96 w-96 rounded-full bg-[#ffe16b]/25 blur-3xl" />
      </div>

      <section className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <header className="rounded-3xl border-2 border-foreground/10 bg-white/80 p-4 shadow-[0_14px_40px_rgba(0,0,0,0.08)] backdrop-blur-sm sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="secondary"
                  className={`${accent} border-foreground/15 text-foreground`}
                >
                  Question Crafter
                </Badge>
                {username ? (
                  <Badge className="border border-foreground/20 bg-white text-foreground">
                    {username}
                  </Badge>
                ) : null}
              </div>
              <h1 className="font-[var(--font-display)] text-3xl leading-none text-foreground sm:text-4xl">
                {title}
              </h1>
              <p className="max-w-xl text-sm text-foreground/70 sm:text-base">
                {subtitle}
              </p>
            </div>
            <div className="flex items-center gap-2 self-start sm:self-auto">
              {backHref ? (
                <Link
                  href={backHref}
                  className="inline-flex h-9 items-center rounded-full border border-foreground/20 bg-white px-4 text-sm font-semibold text-foreground/80 transition-colors hover:bg-foreground/5"
                >
                  {backLabel ?? "Back"}
                </Link>
              ) : null}
              <SignOutButton />
            </div>
          </div>
        </header>

        {children}
      </section>
    </main>
  );
}
