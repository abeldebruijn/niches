import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import type { RoundPhase } from "../types";
import { normalizeStoredStars } from "./validation";

export function nowInSeconds() {
  return Math.floor(Date.now() / 1000);
}

export function questionDurationSeconds(
  phase: RoundPhase,
  timePerQuestion: number,
) {
  return phase === "RATING" ? timePerQuestion * 2 : timePerQuestion;
}

export async function schedulePhaseAdvance(
  ctx: MutationCtx,
  serverId: Id<"servers">,
  expectedNonce: number,
  delaySeconds: number,
) {
  const clampedDelayMs = Math.max(0, Math.round(delaySeconds * 1000));

  await ctx.scheduler.runAfter(
    clampedDelayMs,
    internal.game.advancePhaseOnTimer,
    {
      serverId,
      expectedNonce,
    },
  );
}

export async function ensureCurrentQuestion(
  ctx: MutationCtx,
  server: Doc<"servers">,
  label: string,
) {
  if (!server.currentQuestion) {
    throw new Error(`${label} is missing the active question.`);
  }

  const question = await ctx.db.get(server.currentQuestion);

  if (!question) {
    throw new Error(`${label} active question no longer exists.`);
  }

  return question;
}

export async function startAnsweringPhase(
  ctx: MutationCtx,
  server: Doc<"servers">,
  questionId: Id<"questions">,
  questionCursor: number,
  nextNonce: number,
  startedAtSec: number,
) {
  const endsAtSec =
    startedAtSec + questionDurationSeconds("ANSWERING", server.timePerQuestion);

  await ctx.db.patch(server._id, {
    currentQuestion: questionId,
    questionCursor,
    phase: "ANSWERING",
    phaseStartedAtSec: startedAtSec,
    phaseEndsAtSec: endsAtSec,
    phaseNonce: nextNonce,
  });

  await schedulePhaseAdvance(
    ctx,
    server._id,
    nextNonce,
    Math.max(0, endsAtSec - startedAtSec),
  );
}

export async function startRatingPhase(
  ctx: MutationCtx,
  server: Doc<"servers">,
  nextNonce: number,
  startedAtSec: number,
) {
  const endsAtSec =
    startedAtSec + questionDurationSeconds("RATING", server.timePerQuestion);

  await ctx.db.patch(server._id, {
    phase: "RATING",
    phaseStartedAtSec: startedAtSec,
    phaseEndsAtSec: endsAtSec,
    phaseNonce: nextNonce,
  });

  await schedulePhaseAdvance(
    ctx,
    server._id,
    nextNonce,
    Math.max(0, endsAtSec - startedAtSec),
  );
}

export async function finalizeRatingPhase(
  ctx: MutationCtx,
  server: Doc<"servers">,
  question: Doc<"questions">,
  nextNonce: number,
  nowSec: number,
) {
  const responses = await ctx.db
    .query("responses")
    .withIndex("by_question", (q) => q.eq("question", question._id))
    .collect();

  const pointsByResponder = new Map<Id<"players">, number>();

  for (const response of responses) {
    const correctness = normalizeStoredStars(response.correctnessStars);
    const creativity = normalizeStoredStars(response.creativityStars);
    const points = correctness + creativity;

    if (
      response.correctnessStars !== correctness ||
      response.creativityStars !== creativity ||
      typeof response.ratedAtSec !== "number"
    ) {
      await ctx.db.patch(response._id, {
        correctnessStars: correctness,
        creativityStars: creativity,
        ratedAtSec: response.ratedAtSec ?? nowSec,
      });
    }

    const running = pointsByResponder.get(response.responder) ?? 0;
    pointsByResponder.set(response.responder, running + points);
  }

  for (const [responderId, earnedPoints] of pointsByResponder.entries()) {
    if (earnedPoints < 1) {
      continue;
    }

    const responder = await ctx.db.get(responderId);

    if (!responder || responder.inServer !== server._id) {
      continue;
    }

    await ctx.db.patch(responder._id, {
      score: responder.score + earnedPoints,
    });
  }

  await ctx.db.patch(question._id, {
    isAnswered: true,
  });

  const questionOrder = server.questionOrder ?? [];
  const currentCursor = server.questionCursor ?? 0;
  const nextCursor = currentCursor + 1;

  if (nextCursor >= questionOrder.length) {
    await ctx.db.patch(server._id, {
      gameState: "END_SCREEN",
      currentQuestion: undefined,
      questionCursor: questionOrder.length,
      phase: undefined,
      phaseStartedAtSec: undefined,
      phaseEndsAtSec: undefined,
      phaseNonce: nextNonce,
    });

    return;
  }

  const nextQuestionId = questionOrder[nextCursor];
  await startAnsweringPhase(
    ctx,
    server,
    nextQuestionId,
    nextCursor,
    nextNonce,
    nowSec,
  );
}

export async function advanceRoundPhase(
  ctx: MutationCtx,
  serverId: Id<"servers">,
  expectedNonce: number,
) {
  const server = await ctx.db.get(serverId);

  if (!server || server.gameState !== "PLAY") {
    return { advanced: false, reason: "not_in_play" as const };
  }

  if (
    typeof server.phaseNonce !== "number" ||
    server.phaseNonce !== expectedNonce
  ) {
    return { advanced: false, reason: "stale_nonce" as const };
  }

  if (!server.phase || !server.currentQuestion) {
    return { advanced: false, reason: "missing_phase_state" as const };
  }

  const question = await ctx.db.get(server.currentQuestion);

  if (!question) {
    await ctx.db.patch(server._id, {
      gameState: "END_SCREEN",
      currentQuestion: undefined,
      phase: undefined,
      phaseStartedAtSec: undefined,
      phaseEndsAtSec: undefined,
      phaseNonce: server.phaseNonce + 1,
    });

    return { advanced: false, reason: "missing_question" as const };
  }

  const nextNonce = server.phaseNonce + 1;
  const nowSec = nowInSeconds();

  if (server.phase === "ANSWERING") {
    await startRatingPhase(ctx, server, nextNonce, nowSec);
    return { advanced: true, phase: "RATING" as const };
  }

  await finalizeRatingPhase(ctx, server, question, nextNonce, nowSec);
  return { advanced: true, phase: "ANSWERING_OR_END" as const };
}
