import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

type LobbyPlayer = {
  id: string;
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
};

function readinessLabel(value: boolean) {
  return value ? "Done" : "Pending";
}

export function LobbyRoster({ players }: LobbyRosterProps) {
  return (
    <Card className="border-2 border-foreground/10 bg-white/85">
      <CardHeader>
        <CardTitle className="text-xl">Lobby players</CardTitle>
        <CardDescription>
          Everyone needs easy, medium and hard questions before the host can
          start.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {players.map((player) => (
          <div
            key={player.id}
            className="rounded-2xl border border-foreground/15 bg-white/90 p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold">{player.username}</p>
              {player.isYou ? (
                <Badge className="border border-foreground/20 bg-[#b7ffcf] text-foreground">
                  You
                </Badge>
              ) : null}
              {player.isHost ? (
                <Badge className="border border-foreground/20 bg-[#ffd18a] text-foreground">
                  Host
                </Badge>
              ) : null}
              <Badge
                variant="outline"
                className="ml-auto border-foreground/20 text-foreground/70"
              >
                {player.score} pts
              </Badge>
            </div>
            <Separator className="my-3" />
            <div className="grid grid-cols-3 gap-2 text-center text-xs sm:text-sm">
              <Badge
                variant="outline"
                className="justify-center rounded-xl border-foreground/20"
              >
                Easy: {readinessLabel(player.hasEasy)}
              </Badge>
              <Badge
                variant="outline"
                className="justify-center rounded-xl border-foreground/20"
              >
                Medium: {readinessLabel(player.hasMedium)}
              </Badge>
              <Badge
                variant="outline"
                className="justify-center rounded-xl border-foreground/20"
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
