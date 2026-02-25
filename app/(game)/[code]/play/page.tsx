"use client";

import { useMutation, useQuery } from "convex/react";
import { Crown, Loader2, Send, SkipForward, Star, Timer } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";

const countdownMilestones = [10, 5, 3] as const;

function formatSeconds(totalSeconds: number) {
  const safe = Math.max(0, totalSeconds);
  const minutes = Math.floor(safe / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (safe % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function phaseLabel(phase: "ANSWERING" | "RATING" | null) {
  if (phase === "ANSWERING") {
    return "Answering";
  }

  if (phase === "RATING") {
    return "Rating";
  }

  return "Waiting";
}

function difficultyLabel(difficulty: "EASY" | "MEDIUM" | "HARD") {
  if (difficulty === "EASY") {
    return "Easy";
  }

  if (difficulty === "MEDIUM") {
    return "Medium";
  }

  return "Hard";
}

function StarScale({
  value,
  disabled,
  onChange,
}: {
  value: number;
  disabled: boolean;
  onChange: (next: number) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Button
        type="button"
        size="xs"
        variant={value === 0 ? "default" : "outline"}
        disabled={disabled}
        className="rounded-lg"
        onClick={() => {
          onChange(0);
        }}
      >
        0
      </Button>
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          type="button"
          key={star}
          className={cn(
            "grid size-8 place-items-center rounded-lg border transition",
            value >= star
              ? "border-amber-400 bg-amber-100 text-amber-800 dark:border-amber-400/50 dark:bg-amber-500/20 dark:text-amber-100"
              : "border-border bg-background/75 text-muted-foreground",
            disabled && "cursor-not-allowed opacity-70",
          )}
          disabled={disabled}
          onClick={() => {
            onChange(star);
          }}
        >
          <Star className={cn("size-4", value >= star && "fill-current")} />
        </button>
      ))}
    </div>
  );
}

export default function PlayScreenPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const code = Number(params.code);
  const isCodeValid =
    Number.isInteger(code) && code >= 100000 && code <= 999999;

  const playData = useQuery(
    api.game.playScreen,
    isCodeValid ? { code } : "skip",
  );
  const submitResponse = useMutation(api.game.submitResponse);
  const rateResponse = useMutation(api.game.rateResponse);
  const goToNextQuestionEarly = useMutation(api.game.goToNextQuestionEarly);

  const [answerDraft, setAnswerDraft] = useState("");
  const [isSubmittingAnswer, setIsSubmittingAnswer] = useState(false);
  const [answerError, setAnswerError] = useState<string | null>(null);

  const [ratingDrafts, setRatingDrafts] = useState<
    Record<string, { correctness: number; creativity: number }>
  >({});
  const [savingRatingId, setSavingRatingId] = useState<Id<"responses"> | null>(
    null,
  );
  const [ratingError, setRatingError] = useState<string | null>(null);

  const [isAdvancing, setIsAdvancing] = useState(false);
  const [advanceError, setAdvanceError] = useState<string | null>(null);

  const [serverOffsetSec, setServerOffsetSec] = useState(0);
  const [, tick] = useState(0);
  const answerDraftQuestionId = useRef<Id<"questions"> | null>(null);
  const previousCountdownKeyRef = useRef<string | null>(null);
  const previousRemainingSecRef = useRef<number | null>(null);
  const previousFeedbackToastKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const interval = window.setInterval(() => {
      tick((value) => value + 1);
    }, 500);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!playData) {
      return;
    }

    setServerOffsetSec(playData.serverNowSec - Math.floor(Date.now() / 1000));
  }, [playData]);

  useEffect(() => {
    if (!playData) {
      return;
    }

    if (playData.gameState === "END_SCREEN") {
      router.replace(`/${playData.code}/end-screen`);
      return;
    }

    if (playData.gameState === "CREATE_QUESTIONS") {
      router.replace(playData.isHost ? "/create" : "/join");
    }
  }, [playData, router]);

  useEffect(() => {
    if (!playData?.question || playData.role !== "ANSWERING_PLAYER") {
      return;
    }

    if (answerDraftQuestionId.current === playData.question.id) {
      return;
    }

    answerDraftQuestionId.current = playData.question.id;
    setAnswerDraft(playData.answering?.yourResponse?.answer ?? "");
  }, [
    playData?.answering?.yourResponse?.answer,
    playData?.question,
    playData?.role,
  ]);

  useEffect(() => {
    const ratingData = playData?.rating;

    if (!ratingData?.responses) {
      return;
    }

    setRatingDrafts((current) => {
      const next: Record<string, { correctness: number; creativity: number }> =
        {};

      for (const response of ratingData.responses) {
        const id = response.id;
        next[id] = {
          correctness:
            current[id]?.correctness ?? response.correctnessStars ?? 0,
          creativity: current[id]?.creativity ?? response.creativityStars ?? 0,
        };
      }

      return next;
    });
  }, [playData?.rating]);

  const estimatedServerNowSec = Math.floor(Date.now() / 1000) + serverOffsetSec;
  const remainingSec =
    playData?.phaseEndsAtSec != null
      ? Math.max(0, playData.phaseEndsAtSec - estimatedServerNowSec)
      : 0;
  const timerProgress =
    playData?.phaseDurationSec && playData.phaseDurationSec > 0
      ? Math.max(0, Math.min(1, remainingSec / playData.phaseDurationSec))
      : 0;

  const nextButtonLabel = useMemo(() => {
    if (!playData?.phase) {
      return "Next";
    }

    if (playData.phase === "ANSWERING") {
      return "Start rating now";
    }

    return "Next question now";
  }, [playData?.phase]);

  useEffect(() => {
    if (!playData?.phase || !playData.question) {
      previousCountdownKeyRef.current = null;
      previousRemainingSecRef.current = null;
      return;
    }

    const countdownKey = `${playData.question.id}:${playData.phase}`;

    if (previousCountdownKeyRef.current !== countdownKey) {
      previousCountdownKeyRef.current = countdownKey;
      previousRemainingSecRef.current = remainingSec;
      return;
    }

    const previousRemainingSec = previousRemainingSecRef.current;
    previousRemainingSecRef.current = remainingSec;

    if (previousRemainingSec === null || remainingSec <= 0) {
      return;
    }

    const crossedMilestone = countdownMilestones.find(
      (milestone) =>
        previousRemainingSec > milestone && remainingSec <= milestone,
    );

    if (crossedMilestone === undefined) {
      return;
    }

    toast.message(`${crossedMilestone} seconds left`, {
      description:
        playData.phase === "RATING"
          ? "Finish your ratings before time runs out."
          : "Finish your answer before time runs out.",
      duration: 1800,
      id: `countdown-${countdownKey}-${crossedMilestone}`,
    });
  }, [playData?.phase, playData?.question, remainingSec]);

  useEffect(() => {
    const feedback = playData?.latestAnswerFeedback;

    if (!feedback) {
      return;
    }

    const toastKey = `${feedback.questionId}:${feedback.correctnessStars}:${feedback.creativityStars}:${feedback.yourAnswer}:${feedback.correctAnswer}`;

    if (previousFeedbackToastKeyRef.current === toastKey) {
      return;
    }

    previousFeedbackToastKeyRef.current = toastKey;

    toast.message("Last round scored", {
      id: `answer-feedback-${feedback.questionId}`,
      duration: 10000,
      description: (
        <div className="space-y-1">
          <p>Correctness: {feedback.correctnessStars}/5 stars</p>
          <p>Creativity: {feedback.creativityStars}/5 stars</p>
          <p>Correct answer: {feedback.correctAnswer}</p>
          <p>Your answer: {feedback.yourAnswer}</p>
        </div>
      ),
    });
  }, [playData?.latestAnswerFeedback]);

  const handleSubmitAnswer = async () => {
    if (!playData) {
      return;
    }

    setIsSubmittingAnswer(true);
    setAnswerError(null);

    try {
      await submitResponse({
        code: playData.code,
        answer: answerDraft,
      });
    } catch (error) {
      setAnswerError(
        error instanceof Error
          ? error.message
          : "Could not submit your answer.",
      );
    } finally {
      setIsSubmittingAnswer(false);
    }
  };

  const handleSaveRating = async (responseId: Id<"responses">) => {
    if (!playData) {
      return;
    }

    const draft = ratingDrafts[responseId];

    if (!draft) {
      return;
    }

    setSavingRatingId(responseId);
    setRatingError(null);

    try {
      await rateResponse({
        code: playData.code,
        responseId,
        correctnessStars: draft.correctness,
        creativityStars: draft.creativity,
      });
    } catch (error) {
      setRatingError(
        error instanceof Error ? error.message : "Could not save this rating.",
      );
    } finally {
      setSavingRatingId((current) => (current === responseId ? null : current));
    }
  };

  const handleAdvanceEarly = async () => {
    if (!playData) {
      return;
    }

    setIsAdvancing(true);
    setAdvanceError(null);

    try {
      await goToNextQuestionEarly({ code: playData.code });
    } catch (error) {
      setAdvanceError(
        error instanceof Error
          ? error.message
          : "Could not advance to the next question.",
      );
    } finally {
      setIsAdvancing(false);
    }
  };

  if (!isCodeValid) {
    return (
      <main className="grid min-h-screen place-items-center px-4">
        <Card className="w-full max-w-md border-2 border-foreground/10 bg-card/90">
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
        <p className="rounded-full border border-foreground/20 bg-card/90 px-4 py-2 font-semibold text-foreground/70 text-sm">
          Opening play screen...
        </p>
      </main>
    );
  }

  if (!playData) {
    return (
      <main className="grid min-h-screen place-items-center px-4">
        <Card className="w-full max-w-md border-2 border-foreground/10 bg-card/90">
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

  if (playData.gameState !== "PLAY" || !playData.question || !playData.role) {
    return (
      <main className="grid min-h-screen place-items-center px-4">
        <Card className="w-full max-w-md border-2 border-foreground/10 bg-card/90">
          <CardHeader>
            <CardTitle>Waiting for game state</CardTitle>
            <CardDescription>
              This lobby is currently synchronizing your round state.
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
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-4">
        <Card className="border-2 border-foreground/10 bg-card/85 backdrop-blur">
          <CardContent className="flex flex-col gap-4 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-1">
                <p className="font-semibold text-muted-foreground text-xs uppercase tracking-[0.12em]">
                  Lobby {playData.code}
                </p>
                <h1 className="font-(--font-display) text-3xl leading-none">
                  Play Round
                </h1>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Badge className="border border-emerald-300 bg-emerald-100 text-emerald-900 dark:border-emerald-400/50 dark:bg-emerald-500/20 dark:text-emerald-100">
                  <Star className="size-3.5" />
                  Your score: {playData.yourScore}
                </Badge>
                <Badge
                  variant="outline"
                  className="border-foreground/20 text-foreground/70"
                >
                  {phaseLabel(playData.phase)} phase
                </Badge>
                <Badge
                  variant="outline"
                  className="border-foreground/20 text-foreground/70"
                >
                  {difficultyLabel(playData.question.difficulty)}
                </Badge>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className="rounded-full border-foreground/20 bg-background/75 px-3 py-1 text-foreground"
                  >
                    Question {playData.questionProgress?.current ?? "-"} of{" "}
                    {playData.questionProgress?.total ?? "-"}
                  </Badge>
                  <Badge
                    variant="outline"
                    className="rounded-full border-foreground/20 bg-background/75 px-3 py-1 text-foreground"
                  >
                    <Timer className="size-3.5" />
                    {formatSeconds(remainingSec)} remaining
                  </Badge>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-foreground/10">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-500"
                    style={{ width: `${timerProgress * 100}%` }}
                  />
                </div>
              </div>

              {playData.canGoNextEarly ? (
                <Button
                  type="button"
                  className="rounded-full"
                  disabled={isAdvancing}
                  onClick={() => {
                    void handleAdvanceEarly();
                  }}
                >
                  {isAdvancing ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Advancing
                    </>
                  ) : (
                    <>
                      <SkipForward className="size-4" />
                      {nextButtonLabel}
                    </>
                  )}
                </Button>
              ) : null}
            </div>

            {advanceError ? (
              <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-sm">
                {advanceError}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Card className="border-2 border-foreground/10 bg-card/85">
            <CardHeader>
              <CardTitle className="text-xl">
                {playData.question.query}
              </CardTitle>
              <CardDescription>
                {playData.role === "RATING_PLAYER"
                  ? "Review each anonymous response for correctness and creativity."
                  : "Submit your best answer before the timer expires."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {playData.role === "RATING_PLAYER" ? (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-foreground/15 bg-card/90 p-3">
                    <p className="font-semibold text-foreground/70 text-sm uppercase tracking-[0.08em]">
                      Original answer
                    </p>
                    <p className="mt-1 text-foreground">
                      {playData.question.canonicalAnswer}
                    </p>
                  </div>

                  {playData.rating?.responses.length ? (
                    <div className="space-y-3">
                      {playData.rating.responses.map((response) => {
                        const draft = ratingDrafts[response.id] ?? {
                          correctness: response.correctnessStars ?? 0,
                          creativity: response.creativityStars ?? 0,
                        };
                        const isSaving = savingRatingId === response.id;
                        const hasSavedValues =
                          response.correctnessStars === draft.correctness &&
                          response.creativityStars === draft.creativity;

                        return (
                          <article
                            key={response.id}
                            className="space-y-3 rounded-2xl border border-foreground/15 bg-card/95 p-4"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="font-semibold">{response.label}</p>
                              <Badge
                                variant="outline"
                                className="border-foreground/20 text-foreground/70"
                              >
                                {hasSavedValues ? "Saved" : "Unsaved"}
                              </Badge>
                            </div>
                            <p className="text-foreground">{response.answer}</p>

                            <div className="space-y-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="font-semibold text-sm">
                                  Correctness
                                </p>
                                <StarScale
                                  value={draft.correctness}
                                  disabled={
                                    !playData.canRateResponses || isSaving
                                  }
                                  onChange={(next) => {
                                    setRatingDrafts((current) => ({
                                      ...current,
                                      [response.id]: {
                                        ...draft,
                                        correctness: next,
                                      },
                                    }));
                                  }}
                                />
                              </div>

                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="font-semibold text-sm">
                                  Creativity
                                </p>
                                <StarScale
                                  value={draft.creativity}
                                  disabled={
                                    !playData.canRateResponses || isSaving
                                  }
                                  onChange={(next) => {
                                    setRatingDrafts((current) => ({
                                      ...current,
                                      [response.id]: {
                                        ...draft,
                                        creativity: next,
                                      },
                                    }));
                                  }}
                                />
                              </div>
                            </div>

                            <Button
                              type="button"
                              size="sm"
                              className="rounded-full"
                              disabled={
                                !playData.canRateResponses ||
                                isSaving ||
                                hasSavedValues
                              }
                              onClick={() => {
                                void handleSaveRating(response.id);
                              }}
                            >
                              {isSaving ? (
                                <>
                                  <Loader2 className="size-4 animate-spin" />
                                  Saving
                                </>
                              ) : (
                                "Save ratings"
                              )}
                            </Button>
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="rounded-xl border border-foreground/15 bg-card/90 px-3 py-2 text-foreground/70 text-sm">
                      No responses were submitted for this question.
                    </p>
                  )}

                  <p className="text-foreground/70 text-sm">
                    Rated:{" "}
                    {playData.rating?.allSubmittedResponsesRated ? "Yes" : "No"}
                  </p>

                  {ratingError ? (
                    <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-sm">
                      {ratingError}
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <p className="font-semibold text-sm">Your answer</p>
                    <Textarea
                      value={answerDraft}
                      onChange={(event) => {
                        setAnswerDraft(event.target.value);
                      }}
                      placeholder="Write your answer"
                      disabled={!playData.canSubmitAnswer || isSubmittingAnswer}
                    />
                  </div>

                  <Button
                    type="button"
                    className="rounded-full"
                    disabled={!playData.canSubmitAnswer || isSubmittingAnswer}
                    onClick={() => {
                      void handleSubmitAnswer();
                    }}
                  >
                    {isSubmittingAnswer ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        Submitting
                      </>
                    ) : (
                      <>
                        <Send className="size-4" />
                        {playData.answering?.yourResponse
                          ? "Update answer"
                          : "Submit answer"}
                      </>
                    )}
                  </Button>

                  {playData.answering?.yourResponse ? (
                    <p className="text-foreground/70 text-sm">
                      Last saved answer:{" "}
                      {playData.answering.yourResponse.answer}
                    </p>
                  ) : null}

                  {answerError ? (
                    <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-sm">
                      {answerError}
                    </p>
                  ) : null}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-2 border-foreground/10 bg-card/85">
            <CardHeader>
              <CardTitle className="text-xl">Scoreboard</CardTitle>
              <CardDescription>
                Live ranking updates as rounds are scored.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {playData.players.map((player) => (
                <div
                  key={player.id}
                  className="flex items-center justify-between rounded-xl border border-foreground/15 bg-card/90 px-3 py-2"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold">{player.username}</span>
                    {player.isHost ? <Crown className="size-3.5" /> : null}
                    {player.isYou ? (
                      <Badge className="border border-emerald-300 bg-emerald-100 text-emerald-900 dark:border-emerald-400/50 dark:bg-emerald-500/20 dark:text-emerald-100">
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
        </section>
      </section>
    </main>
  );
}
