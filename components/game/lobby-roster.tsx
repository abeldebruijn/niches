import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";

type LobbyPlayer = {
  id: Id<"players">;
  username: string;
  score: number;
  isHost: boolean;
  hasEasy: boolean;
  hasMedium: boolean;
  hasHard: boolean;
  isYou: boolean;
};

type LobbyRosterProps = {
  players: LobbyPlayer[];
  canKickPlayers?: boolean;
  kickingPlayerId?: Id<"players"> | null;
  onKickPlayer?: (playerId: Id<"players">) => void;
};

function readinessLabel(value: boolean) {
  return value ? "Done" : "Pending";
}

export function LobbyRoster({
  players,
  canKickPlayers = false,
  kickingPlayerId = null,
  onKickPlayer,
}: LobbyRosterProps) {
  return (
    <Card className="border-2 border-foreground/10 bg-card/85">
      <CardHeader>
        <CardTitle className="text-xl">Lobby players</CardTitle>
        <CardDescription>
          At least 2 players need to have easy, medium and hard questions before
          the host can start.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {players.map((player) => (
          <div
            key={player.id}
            className="rounded-2xl border border-foreground/15 bg-card/90 p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">{player.username}</p>
                {player.isYou ? (
                  <Badge className="border border-emerald-300 bg-emerald-100 text-emerald-900 dark:border-emerald-400/50 dark:bg-emerald-500/20 dark:text-emerald-100">
                    You
                  </Badge>
                ) : null}
                {player.isHost ? (
                  <Badge className="border border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-400/50 dark:bg-amber-500/20 dark:text-amber-100">
                    Host
                  </Badge>
                ) : null}
              </div>
              {canKickPlayers &&
              onKickPlayer &&
              !player.isHost &&
              !player.isYou ? (
                <Button
                  type="button"
                  variant="destructive"
                  size="xs"
                  disabled={kickingPlayerId !== null}
                  onClick={() => {
                    onKickPlayer(player.id);
                  }}
                >
                  {kickingPlayerId === player.id ? (
                    <>
                      <Loader2 className="size-3 animate-spin" />
                      Kicking
                    </>
                  ) : (
                    "Kick"
                  )}
                </Button>
              ) : null}
            </div>
            <Separator className="my-3" />
            <div className="flex flex-wrap gap-2 text-center text-xs sm:text-sm">
              <Badge
                variant="outline"
                className={cn(
                  "justify-center rounded-xl",
                  player.hasEasy
                    ? "border-emerald-300 bg-emerald-100 text-emerald-900 dark:border-emerald-400/50 dark:bg-emerald-500/20 dark:text-emerald-100"
                    : "border-destructive/60 bg-destructive/10 text-destructive",
                )}
              >
                Easy: {readinessLabel(player.hasEasy)}
              </Badge>
              <Badge
                variant="outline"
                className={cn(
                  "justify-center rounded-xl",
                  player.hasMedium
                    ? "border-emerald-300 bg-emerald-100 text-emerald-900 dark:border-emerald-400/50 dark:bg-emerald-500/20 dark:text-emerald-100"
                    : "border-destructive/60 bg-destructive/10 text-destructive",
                )}
              >
                Medium: {readinessLabel(player.hasMedium)}
              </Badge>
              <Badge
                variant="outline"
                className={cn(
                  "justify-center rounded-xl",
                  player.hasHard
                    ? "border-emerald-300 bg-emerald-100 text-emerald-900 dark:border-emerald-400/50 dark:bg-emerald-500/20 dark:text-emerald-100"
                    : "border-destructive/60 bg-destructive/10 text-destructive",
                )}
              >
                Hard: {readinessLabel(player.hasHard)}
              </Badge>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
