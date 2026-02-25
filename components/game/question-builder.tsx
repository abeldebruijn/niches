"use client";

import { experimental_useObject as useObject } from "@ai-sdk/react";
import { useMutation } from "convex/react";
import { Loader2, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import {
  type GeneratedQuestion,
  generatedQuestionSchema,
  type QuestionGenerationInput,
  questionGenerationTopicOptions,
} from "@/lib/question-generation";

type Difficulty = "easy" | "medium" | "hard";
type TopicChoice = (typeof questionGenerationTopicOptions)[number] | "custom";

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
    tint: "border-emerald-300 bg-emerald-100 text-emerald-900 dark:border-emerald-400/50 dark:bg-emerald-500/20 dark:text-emerald-100",
    hint: "Warm-up level. Keep it quick and fun. For example: Where did you go to school?",
  },
  medium: {
    title: "Medium",
    tint: "border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-400/50 dark:bg-amber-500/20 dark:text-amber-100",
    hint: "Needs some thinking, but still fair. For example: What's your go-to karaoke song?",
  },
  hard: {
    title: "Hard",
    tint: "border-rose-300 bg-rose-100 text-rose-900 dark:border-rose-400/50 dark:bg-rose-500/20 dark:text-rose-100",
    hint: "Brain-bender level. Make it spicy and niche!",
  },
};

const defaultTopicChoice: Record<Difficulty, TopicChoice> = {
  easy: "General",
  medium: "General",
  hard: "General",
};

const selectClassName =
  "flex h-11 w-full min-w-0 rounded-xl border border-input bg-background/80 px-3 py-2 text-base shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/60 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50";

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
  const [generatingDifficulty, setGeneratingDifficulty] =
    useState<Difficulty | null>(null);
  const [topicChoice, setTopicChoice] =
    useState<Record<Difficulty, TopicChoice>>(defaultTopicChoice);
  const [customTopic, setCustomTopic] = useState<Record<Difficulty, string>>({
    easy: "",
    medium: "",
    hard: "",
  });
  const generationDifficultyRef = useRef<Difficulty | null>(null);

  const seedHash = useMemo(
    () =>
      JSON.stringify({
        easy: initialQuestions.easy,
        medium: initialQuestions.medium,
        hard: initialQuestions.hard,
      }),
    [initialQuestions.easy, initialQuestions.hard, initialQuestions.medium],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: <explanation> We only want to reset the forms when the initial questions change, not when the user types in the form and updates the state.</explanation>
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
  }, [
    seedHash,
    initialQuestions.easy,
    initialQuestions.hard,
    initialQuestions.medium,
  ]);

  const {
    object: generatedObject,
    submit: generateQuestion,
    isLoading: isGenerating,
    clear: clearGeneratedObject,
  } = useObject<
    typeof generatedQuestionSchema,
    GeneratedQuestion,
    QuestionGenerationInput
  >({
    api: "/api/questions/generate",
    schema: generatedQuestionSchema,
    onError: (generationError) => {
      generationDifficultyRef.current = null;
      setGeneratingDifficulty(null);
      const message =
        generationError instanceof Error
          ? generationError.message
          : "Could not generate your question.";
      setError(message);
    },
    onFinish: async ({ object, error: generationError }) => {
      const targetDifficulty = generationDifficultyRef.current;
      generationDifficultyRef.current = null;
      setGeneratingDifficulty(null);

      if (!targetDifficulty) {
        return;
      }

      if (generationError) {
        setError(generationError.message);
        return;
      }

      if (!object?.query || !object?.answer) {
        setError("The generated question was incomplete.");
        return;
      }

      setForms((current) => ({
        ...current,
        [targetDifficulty]: {
          query: object.query,
          answer: object.answer,
        },
      }));

      await handleSave(targetDifficulty, object);
    },
  });

  useEffect(() => {
    if (!generatedObject || !generatingDifficulty) {
      return;
    }

    setForms((current) => ({
      ...current,
      [generatingDifficulty]: {
        query: generatedObject.query ?? current[generatingDifficulty].query,
        answer: generatedObject.answer ?? current[generatingDifficulty].answer,
      },
    }));
  }, [generatedObject, generatingDifficulty]);

  async function handleSave(difficulty: Difficulty, draft?: QuestionSeed) {
    const questionToSave = draft ?? forms[difficulty];

    if (!questionToSave.query.trim() || !questionToSave.answer.trim()) {
      setError("Both question and answer are required.");
      return;
    }

    setSavingDifficulty(difficulty);
    setSavedDifficulty(null);
    setError(null);

    try {
      await saveQuestion({
        difficulty,
        query: questionToSave.query,
        answer: questionToSave.answer,
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
  }

  const handleGenerate = (difficulty: Difficulty) => {
    const chosenTopic =
      topicChoice[difficulty] === "custom"
        ? customTopic[difficulty].trim()
        : topicChoice[difficulty];

    if (!chosenTopic) {
      setError("Enter a custom topic before generating.");
      return;
    }

    setError(null);
    setSavedDifficulty(null);
    setForms((current) => ({
      ...current,
      [difficulty]: {
        query: "",
        answer: "",
      },
    }));
    clearGeneratedObject();
    generationDifficultyRef.current = difficulty;
    setGeneratingDifficulty(difficulty);
    generateQuestion({ difficulty, topic: chosenTopic });
  };

  return (
    <Card className="border-2 border-foreground/10 bg-card/85">
      <CardHeader>
        <CardTitle className="text-xl">Your 3 questions</CardTitle>
        <CardDescription className="sm:max-w-1/2">
          Fill in one easy, one medium and one hard question before game start.
          Questions can be about anything, but should be about you! Don't worry,
          you can always generate some generic questions using AI or edit them
          later on. Answers will be judged based on correctness and creativity.
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
              className="rounded-2xl border border-foreground/15 bg-card/95 p-4"
            >
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Badge className={config.tint}>{config.title}</Badge>
                <p className="text-foreground/70 text-sm">{config.hint}</p>
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
                    disabled={
                      disabled ||
                      isSaving ||
                      (isGenerating && generatingDifficulty === difficulty)
                    }
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
                    disabled={
                      disabled ||
                      isSaving ||
                      (isGenerating && generatingDifficulty === difficulty)
                    }
                  />
                </div>

                <div className="space-y-3 rounded-xl border border-foreground/10 bg-card/80 p-3">
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
                    <div className="space-y-1.5">
                      <Label htmlFor={`${difficulty}-topic`}>
                        Topic for generated question
                      </Label>
                      <select
                        id={`${difficulty}-topic`}
                        value={topicChoice[difficulty]}
                        onChange={(event) => {
                          setTopicChoice((current) => ({
                            ...current,
                            [difficulty]: event.target.value as TopicChoice,
                          }));
                        }}
                        className={selectClassName}
                        disabled={disabled || isSaving || isGenerating}
                      >
                        {questionGenerationTopicOptions.map((topic) => (
                          <option key={topic} value={topic}>
                            {topic}
                          </option>
                        ))}
                        <option value="custom">Custom</option>
                      </select>
                    </div>

                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-full border-2"
                      disabled={
                        disabled ||
                        isSaving ||
                        isGenerating ||
                        (topicChoice[difficulty] === "custom" &&
                          !customTopic[difficulty].trim())
                      }
                      onClick={() => {
                        handleGenerate(difficulty);
                      }}
                    >
                      {isGenerating && generatingDifficulty === difficulty ? (
                        <>
                          <Loader2 className="size-4 animate-spin" />
                          Generating
                        </>
                      ) : (
                        <>
                          <Sparkles className="size-4" />
                          Generate
                        </>
                      )}
                    </Button>

                    <Button
                      type="button"
                      className="rounded-full"
                      disabled={disabled || isSaving || isGenerating}
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
                        `Save ${config.title}`
                      )}
                    </Button>
                  </div>

                  {topicChoice[difficulty] === "custom" ? (
                    <div className="space-y-1.5">
                      <Label htmlFor={`${difficulty}-custom-topic`}>
                        Custom topic
                      </Label>
                      <Input
                        id={`${difficulty}-custom-topic`}
                        value={customTopic[difficulty]}
                        onChange={(event) => {
                          const nextValue = event.target.value;
                          setCustomTopic((current) => ({
                            ...current,
                            [difficulty]: nextValue,
                          }));
                        }}
                        placeholder="Enter your own topic"
                        disabled={disabled || isSaving || isGenerating}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            </section>
          );
        })}

        {error ? (
          <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-sm">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
