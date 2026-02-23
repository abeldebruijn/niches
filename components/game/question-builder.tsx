"use client";

import { useMutation } from "convex/react";
import { Loader2, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Difficulty = "easy" | "medium" | "hard";

type QuestionSeed = {
  query: string;
  answer: string;
};

type QuestionBuilderProps = {
  initialQuestions: {
    easy: QuestionSeed | null;
    medium: QuestionSeed | null;
    hard: QuestionSeed | null;
  };
  disabled?: boolean;
};

const difficultyConfig: Record<
  Difficulty,
  { title: string; tint: string; hint: string }
> = {
  easy: {
    title: "Easy",
    tint: "bg-[#b7ffcf]",
    hint: "Warm-up level. Keep it quick and fun.",
  },
  medium: {
    title: "Medium",
    tint: "bg-[#ffe29b]",
    hint: "Needs some thinking, but still fair.",
  },
  hard: {
    title: "Hard",
    tint: "bg-[#ffb8b8]",
    hint: "Brain-bender level. Make it spicy.",
  },
};

export function QuestionBuilder({
  initialQuestions,
  disabled = false,
}: QuestionBuilderProps) {
  const saveQuestion = useMutation(api.game.saveQuestion);

  const [forms, setForms] = useState({
    easy: {
      query: initialQuestions.easy?.query ?? "",
      answer: initialQuestions.easy?.answer ?? "",
    },
    medium: {
      query: initialQuestions.medium?.query ?? "",
      answer: initialQuestions.medium?.answer ?? "",
    },
    hard: {
      query: initialQuestions.hard?.query ?? "",
      answer: initialQuestions.hard?.answer ?? "",
    },
  });
  const [savingDifficulty, setSavingDifficulty] = useState<Difficulty | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [savedDifficulty, setSavedDifficulty] = useState<Difficulty | null>(
    null,
  );

  const seedHash = useMemo(
    () =>
      JSON.stringify({
        easy: initialQuestions.easy,
        medium: initialQuestions.medium,
        hard: initialQuestions.hard,
      }),
    [initialQuestions.easy, initialQuestions.hard, initialQuestions.medium],
  );

  useEffect(() => {
    setForms({
      easy: {
        query: initialQuestions.easy?.query ?? "",
        answer: initialQuestions.easy?.answer ?? "",
      },
      medium: {
        query: initialQuestions.medium?.query ?? "",
        answer: initialQuestions.medium?.answer ?? "",
      },
      hard: {
        query: initialQuestions.hard?.query ?? "",
        answer: initialQuestions.hard?.answer ?? "",
      },
    });
  }, [seedHash, initialQuestions.easy, initialQuestions.hard, initialQuestions.medium]);

  const handleSave = async (difficulty: Difficulty) => {
    setSavingDifficulty(difficulty);
    setSavedDifficulty(null);
    setError(null);

    try {
      await saveQuestion({
        difficulty,
        query: forms[difficulty].query,
        answer: forms[difficulty].answer,
      });
      setSavedDifficulty(difficulty);
    } catch (saveError) {
      const message =
        saveError instanceof Error
          ? saveError.message
          : "Could not save your question.";
      setError(message);
    } finally {
      setSavingDifficulty(null);
    }
  };

  return (
    <Card className="border-2 border-foreground/10 bg-white/85">
      <CardHeader>
        <CardTitle className="text-xl">Your 3 questions</CardTitle>
        <CardDescription>
          Fill in one easy, one medium and one hard question before game start.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {(["easy", "medium", "hard"] as Difficulty[]).map((difficulty) => {
          const config = difficultyConfig[difficulty];
          const isSaving = savingDifficulty === difficulty;
          const isSaved = savedDifficulty === difficulty;

          return (
            <section
              key={difficulty}
              className="rounded-2xl border border-foreground/15 bg-white/95 p-4"
            >
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Badge
                  className={`${config.tint} border border-foreground/20 text-foreground`}
                >
                  {config.title}
                </Badge>
                <p className="text-sm text-foreground/70">{config.hint}</p>
                {isSaved ? (
                  <Badge
                    variant="outline"
                    className="ml-auto border-foreground/20 text-foreground/70"
                  >
                    Saved
                  </Badge>
                ) : null}
              </div>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor={`${difficulty}-query`}>Question</Label>
                  <Textarea
                    id={`${difficulty}-query`}
                    value={forms[difficulty].query}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setForms((current) => ({
                        ...current,
                        [difficulty]: {
                          ...current[difficulty],
                          query: nextValue,
                        },
                      }));
                    }}
                    placeholder={`Enter your ${difficulty} question`}
                    disabled={disabled || isSaving}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor={`${difficulty}-answer`}>Answer</Label>
                  <Textarea
                    id={`${difficulty}-answer`}
                    value={forms[difficulty].answer}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setForms((current) => ({
                        ...current,
                        [difficulty]: {
                          ...current[difficulty],
                          answer: nextValue,
                        },
                      }));
                    }}
                    placeholder={`Enter the answer for your ${difficulty} question`}
                    disabled={disabled || isSaving}
                  />
                </div>

                <Button
                  type="button"
                  className="w-full rounded-full"
                  disabled={disabled || isSaving}
                  onClick={() => {
                    void handleSave(difficulty);
                  }}
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Saving
                    </>
                  ) : (
                    <>
                      <Sparkles className="size-4" />
                      Save {config.title}
                    </>
                  )}
                </Button>
              </div>
            </section>
          );
        })}

        {error ? (
          <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
