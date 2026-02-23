"use client";

import { useMutation, useQuery } from "convex/react";
import { Crown, Loader2, LogIn } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";

import { AppShell } from "@/components/game/app-shell";
import { LobbyRoster } from "@/components/game/lobby-roster";
import { QuestionBuilder } from "@/components/game/question-builder";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/convex/_generated/api";

export default function JoinPage() {
  const router = useRouter();
  const joinLobby = useMutation(api.game.joinLobby);
  const lobby = useQuery(api.game.currentLobby);

  const [codeInput, setCodeInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);

  useEffect(() => {
    if (!lobby) {
      return;
    }

    if (lobby.gameState === "PLAY") {
      router.replace(`/${lobby.code}/play`);
      return;
    }

    if (lobby.gameState === "END_SCREEN") {
      router.replace(`/${lobby.code}/end-screen`);
    }
  }, [lobby, router]);

  const handleJoin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const numericCode = Number(codeInput.replace(/\D/g, ""));

    if (
      !Number.isInteger(numericCode) ||
      numericCode < 100000 ||
      numericCode > 999999
    ) {
      setError("Enter a valid 6-digit lobby code.");
      return;
    }

    setIsJoining(true);
    setError(null);

    try {
      await joinLobby({ code: numericCode });
    } catch (joinError) {
      const message =
        joinError instanceof Error
          ? joinError.message
          : "Could not join lobby.";
      setError(message);
    } finally {
      setIsJoining(false);
    }
  };

  if (lobby === undefined) {
    return (
      <main className="grid min-h-screen place-items-center px-4">
        <p className="rounded-full border border-foreground/20 bg-white/90 px-4 py-2 font-semibold text-foreground/70 text-sm">
          Loading lobby data...
        </p>
      </main>
    );
  }

  if (!lobby) {
    return (
      <AppShell>
        <Card className="border-2 border-foreground/10 bg-white/85">
          <CardHeader>
            <CardTitle className="text-xl">Lobby code</CardTitle>
            <CardDescription>
              Ask the host for the 6-digit code shown on their create screen.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(event) => void handleJoin(event)}
            >
              <div className="space-y-1.5">
                <Label htmlFor="join-code">Code</Label>
                <Input
                  id="join-code"
                  inputMode="numeric"
                  placeholder="123456"
                  maxLength={6}
                  value={codeInput}
                  onChange={(event) => {
                    const digitsOnly = event.target.value
                      .replace(/\D/g, "")
                      .slice(0, 6);
                    setCodeInput(digitsOnly);
                  }}
                />
              </div>

              <Button
                type="submit"
                className="w-full rounded-full"
                disabled={isJoining}
              >
                {isJoining ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Joining
                  </>
                ) : (
                  <>
                    <LogIn className="size-4" />
                    Join lobby
                  </>
                )}
              </Button>

              {error ? (
                <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-red-700 text-sm">
                  {error}
                </p>
              ) : null}
            </form>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const host = lobby.players.find((player) => player.isHost);

  return (
    <AppShell>
      <Card className="border-2 border-foreground/10 bg-white/85">
        <CardHeader>
          <CardTitle className="text-xl">Connected lobby</CardTitle>
          <CardDescription>
            Code {lobby.code}. Waiting in question setup phase.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          {host ? (
            <Badge className="border border-foreground/20 bg-[#ffd18a] text-foreground">
              <Crown className="size-3.5" />
              Host: {host.username}
            </Badge>
          ) : null}
          <Badge
            variant="outline"
            className="border-foreground/20 text-foreground/70"
          >
            Timer: {lobby.timePerQuestion}s
          </Badge>
          <Badge
            variant="outline"
            className="border-foreground/20 text-foreground/70"
          >
            Players: {lobby.players.length}
          </Badge>
          {lobby.isHost ? (
            <Button
              asChild
              variant="ghost"
              className="ml-auto rounded-full px-3"
            >
              <Link href="/create">Open host controls</Link>
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <LobbyRoster players={lobby.players} />

      <QuestionBuilder
        initialQuestions={lobby.viewerQuestions}
        disabled={lobby.gameState !== "CREATE_QUESTIONS"}
      />

      {error ? (
        <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-red-700 text-sm">
          {error}
        </p>
      ) : null}
    </AppShell>
  );
}
