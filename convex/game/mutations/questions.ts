import { v } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import { mutation } from "../../_generated/server";
import {
  difficultyToField,
  difficultyValidator,
  minQuestionCount,
} from "../constants";
import { requireOrCreatePlayer } from "../helpers/authPlayer";
import { shuffleInPlace } from "../helpers/collections";
import { requireLobbyForPlayer } from "../helpers/lobby";
import {
  nowInSeconds,
  questionDurationSeconds,
  schedulePhaseAdvance,
} from "../helpers/roundLifecycle";
import {
  computeEffectiveMaxQuestions,
  sanitizeQuestion,
} from "../helpers/validation";
import type { QuestionDifficulty } from "../types";

function buildBalancedQuestionOrder(
  pools: Record<QuestionDifficulty, Id<"questions">[]>,
  limit: number,
) {
  const selectedCountByDifficulty: Record<QuestionDifficulty, number> = {
    EASY: 0,
    MEDIUM: 0,
    HARD: 0,
  };
  const order: Id<"questions">[] = [];

  while (order.length < limit) {
    const difficultiesWithRemaining = (
      Object.entries(pools) as [QuestionDifficulty, Id<"questions">[]][]
    ).filter(([, questionIds]) => questionIds.length > 0);

    if (difficultiesWithRemaining.length < 1) {
      break;
    }

    const minimumSelectedCount = Math.min(
      ...difficultiesWithRemaining.map(
        ([difficulty]) => selectedCountByDifficulty[difficulty],
      ),
    );
    const balancedCandidates = difficultiesWithRemaining.filter(
      ([difficulty]) =>
        selectedCountByDifficulty[difficulty] === minimumSelectedCount,
    );
    const [pickedDifficulty] = balancedCandidates.sort(
      ([leftDifficulty, leftPool], [rightDifficulty, rightPool]) => {
        const remainingDifference = rightPool.length - leftPool.length;

        if (remainingDifference !== 0) {
          return remainingDifference;
        }

        return leftDifficulty.localeCompare(rightDifficulty);
      },
    )[0];

    const nextQuestionId = pools[pickedDifficulty].shift();

    if (!nextQuestionId) {
      continue;
    }

    selectedCountByDifficulty[pickedDifficulty] += 1;
    order.push(nextQuestionId);
  }

  return order;
}

export const saveQuestion = mutation({
  args: {
    difficulty: difficultyValidator,
    query: v.string(),
    answer: v.string(),
  },
  handler: async (ctx, args) => {
    const player = await requireOrCreatePlayer(ctx);
    const server = await requireLobbyForPlayer(ctx, player);

    if (server.gameState !== "CREATE_QUESTIONS") {
      throw new Error("Questions can only be edited before the game starts.");
    }

    const prompt = sanitizeQuestion(args.query, "Question");
    const answer = sanitizeQuestion(args.answer, "Answer");
    const field = difficultyToField[args.difficulty];
    const existingQuestionId = player[field] as Id<"questions"> | undefined;

    let questionId = existingQuestionId;

    if (questionId) {
      const existing = await ctx.db.get(questionId);

      if (existing) {
        await ctx.db.patch(questionId, {
          query: prompt,
          answer,
          isAnswered: false,
        });
      } else {
        questionId = undefined;
      }
    }

    if (!questionId) {
      questionId = await ctx.db.insert("questions", {
        query: prompt,
        answer,
        player: player._id,
        isAnswered: false,
        difficulty: args.difficulty.toUpperCase() as QuestionDifficulty,
        server: server._id,
      });
    }

    await ctx.db.patch(player._id, {
      [field]: questionId,
    } as Partial<Doc<"players">>);

    return { saved: true };
  },
});

export const startGame = mutation({
  args: {},
  handler: async (ctx) => {
    const player = await requireOrCreatePlayer(ctx);
    const server = await requireLobbyForPlayer(ctx, player);

    if (server.hostPlayer !== player._id) {
      throw new Error("Only the host can start the game.");
    }

    if (server.gameState === "PLAY") {
      return { code: server.code };
    }

    if (server.gameState !== "CREATE_QUESTIONS") {
      throw new Error("This game can no longer be started from this screen.");
    }

    const players = await ctx.db
      .query("players")
      .withIndex("by_in_server", (q) => q.eq("inServer", server._id))
      .collect();

    if (players.length < 2) {
      throw new Error("At least 2 players are required.");
    }

    const missingQuestions = players.find(
      (candidate) =>
        !candidate.easyQuestion ||
        !candidate.mediumQuestion ||
        !candidate.hardQuestion,
    );

    if (missingQuestions) {
      throw new Error(
        `${missingQuestions.username} still needs all 3 questions filled in.`,
      );
    }

    const unresolvedQuestions = (
      await ctx.db
        .query("questions")
        .withIndex("by_server", (q) => q.eq("server", server._id))
        .collect()
    ).filter((question) => !question.isAnswered);

    if (unresolvedQuestions.length < 1) {
      throw new Error(
        "No unanswered questions are available to start this game.",
      );
    }

    const easy = shuffleInPlace(
      unresolvedQuestions
        .filter((question) => question.difficulty === "EASY")
        .map((question) => question._id),
    );
    const medium = shuffleInPlace(
      unresolvedQuestions
        .filter((question) => question.difficulty === "MEDIUM")
        .map((question) => question._id),
    );
    const hard = shuffleInPlace(
      unresolvedQuestions
        .filter((question) => question.difficulty === "HARD")
        .map((question) => question._id),
    );

    const availableQuestionCount = unresolvedQuestions.length;
    const effectiveMaxQuestions = computeEffectiveMaxQuestions(
      server.maxQuestions,
      availableQuestionCount,
    );

    if (effectiveMaxQuestions < minQuestionCount) {
      throw new Error(
        `At least ${minQuestionCount} questions are required to start the game.`,
      );
    }

    const orderedQuestions = buildBalancedQuestionOrder(
      {
        EASY: easy,
        MEDIUM: medium,
        HARD: hard,
      },
      effectiveMaxQuestions,
    );

    if (orderedQuestions.length < 1) {
      throw new Error("No valid questions were found for this game.");
    }

    const startedAtSec = nowInSeconds();
    const phaseNonce = 1;
    const endsAtSec =
      startedAtSec +
      questionDurationSeconds("ANSWERING", server.timePerQuestion);

    await ctx.db.patch(server._id, {
      gameState: "PLAY",
      questionOrder: orderedQuestions,
      questionCursor: 0,
      currentQuestion: orderedQuestions[0],
      phase: "ANSWERING",
      phaseStartedAtSec: startedAtSec,
      phaseEndsAtSec: endsAtSec,
      phaseNonce,
    });

    await schedulePhaseAdvance(
      ctx,
      server._id,
      phaseNonce,
      Math.max(0, endsAtSec - startedAtSec),
    );

    return { code: server.code };
  },
});
