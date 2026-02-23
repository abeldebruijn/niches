"use client";

import { useMutation, useQuery } from "convex/react";
import { Crown, Flag, Loader2, LogOut, Trophy } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

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

export default function EndScreenPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const code = Number(params.code);
  const isCodeValid =
    Number.isInteger(code) && code >= 100000 && code <= 999999;
  const endData = useQuery(api.game.endScreen, isCodeValid ? { code } : "skip");
  const leaveServer = useMutation(api.game.leaveServer);
  const [isLeaving, setIsLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!endData) {
      return;
    }

    if (endData.gameState === "PLAY") {
      router.replace(`/${endData.code}/play`);
      return;
    }

    if (endData.gameState === "CREATE_QUESTIONS") {
      router.replace(endData.isHost ? "/create" : "/join");
    }
  }, [endData, router]);

  if (!isCodeValid) {
    return (
      <main className="grid min-h-screen place-items-center px-4">
        <Card className="w-full max-w-md border-2 border-foreground/10 bg-white/90">
          <CardHeader>
            <CardTitle>Invalid game URL</CardTitle>
            <CardDescription>
              This end screen route expects a 6-digit lobby code.
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

  if (endData === undefined) {
    return (
      <main className="grid min-h-screen place-items-center px-4">
        <p className="rounded-full border border-foreground/20 bg-white/90 px-4 py-2 font-semibold text-foreground/70 text-sm">
          Loading end screen...
        </p>
      </main>
    );
  }

  if (!endData) {
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

  const handleLeaveServer = async () => {
    setIsLeaving(true);
    setLeaveError(null);

    try {
      await leaveServer({});
      router.replace("/");
    } catch (error) {
      setLeaveError(
        error instanceof Error ? error.message : "Could not leave this server.",
      );
    } finally {
      setIsLeaving(false);
    }
  };

  return (
    <main className="min-h-screen px-4 py-5 sm:px-6">
      <section className="mx-auto flex w-full max-w-4xl flex-col gap-4">
        <Card className="border-2 border-foreground/10 bg-white/85">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <Trophy className="size-6" />
              Final Results
            </CardTitle>
            <CardDescription>Lobby {endData.code}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {endData.winners.map((winner) => (
                <Badge
                  key={winner.id}
                  className="border border-foreground/20 bg-[#ffe29b] text-foreground"
                >
                  <Crown className="size-3.5" />
                  {winner.username}
                  <span>{winner.score} pts</span>
                </Badge>
              ))}
            </div>

            <p className="text-foreground/70 text-sm">
              {endData.winners.length > 1
                ? "Co-winners detected with a tied top score."
                : "Winner determined by top final score."}
            </p>
          </CardContent>
        </Card>

        <Card className="border-2 border-foreground/10 bg-white/85">
          <CardHeader>
            <CardTitle className="text-xl">Leaderboard</CardTitle>
            <CardDescription>
              Your final score: {endData.yourScore} points
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {endData.standings.map((player) => (
              <div
                key={player.id}
                className="flex items-center justify-between rounded-xl border border-foreground/15 bg-white/90 px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">#{player.rank}</span>
                  <span className="font-semibold">{player.username}</span>
                  {player.isHost ? <Flag className="size-3.5" /> : null}
                  {player.isYou ? (
                    <Badge className="border border-foreground/20 bg-[#b7ffcf] text-foreground">
                      You
                    </Badge>
                  ) : null}
                </div>
                <span className="font-semibold text-sm">
                  {player.score} pts
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            className="rounded-full"
            disabled={isLeaving}
            onClick={() => {
              void handleLeaveServer();
            }}
          >
            {isLeaving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Leaving
              </>
            ) : (
              <>
                <LogOut className="size-4" />
                Leave server
              </>
            )}
          </Button>

          <Button asChild variant="outline" className="rounded-full border-2">
            <Link href="/">Back to home</Link>
          </Button>
        </div>

        {leaveError ? (
          <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-red-700 text-sm">
            {leaveError}
          </p>
        ) : null}
      </section>
    </main>
  );
}
