"use client";

import { useQuery } from "convex/react";
import { Flag, Star } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { api } from "@/convex/_generated/api";

export default function PlayScreenPage() {
  const params = useParams<{ code: string }>();
  const code = Number(params.code);
  const isCodeValid =
    Number.isInteger(code) && code >= 100000 && code <= 999999;
  const playData = useQuery(
    api.game.playScreen,
    isCodeValid ? { code } : "skip",
  );

  if (!isCodeValid) {
    return (
      <main className="grid min-h-screen place-items-center px-4">
        <Card className="w-full max-w-md border-2 border-foreground/10 bg-white/90">
          <CardHeader>
            <CardTitle>Invalid game URL</CardTitle>
            <CardDescription>
              This play route expects a 6-digit lobby code.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full rounded-full">
              <Link href="/">Go home</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (playData === undefined) {
    return (
      <main className="grid min-h-screen place-items-center px-4">
        <p className="rounded-full border border-foreground/20 bg-white/90 px-4 py-2 font-semibold text-foreground/70 text-sm">
          Opening play screen...
        </p>
      </main>
    );
  }

  if (!playData) {
    return (
      <main className="grid min-h-screen place-items-center px-4">
        <Card className="w-full max-w-md border-2 border-foreground/10 bg-white/90">
          <CardHeader>
            <CardTitle>Game not found</CardTitle>
            <CardDescription>
              You are not currently in this lobby.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full rounded-full">
              <Link href="/">Return home</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 py-5 sm:px-6">
      <section className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <nav className="rounded-3xl border-2 border-foreground/10 bg-white/85 p-4 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1">
              <p className="font-semibold text-foreground/60 text-xs uppercase tracking-[0.12em]">
                Lobby {playData.code}
              </p>
              <h1 className="font-[var(--font-display)] text-3xl leading-none">
                Play Screen
              </h1>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge className="border border-foreground/20 bg-[#b7ffcf] text-foreground">
                <Star className="size-3.5" />
                Your score: {playData.yourScore}
              </Badge>
              <Badge
                variant="outline"
                className="border-foreground/20 text-foreground/70"
              >
                State: {playData.gameState}
              </Badge>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {playData.players.map((player) => (
              <Badge
                key={player.id}
                variant="outline"
                className="rounded-full border-foreground/20 bg-white px-3 py-1 text-foreground"
              >
                {player.username}
                {player.isHost ? <Flag className="size-3.5" /> : null}
                <span className="text-foreground/60">{player.score} pts</span>
              </Badge>
            ))}
          </div>
        </nav>

        <Card className="border-2 border-foreground/20 border-dashed bg-white/75">
          <CardHeader>
            <CardTitle className="text-xl">Gameplay coming next</CardTitle>
            <CardDescription>
              This route is intentionally scaffolded only. Another agent can now
              implement round logic and interactions here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="rounded-full border-2">
              <Link href="/">Back to lobby hub</Link>
            </Button>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
