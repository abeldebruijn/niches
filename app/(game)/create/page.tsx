"use client";

import { useMutation, useQuery } from "convex/react";
import { Loader2, Rocket, Timer } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

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
import type { Id } from "@/convex/_generated/dataModel";

export default function CreatePage() {
  const router = useRouter();
  const createLobby = useMutation(api.game.createLobby);
  const kickPlayer = useMutation(api.game.kickPlayer);
  const updateTimePerQuestion = useMutation(api.game.updateTimePerQuestion);
  const startGame = useMutation(api.game.startGame);
  const lobby = useQuery(api.game.currentLobby);

  const creationTriggered = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isSavingTime, setIsSavingTime] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [kickingPlayerId, setKickingPlayerId] = useState<Id<"players"> | null>(
    null,
  );
  const [timeInput, setTimeInput] = useState("60");

  const requestLobbyCreation = useCallback(() => {
    setIsCreating(true);
    setError(null);

    void createLobby({})
      .catch((creationError) => {
        const message =
          creationError instanceof Error
            ? creationError.message
            : "Could not create a lobby.";
        setError(message);
      })
      .finally(() => {
        setIsCreating(false);
      });
  }, [createLobby]);

  useEffect(() => {
    if (creationTriggered.current) {
      return;
    }

    creationTriggered.current = true;
    requestLobbyCreation();
  }, [requestLobbyCreation]);

  useEffect(() => {
    if (!lobby) {
      return;
    }

    setTimeInput(String(lobby.timePerQuestion));

    if (lobby.gameState === "PLAY") {
      router.replace(`/${lobby.code}/play`);
      return;
    }

    if (lobby.gameState === "END_SCREEN") {
      router.replace(`/${lobby.code}/end-screen`);
    }
  }, [lobby, router]);

  const handleSaveTimer = async () => {
    if (!lobby) {
      return;
    }

    const parsed = Number(timeInput);

    if (!Number.isFinite(parsed)) {
      setError("Timer must be a number.");
      return;
    }

    setIsSavingTime(true);
    setError(null);

    try {
      const result = await updateTimePerQuestion({ seconds: parsed });
      setTimeInput(String(result.seconds));
    } catch (timerError) {
      const message =
        timerError instanceof Error
          ? timerError.message
          : "Could not update timer.";
      setError(message);
    } finally {
      setIsSavingTime(false);
    }
  };

  const handleStartGame = async () => {
    if (!lobby) {
      return;
    }

    setIsStarting(true);
    setError(null);

    try {
      const result = await startGame({});
      router.replace(`/${result.code}/play`);
    } catch (startError) {
      const message =
        startError instanceof Error
          ? startError.message
          : "Could not start game.";
      setError(message);
    } finally {
      setIsStarting(false);
    }
  };

  const handleKickPlayer = useCallback(
    async (playerId: Id<"players">) => {
      setKickingPlayerId(playerId);
      setError(null);

      try {
        await kickPlayer({ targetPlayerId: playerId });
      } catch (kickError) {
        const message =
          kickError instanceof Error
            ? kickError.message
            : "Could not remove player.";
        setError(message);
      } finally {
        setKickingPlayerId((current) =>
          current === playerId ? null : current,
        );
      }
    },
    [kickPlayer],
  );

  if (lobby === undefined || isCreating) {
    return (
      <main className="grid min-h-screen place-items-center px-4">
        <p className="rounded-full border border-foreground/20 bg-white/90 px-4 py-2 font-semibold text-foreground/70 text-sm">
          Creating your lobby...
        </p>
      </main>
    );
  }

  if (!lobby) {
    return (
      <main className="grid min-h-screen place-items-center px-4">
        <Card className="w-full max-w-md border-2 border-foreground/10 bg-white/90">
          <CardHeader>
            <CardTitle>Lobby unavailable</CardTitle>
            <CardDescription>
              We could not load your lobby. Try creating it again.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              className="w-full rounded-full"
              onClick={() => {
                requestLobbyCreation();
              }}
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <div className="container mx-auto space-y-4 px-4 py-6">
      <Card className="sticky top-6 z-10 border-2 border-foreground/10 bg-white/85 backdrop-blur">
        <CardContent className="flex flex-col items-start justify-between gap-4 sm:flex-row">
          <div className="flex flex-wrap items-center gap-3">
            <CardTitle className="text-xl">Lobby code:</CardTitle>
            <div className="rounded-2xl border-2 border-foreground/20 bg-white px-4 py-2 font-black font-mono text-3xl text-foreground tracking-[0.2em]">
              {lobby.code}
            </div>
            <Badge className="border border-foreground/20 bg-[#b7ffcf] text-foreground">
              Host view
            </Badge>
            <Badge
              variant="outline"
              className="border-foreground/20 text-foreground/70"
            >
              {lobby.players.length} players
            </Badge>
            <CardDescription className="hidden sm:block">
              Invite players with this 6-digit code.
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              className="w-full rounded-full"
              disabled={!lobby.canStart || isStarting}
              onClick={() => {
                void handleStartGame();
              }}
            >
              {isStarting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Starting
                </>
              ) : (
                <>
                  <Rocket className="size-4" />
                  Start game
                </>
              )}
            </Button>

            {!lobby.canStart ? (
              <p className="text-foreground/70 text-sm">
                Start unlocks when there are at least 2 players with easy,
                medium and hard questions saved.
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <section className="grid gap-4 lg:grid-cols-[1.05fr_1fr]">
        <LobbyRoster
          players={lobby.players}
          canKickPlayers={lobby.isHost}
          kickingPlayerId={kickingPlayerId}
          onKickPlayer={(playerId) => {
            void handleKickPlayer(playerId);
          }}
        />

        <Card className="border-2 border-foreground/10 bg-white/85">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Timer className="size-5" />
              Time per question
            </CardTitle>
            <CardDescription>
              Default is 60 seconds. Allowed range: 15-300 seconds.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="timer">Seconds</Label>
              <Input
                id="timer"
                type="number"
                min={15}
                max={300}
                value={timeInput}
                onChange={(event) => {
                  setTimeInput(event.target.value);
                }}
              />
            </div>

            <Button
              type="button"
              variant="outline"
              className="w-full rounded-full border-2"
              disabled={isSavingTime}
              onClick={() => {
                void handleSaveTimer();
              }}
            >
              {isSavingTime ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Saving timer
                </>
              ) : (
                "Save timer"
              )}
            </Button>
          </CardContent>
        </Card>
      </section>

      <QuestionBuilder
        initialQuestions={lobby.viewerQuestions}
        disabled={lobby.gameState !== "CREATE_QUESTIONS"}
      />

      {error ? (
        <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-red-700 text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
