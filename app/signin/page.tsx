"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { Dice6 } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useMemo, useState } from "react";

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

const USERNAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{2,19}$/;
const ADJECTIVES = [
  "Cosmic",
  "Neon",
  "Pixel",
  "Whiz",
  "Turbo",
  "Mellow",
  "Jazzy",
  "Witty",
];
const NOUNS = [
  "Panda",
  "Falcon",
  "Otter",
  "Vortex",
  "Wizard",
  "Comet",
  "Riddle",
  "Voyager",
];

function createUsernameSuggestion() {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const number = Math.floor(10 + Math.random() * 89);

  return `${adjective}${noun}${number}`;
}

export default function SignInPage() {
  const router = useRouter();
  const { signIn } = useAuthActions();
  const { isAuthenticated, isLoading } = useConvexAuth();

  const [username, setUsername] = useState("CosmicOtter42");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const suggestions = useMemo(
    () => ["NeonPanda22", "WittyFalcon57", "TurboWizard81"],
    [],
  );

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace("/");
    }
  }, [isAuthenticated, isLoading, router]);

  const usernameHint = useMemo(() => {
    if (USERNAME_PATTERN.test(username.trim())) {
      return "Looks good.";
    }

    return "Use 3-20 chars, start with a letter, and only letters, numbers, _ or -.";
  }, [username]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmed = username.trim();

    if (!USERNAME_PATTERN.test(trimmed)) {
      setError(
        "Pick a creative username with 3-20 characters, starting with a letter.",
      );
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await signIn("anonymous", { username: trimmed });
      router.push("/");
    } catch (signInError) {
      const message =
        signInError instanceof Error
          ? signInError.message
          : "Could not sign in right now.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="relative grid min-h-screen place-items-center overflow-x-hidden px-4 py-10">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-24 -left-24 h-72 w-72 rounded-full bg-[#ff9b9b]/35 blur-3xl" />
        <div className="absolute top-1/4 -right-24 h-80 w-80 rounded-full bg-[#64d7ff]/35 blur-3xl" />
        <div className="absolute -bottom-32 left-1/3 h-96 w-96 rounded-full bg-[#ffe16b]/30 blur-3xl" />
      </div>

      <Card className="w-full max-w-md border-2 border-foreground/10 bg-card/85 shadow-[0_18px_50px_rgba(0,0,0,0.12)]">
        <CardHeader className="space-y-3 text-center">
          <CardTitle className="font-(--font-display) text-4xl leading-none">
            Niches trivia game
          </CardTitle>
          <CardDescription>
            The game where you create questions and challenge your friends how
            well they know you.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(event) => void handleSubmit(event)}
          >
            <div className="space-y-2">
              <Label htmlFor="username">Choose a creative username</Label>
              <Input
                id="username"
                value={username}
                onChange={(event) => {
                  setUsername(event.target.value);
                }}
                autoComplete="off"
                placeholder="CosmicOtter42"
                maxLength={20}
                className="placeholder:text-muted-foreground/80"
              />
              <p className="text-foreground/70 text-xs">{usernameHint}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Badge
                variant="outline"
                className="border-foreground/20 bg-background/75 text-foreground"
              >
                Ideas:
              </Badge>
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className="inline-flex items-center rounded-full border border-foreground/20 bg-background/75 px-3 py-1 font-semibold text-foreground/75 text-xs transition-colors hover:bg-foreground/5"
                  onClick={() => {
                    setUsername(suggestion);
                  }}
                >
                  {suggestion}
                </button>
              ))}
            </div>

            <Button
              type="button"
              variant="outline"
              className="w-full rounded-full border-2 border-foreground/20 bg-background/75"
              onClick={() => {
                setUsername(createUsernameSuggestion());
              }}
            >
              <Dice6 className="size-4" />
              Randomize name
            </Button>

            <Button
              type="submit"
              className="w-full rounded-full text-base"
              disabled={loading}
            >
              {loading ? "Starting session..." : "Continue"}
            </Button>

            {error ? (
              <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-sm">
                {error}
              </p>
            ) : null}
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
