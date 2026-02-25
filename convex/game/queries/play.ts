import { v } from "convex/values";
import { query } from "../../_generated/server";
import { requirePlayerForQuery } from "../helpers/authPlayer";
import {
  nowInSeconds,
  questionDurationSeconds,
} from "../helpers/roundLifecycle";
import { responseIsFullyRated } from "../helpers/validation";

export const playScreen = query({
  args: {
    code: v.number(),
  },
  handler: async (ctx, args) => {
    const player = await requirePlayerForQuery(ctx);

    if (!player) {
      return null;
    }

    const server = await ctx.db
      .query("servers")
      .withIndex("by_code", (q) => q.eq("code", args.code))
      .unique();

    if (!server || !player.inServer || server._id !== player.inServer) {
      return null;
    }

    const playersInLobby = await ctx.db
      .query("players")
      .withIndex("by_in_server", (q) => q.eq("inServer", server._id))
      .collect();

    const sortedPlayers = playersInLobby
      .sort((a, b) => b.score - a.score || a.username.localeCompare(b.username))
      .map((candidate) => ({
        id: candidate._id,
        username: candidate.username,
        score: candidate.score,
        isHost: candidate._id === server.hostPlayer,
        isYou: candidate._id === player._id,
      }));

    const base = {
      code: server.code,
      gameState: server.gameState,
      yourScore: player.score,
      yourUsername: player.username,
      isHost: server.hostPlayer === player._id,
      players: sortedPlayers,
      serverNowSec: nowInSeconds(),
    };

    if (
      server.gameState !== "PLAY" ||
      !server.currentQuestion ||
      !server.phase ||
      typeof server.phaseEndsAtSec !== "number" ||
      typeof server.phaseNonce !== "number"
    ) {
      return {
        ...base,
        phase: null,
        phaseEndsAtSec: null,
        phaseStartedAtSec: null,
        phaseDurationSec: null,
        questionProgress: null,
        question: null,
        role: null,
        canGoNextEarly: false,
        canSubmitAnswer: false,
        canRateResponses: false,
        rating: null,
        answering: null,
      };
    }

    const question = await ctx.db.get(server.currentQuestion);

    if (!question) {
      return {
        ...base,
        phase: server.phase,
        phaseEndsAtSec: server.phaseEndsAtSec,
        phaseStartedAtSec: server.phaseStartedAtSec ?? null,
        phaseDurationSec: questionDurationSeconds(
          server.phase,
          server.timePerQuestion,
        ),
        questionProgress: null,
        question: null,
        role: null,
        canGoNextEarly: false,
        canSubmitAnswer: false,
        canRateResponses: false,
        rating: null,
        answering: null,
      };
    }

    const responses = (
      await ctx.db
        .query("responses")
        .withIndex("by_question", (q) => q.eq("question", question._id))
        .collect()
    )
      .filter((response) => response.responder !== question.player)
      .sort((a, b) => a.submittedAtSec - b.submittedAtSec);

    const isRatingPlayer = question.player === player._id;
    const questionProgress = {
      current: (server.questionCursor ?? 0) + 1,
      total: server.questionOrder?.length ?? 1,
    };

    const nowSec = nowInSeconds();
    const canSubmitAnswer =
      !isRatingPlayer &&
      server.phase === "ANSWERING" &&
      nowSec < server.phaseEndsAtSec;
    const canRateResponses =
      isRatingPlayer &&
      server.phase === "RATING" &&
      nowSec < server.phaseEndsAtSec;

    const allResponsesRated = responses.every(responseIsFullyRated);
    const canGoNextEarly =
      server.hostPlayer === player._id ||
      (isRatingPlayer && server.phase === "RATING" && allResponsesRated);

    const yourResponse = !isRatingPlayer
      ? await ctx.db
          .query("responses")
          .withIndex("by_question_responder", (q) =>
            q.eq("question", question._id).eq("responder", player._id),
          )
          .unique()
      : null;

    return {
      ...base,
      phase: server.phase,
      phaseEndsAtSec: server.phaseEndsAtSec,
      phaseStartedAtSec: server.phaseStartedAtSec ?? null,
      phaseDurationSec: questionDurationSeconds(
        server.phase,
        server.timePerQuestion,
      ),
      questionProgress,
      question: {
        id: question._id,
        query: question.query,
        difficulty: question.difficulty,
        canonicalAnswer: isRatingPlayer ? question.answer : null,
      },
      role: isRatingPlayer ? "RATING_PLAYER" : "ANSWERING_PLAYER",
      canGoNextEarly,
      canSubmitAnswer,
      canRateResponses,
      rating: isRatingPlayer
        ? {
            totalSubmittedResponses: responses.length,
            allSubmittedResponsesRated: allResponsesRated,
            responses: responses.map((response, index) => ({
              id: response._id,
              label: `Response ${index + 1}`,
              answer: response.answer,
              correctnessStars:
                typeof response.correctnessStars === "number"
                  ? response.correctnessStars
                  : null,
              creativityStars:
                typeof response.creativityStars === "number"
                  ? response.creativityStars
                  : null,
            })),
          }
        : null,
      answering: !isRatingPlayer
        ? {
            yourResponse: yourResponse
              ? {
                  answer: yourResponse.answer,
                  submittedAtSec: yourResponse.submittedAtSec,
                  updatedAtSec: yourResponse.updatedAtSec,
                }
              : null,
          }
        : null,
    };
  },
});
