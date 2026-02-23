import type { ReactNode } from "react";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  return (
    <main className="container relative mx-auto min-h-screen space-y-4 overflow-x-hidden px-4 pt-6 pb-10 sm:px-6 lg:px-8">
      {children}
    </main>
  );
}
