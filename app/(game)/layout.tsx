import { isAuthenticatedNextjs } from "@convex-dev/auth/nextjs/server";
import { redirect } from "next/navigation";
import { ReactNode } from "react";

import { SessionBootstrap } from "./session-bootstrap";

export default async function GameLayout({
  children,
}: {
  children: ReactNode;
}) {
  const isAuthenticated = await isAuthenticatedNextjs();

  if (!isAuthenticated) {
    redirect("/signin");
  }

  return <SessionBootstrap>{children}</SessionBootstrap>;
}
