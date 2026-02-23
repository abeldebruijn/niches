import type { ReactNode } from "react";

type AppShellProps = {
	children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
	return (
		<main className="container mx-auto space-y-4 relative min-h-screen overflow-x-hidden px-4 pb-10 pt-6 sm:px-6 lg:px-8">
			{children}
		</main>
	);
}
