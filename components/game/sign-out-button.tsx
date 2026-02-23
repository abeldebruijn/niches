"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

export function SignOutButton() {
  const { signOut } = useAuthActions();
  const router = useRouter();

  return (
    <Button
      variant="outline"
      size="sm"
      className="rounded-full border-2 border-foreground/20 bg-white/80 px-4"
      onClick={() => {
        void signOut().then(() => {
          router.push("/signin");
        });
      }}
    >
      Sign out
    </Button>
  );
}
