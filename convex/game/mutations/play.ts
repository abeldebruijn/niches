import { v } from "convex/values";
import { mutation } from "../../_generated/server";
import {
  acceleratedAnswerWindowSeconds,
  acceleratedRatingWindowSeconds,
} from "../constants";
import { requireOrCreatePlayer } from "../helpers/authPlayer";
import { requireServerForPlayerByCode } from "../helpers/lobby";
import {
  advanceRoundPhase,
  ensureCurrentQuestion,
  nowInSeconds,
  schedulePhaseAdvance,
} from "../helpers/roundLifecycle";
import {
  clampAndValidateStars,
  responseIsFullyRated,
  sanitizeQuestion,
} from "../helpers/validation";

export const submitResponse = mutation({
  args: {
    code: v.number(),
    answer: v.string(),
  },
  handler: async (ctx, args) => {
    const player = await requireOrCreatePlayer(ctx);
    const server = await requireServerForPlayerByCode(ctx, player, args.code);

    if (server.gameState !== "PLAY") {
      throw new Error("This game is not currently in play mode.");
    }

    if (
      server.phase !== "ANSWERING" ||
      typeof server.phaseEndsAtSec !== "number" ||
      !server.currentQuestion
    ) {
      throw new Error("The answer window is currently closed.");
    }

    const nowSec = nowInSeconds();

    if (nowSec >= server.phaseEndsAtSec) {
      throw new Error("The answer timer for this question has ended.");
    }

    const question = await ensureCurrentQuestion(ctx, server, "Play state");

    if (question.player === player._id) {
      throw new Error("You cannot answer your own question.");
    }

    const sanitizedAnswer = sanitizeQuestion(args.answer, "Answer");
    const maybeAccelerateAnswerWindow = async () => {
      if (
        typeof server.phaseNonce !== "number" ||
        typeof server.phaseEndsAtSec !== "number"
      ) {
        return;
      }

      const remainingSec = server.phaseEndsAtSec - nowSec;

      if (remainingSec <= acceleratedAnswerWindowSeconds) {
        return;
      }

      const playersInLobby = await ctx.db
        .query("players")
        .withIndex("by_in_server", (q) => q.eq("inServer", server._id))
        .collect();
      const expectedResponseCount = playersInLobby.filter(
        (candidate) => candidate._id !== question.player,
      ).length;

      if (expectedResponseCount < 1) {
        return;
      }

      const responses = await ctx.db
        .query("responses")
        .withIndex("by_question", (q) => q.eq("question", question._id))
        .collect();
      const submittedResponseCount = responses.filter(
        (response) => response.responder !== question.player,
      ).length;

      if (submittedResponseCount < expectedResponseCount) {
        return;
      }

      await ctx.db.patch(server._id, {
        phaseEndsAtSec: nowSec + acceleratedAnswerWindowSeconds,
      });
      await schedulePhaseAdvance(
        ctx,
        server._id,
        server.phaseNonce,
        acceleratedAnswerWindowSeconds,
      );
    };

    const existing = await ctx.db
      .query("responses")
      .withIndex("by_question_responder", (q) =>
        q.eq("question", question._id).eq("responder", player._id),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        answer: sanitizedAnswer,
        updatedAtSec: nowSec,
      });
      await maybeAccelerateAnswerWindow();

      return {
        submitted: true,
        updatedAtSec: nowSec,
      };
    }

    await ctx.db.insert("responses", {
      server: server._id,
      question: question._id,
      responder: player._id,
      answer: sanitizedAnswer,
      submittedAtSec: nowSec,
      updatedAtSec: nowSec,
    });
    await maybeAccelerateAnswerWindow();

    return {
      submitted: true,
      updatedAtSec: nowSec,
    };
  },
});

export const rateResponse = mutation({
  args: {
    code: v.number(),
    responseId: v.id("responses"),
    correctnessStars: v.number(),
    creativityStars: v.number(),
  },
  handler: async (ctx, args) => {
    const player = await requireOrCreatePlayer(ctx);
    const server = await requireServerForPlayerByCode(ctx, player, args.code);

    if (server.gameState !== "PLAY") {
      throw new Error("This game is not currently in play mode.");
    }

    if (
      server.phase !== "RATING" ||
      typeof server.phaseEndsAtSec !== "number" ||
      !server.currentQuestion
    ) {
      throw new Error("Ratings are not open right now.");
    }

    const nowSec = nowInSeconds();

    if (nowSec >= server.phaseEndsAtSec) {
      throw new Error("The rating timer for this question has ended.");
    }

    const question = await ensureCurrentQuestion(ctx, server, "Play state");

    if (question.player !== player._id) {
      throw new Error("Only the question owner can submit ratings.");
    }

    const response = await ctx.db.get(args.responseId);

    if (
      !response ||
      response.server !== server._id ||
      response.question !== question._id
    ) {
      throw new Error("This response is not part of the active question.");
    }

    const correctnessStars = clampAndValidateStars(args.correctnessStars);
    const creativityStars = clampAndValidateStars(args.creativityStars);
    const maybeAccelerateRatingWindow = async () => {
      if (
        typeof server.phaseNonce !== "number" ||
        typeof server.phaseEndsAtSec !== "number"
      ) {
        return;
      }

      const remainingSec = server.phaseEndsAtSec - nowSec;

      if (remainingSec <= acceleratedRatingWindowSeconds) {
        return;
      }

      const responses = await ctx.db
        .query("responses")
        .withIndex("by_question", (q) => q.eq("question", question._id))
        .collect();

      if (responses.length < 1 || !responses.every(responseIsFullyRated)) {
        return;
      }

      await ctx.db.patch(server._id, {
        phaseEndsAtSec: nowSec + acceleratedRatingWindowSeconds,
      });
      await schedulePhaseAdvance(
        ctx,
        server._id,
        server.phaseNonce,
        acceleratedRatingWindowSeconds,
      );
    };

    await ctx.db.patch(response._id, {
      correctnessStars,
      creativityStars,
      ratedAtSec: nowSec,
    });
    await maybeAccelerateRatingWindow();

    return {
      rated: true,
    };
  },
});

export const goToNextQuestionEarly = mutation({
  args: {
    code: v.number(),
  },
  handler: async (ctx, args) => {
    const player = await requireOrCreatePlayer(ctx);
    const server = await requireServerForPlayerByCode(ctx, player, args.code);

    if (server.gameState !== "PLAY") {
      throw new Error("This game is not currently in play mode.");
    }

    if (!server.phase || typeof server.phaseNonce !== "number") {
      throw new Error("Round state is not ready for skipping.");
    }

    const isHost = server.hostPlayer === player._id;

    if (!isHost) {
      if (server.phase !== "RATING") {
        throw new Error("Only the host can skip before ratings start.");
      }

      const question = await ensureCurrentQuestion(ctx, server, "Play state");

      if (question.player !== player._id) {
        throw new Error(
          "Only the rating player can skip early after ratings are complete.",
        );
      }

      const responses = await ctx.db
        .query("responses")
        .withIndex("by_question", (q) => q.eq("question", question._id))
        .collect();

      const allSubmittedResponsesRated = responses.every(responseIsFullyRated);

      if (!allSubmittedResponsesRated) {
        throw new Error(
          "Rate every submitted response before moving to the next question.",
        );
      }
    }

    return await advanceRoundPhase(ctx, server._id, server.phaseNonce);
  },
});
