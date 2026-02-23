"use client";

import { useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";

import { api } from "@/convex/_generated/api";

export function SessionBootstrap({ children }: { children: React.ReactNode }) {
  const ensurePlayer = useMutation(api.game.ensurePlayer);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const didRun = useRef(false);

  useEffect(() => {
    if (didRun.current) {
      return;
    }

    didRun.current = true;

    void ensurePlayer({})
      .then(() => {
        setIsReady(true);
      })
      .catch((sessionError) => {
        const message =
          sessionError instanceof Error
            ? sessionError.message
            : "Failed to prepare your player session.";
        setError(message);
      });
  }, [ensurePlayer]);

  if (error) {
    return (
      <main className="grid min-h-screen place-items-center px-4 text-center">
        <div className="max-w-sm rounded-3xl border border-red-200 bg-red-50 p-6 text-red-700">
          <p className="font-semibold">Could not start your session</p>
          <p className="mt-2 text-sm">{error}</p>
        </div>
      </main>
    );
  }

  if (!isReady) {
    return (
      <main className="grid min-h-screen place-items-center px-4">
        <div className="rounded-full border border-foreground/20 bg-white/90 px-4 py-2 text-sm font-semibold text-foreground/70 shadow-sm">
          Preparing your player profile...
        </div>
      </main>
    );
  }

  return children;
}
