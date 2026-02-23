"use client";

import { useQuery } from "convex/react";
import { ArrowRight, PlayCircle, PlusCircle, Users } from "lucide-react";
import Link from "next/link";

import { AppShell } from "@/components/game/app-shell";
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

export default function HomePage() {
  const viewerHome = useQuery(api.game.viewerHome);

  if (viewerHome === undefined) {
    return (
      <main className="grid min-h-screen place-items-center px-4">
        <p className="rounded-full border border-foreground/20 bg-white/90 px-4 py-2 text-sm font-semibold text-foreground/70">
          Loading lobby options...
        </p>
      </main>
    );
  }

  const activeServer = viewerHome?.activeServer;
  const continueHref =
    activeServer?.gameState === "PLAY"
      ? `/${activeServer.code}/play`
      : activeServer?.isHost
        ? "/create"
        : "/join";

  return (
    <AppShell
      title="Build Your Trivia Lobby"
      subtitle="Create a room or join one with a 6-digit code. Everyone writes 3 questions before play begins."
      username={viewerHome?.username ?? null}
      accent="bg-[#ffd18a]"
    >
      {activeServer ? (
        <Card className="border-2 border-foreground/10 bg-white/85">
          <CardHeader className="space-y-1">
            <CardTitle className="text-xl">Current lobby detected</CardTitle>
            <CardDescription>
              You are already in lobby code {activeServer.code}.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <Badge className="border border-foreground/20 bg-white text-foreground">
              State: {activeServer.gameState}
            </Badge>
            <Button asChild className="rounded-full">
              <Link href={continueHref ?? "/join"}>
                Continue
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2">
        <Card className="border-2 border-foreground/10 bg-white/85">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <PlusCircle className="size-5" />
              Create lobby
            </CardTitle>
            <CardDescription>
              Become the host, share a 6-digit code and configure question timer.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full rounded-full">
              <Link href="/create">Create now</Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="border-2 border-foreground/10 bg-white/85">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Users className="size-5" />
              Join lobby
            </CardTitle>
            <CardDescription>
              Enter a 6-digit code from a host and submit your own 3 questions.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="w-full rounded-full border-2">
              <Link href="/join">Join with code</Link>
            </Button>
          </CardContent>
        </Card>
      </section>

      <Card className="border-2 border-foreground/10 bg-white/80">
        <CardContent className="pt-6">
          <p className="text-sm text-foreground/75">
            Flow reminder: every player must submit one easy, one medium and one
            hard question. Once all players are ready and there are at least two
            players, the host can start the match.
          </p>
          <Button asChild variant="ghost" className="mt-3 rounded-full px-3 text-sm">
            <Link href="/join">
              <PlayCircle className="size-4" />
              I already have a code
            </Link>
          </Button>
        </CardContent>
      </Card>
    </AppShell>
  );
}
