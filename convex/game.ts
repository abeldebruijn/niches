import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from "./_generated/server";
import { normalizeUsername } from "./username";

const difficultyValidator = v.union(
  v.literal("easy"),
  v.literal("medium"),
  v.literal("hard"),
);

type Difficulty = "easy" | "medium" | "hard";
type RoundPhase = "ANSWERING" | "RATING";
type QuestionDifficulty = "EASY" | "MEDIUM" | "HARD";

const difficultyToField: Record<Difficulty, keyof Doc<"players">> = {
  easy: "easyQuestion",
  medium: "mediumQuestion",
  hard: "hardQuestion",
};

const minTimerSeconds = 15;
const maxTimerSeconds = 300;
const minStars = 0;
const maxStars = 5;
const acceleratedAnswerWindowSeconds = 10;
const acceleratedRatingWindowSeconds = 10;

function nowInSeconds() {
  return Math.floor(Date.now() / 1000);
}

function assertValidLobbyCode(code: number) {
  if (!Number.isInteger(code) || code < 100000 || code > 999999) {
    throw new Error("Lobby code must be a 6-digit number.");
  }
}

function sanitizeQuestion(value: string, label: string) {
  const trimmed = value.trim();

  if (trimmed.length < 1) {
    throw new Error(`${label} must be at least 1 character long.`);
  }

  return trimmed;
}

function clampAndValidateStars(raw: number) {
  if (!Number.isFinite(raw)) {
    throw new Error("Star rating must be a number.");
  }

  const rounded = Math.round(raw);

  if (rounded < minStars || rounded > maxStars) {
    throw new Error("Star rating must be between 0 and 5.");
  }

  return rounded;
}

function normalizeStoredStars(raw: number | undefined) {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return 0;
  }

  return Math.max(minStars, Math.min(maxStars, Math.round(raw)));
}

function responseIsFullyRated(response: Doc<"responses">) {
  return (
    typeof response.correctnessStars === "number" &&
    typeof response.creativityStars === "number"
  );
}

function shuffleInPlace<T>(values: T[]) {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [values[index], values[randomIndex]] = [values[randomIndex], values[index]];
  }

  return values;
}

async function requireUserId(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);

  if (!userId) {
    throw new Error("Not authenticated.");
  }

  return userId;
}

async function getPlayerByUserId(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
) {
  return await ctx.db
    .query("players")
    .withIndex("by_userid", (q) => q.eq("userid", userId))
    .unique();
}

function fallbackUsername(userId: Id<"users">) {
  const suffix = userId.slice(-4).replace(/[^a-zA-Z0-9]/g, "");
  return `Player${suffix || "0000"}`;
}

function coerceUsername(value: unknown, fallback: string) {
  try {
    return normalizeUsername(value);
  } catch {
    return fallback;
  }
}

async function requireOrCreatePlayer(ctx: MutationCtx) {
  const userId = await requireUserId(ctx);
  const existing = await getPlayerByUserId(ctx, userId);

  if (existing) {
    return existing;
  }

  const user = await ctx.db.get(userId);

  if (!user) {
    throw new Error("Authenticated user was not found.");
  }

  const username = coerceUsername(user.name, fallbackUsername(userId));
  const playerId = await ctx.db.insert("players", {
    username,
    userid: userId,
    score: 0,
  });

  const player = await ctx.db.get(playerId);

  if (!player) {
    throw new Error("Failed to create player profile.");
  }

  return player;
}

async function requirePlayerForQuery(ctx: QueryCtx) {
  const userId = await requireUserId(ctx);
  const player = await getPlayerByUserId(ctx, userId);

  if (!player) {
    return null;
  }

  return player;
}

async function requireLobbyForPlayer(ctx: MutationCtx, player: Doc<"players">) {
  if (!player.inServer) {
    throw new Error("Join or create a lobby first.");
  }

  const server = await ctx.db.get(player.inServer);

  if (!server) {
    throw new Error("Lobby no longer exists.");
  }

  return server;
}

async function requireServerForPlayerByCode(
  ctx: MutationCtx,
  player: Doc<"players">,
  code: number,
) {
  assertValidLobbyCode(code);

  const server = await ctx.db
    .query("servers")
    .withIndex("by_code", (q) => q.eq("code", code))
    .unique();

  if (!server || !player.inServer || server._id !== player.inServer) {
    throw new Error("You are not currently in this lobby.");
  }

  return server;
}

async function generateUniqueLobbyCode(ctx: MutationCtx) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const code = Math.floor(100000 + Math.random() * 900000);
    const existing = await ctx.db
      .query("servers")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();

    if (!existing) {
      return code;
    }
  }

  throw new Error("Could not allocate a unique lobby code. Try again.");
}

function questionDurationSeconds(phase: RoundPhase, timePerQuestion: number) {
  return phase === "RATING" ? timePerQuestion * 2 : timePerQuestion;
}

async function schedulePhaseAdvance(
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

async function ensureCurrentQuestion(
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

async function startAnsweringPhase(
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

async function startRatingPhase(
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

async function finalizeRatingPhase(
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

async function advanceRoundPhase(
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

export const ensurePlayer = mutation({
  args: {
    username: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const existing = await getPlayerByUserId(ctx, userId);
    const user = await ctx.db.get(userId);

    if (!user) {
      throw new Error("Authenticated user was not found.");
    }

    const fallback = fallbackUsername(userId);

    if (!existing) {
      const username = coerceUsername(args.username ?? user.name, fallback);
      const playerId = await ctx.db.insert("players", {
        username,
        userid: userId,
        score: 0,
      });

      return {
        playerId,
        username,
      };
    }

    if (args.username) {
      const username = normalizeUsername(args.username);

      if (username !== existing.username) {
        await ctx.db.patch(existing._id, {
          username,
        });
      }

      return {
        playerId: existing._id,
        username,
      };
    }

    return {
      playerId: existing._id,
      username: existing.username,
    };
  },
});

export const createLobby = mutation({
  args: {},
  handler: async (ctx) => {
    const player = await requireOrCreatePlayer(ctx);

    if (player.inServer) {
      const existingServer = await ctx.db.get(player.inServer);

      if (
        existingServer &&
        existingServer.hostPlayer === player._id &&
        existingServer.gameState === "CREATE_QUESTIONS"
      ) {
        return { code: existingServer.code };
      }
    }

    const code = await generateUniqueLobbyCode(ctx);
    const serverId = await ctx.db.insert("servers", {
      code,
      hostPlayer: player._id,
      gameState: "CREATE_QUESTIONS",
      timePerQuestion: 60,
    });

    await ctx.db.patch(player._id, {
      inServer: serverId,
      score: 0,
      easyQuestion: undefined,
      mediumQuestion: undefined,
      hardQuestion: undefined,
    });

    return { code };
  },
});

export const joinLobby = mutation({
  args: {
    code: v.number(),
  },
  handler: async (ctx, args) => {
    assertValidLobbyCode(args.code);

    const player = await requireOrCreatePlayer(ctx);
    const server = await ctx.db
      .query("servers")
      .withIndex("by_code", (q) => q.eq("code", args.code))
      .unique();

    if (!server) {
      throw new Error("Lobby not found.");
    }

    if (server.gameState !== "CREATE_QUESTIONS") {
      throw new Error("This lobby already started the game.");
    }

    if (player.inServer === server._id) {
      return { code: server.code };
    }

    await ctx.db.patch(player._id, {
      inServer: server._id,
      score: 0,
      easyQuestion: undefined,
      mediumQuestion: undefined,
      hardQuestion: undefined,
    });

    return { code: server.code };
  },
});

export const updateTimePerQuestion = mutation({
  args: {
    seconds: v.number(),
  },
  handler: async (ctx, args) => {
    const clampedSeconds = Math.max(
      minTimerSeconds,
      Math.min(maxTimerSeconds, Math.round(args.seconds)),
    );
    const player = await requireOrCreatePlayer(ctx);
    const server = await requireLobbyForPlayer(ctx, player);

    if (server.hostPlayer !== player._id) {
      throw new Error("Only the host can update the timer.");
    }

    if (server.gameState !== "CREATE_QUESTIONS") {
      throw new Error("Timer can only be edited before the game starts.");
    }

    await ctx.db.patch(server._id, {
      timePerQuestion: clampedSeconds,
    });

    return { seconds: clampedSeconds };
  },
});

export const kickPlayer = mutation({
  args: {
    targetPlayerId: v.id("players"),
  },
  handler: async (ctx, args) => {
    const player = await requireOrCreatePlayer(ctx);
    const server = await requireLobbyForPlayer(ctx, player);

    if (server.hostPlayer !== player._id) {
      throw new Error("Only the host can remove players.");
    }

    if (server.gameState !== "CREATE_QUESTIONS") {
      throw new Error("Players can only be removed before the game starts.");
    }

    if (args.targetPlayerId === player._id) {
      throw new Error("Host cannot remove themselves.");
    }

    const targetPlayer = await ctx.db.get(args.targetPlayerId);

    if (!targetPlayer || targetPlayer.inServer !== server._id) {
      throw new Error("Player is no longer in your lobby.");
    }

    if (targetPlayer._id === server.hostPlayer) {
      throw new Error("Host cannot be removed from the lobby.");
    }

    await ctx.db.patch(targetPlayer._id, {
      inServer: undefined,
      score: 0,
      easyQuestion: undefined,
      mediumQuestion: undefined,
      hardQuestion: undefined,
    });

    return { removed: true };
  },
});

export const leaveServer = mutation({
  args: {},
  handler: async (ctx) => {
    const player = await requireOrCreatePlayer(ctx);

    if (!player.inServer) {
      return { left: false };
    }

    const serverId = player.inServer;
    const server = await ctx.db.get(serverId);

    await ctx.db.patch(player._id, {
      inServer: undefined,
    });

    if (server && server.hostPlayer === player._id) {
      const remainingPlayers = await ctx.db
        .query("players")
        .withIndex("by_in_server", (q) => q.eq("inServer", serverId))
        .collect();

      if (remainingPlayers.length > 0) {
        const [nextHost] = remainingPlayers.sort((a, b) =>
          a.username.localeCompare(b.username),
        );

        await ctx.db.patch(server._id, {
          hostPlayer: nextHost._id,
        });
      }
    }

    return { left: true };
  },
});

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

    const orderedQuestions = [...easy, ...medium, ...hard];

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

export const advancePhaseOnTimer = internalMutation({
  args: {
    serverId: v.id("servers"),
    expectedNonce: v.number(),
  },
  handler: async (ctx, args) => {
    return await advanceRoundPhase(ctx, args.serverId, args.expectedNonce);
  },
});

export const viewerHome = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);

    if (!userId) {
      return null;
    }

    const player = await getPlayerByUserId(ctx, userId);

    if (!player) {
      return {
        username: null,
        activeServer: null,
      };
    }

    if (!player.inServer) {
      return {
        username: player.username,
        activeServer: null,
      };
    }

    const server = await ctx.db.get(player.inServer);

    if (!server) {
      return {
        username: player.username,
        activeServer: null,
      };
    }

    return {
      username: player.username,
      activeServer: {
        code: server.code,
        gameState: server.gameState,
        isHost: server.hostPlayer === player._id,
      },
    };
  },
});

export const currentLobby = query({
  args: {},
  handler: async (ctx) => {
    const player = await requirePlayerForQuery(ctx);

    if (!player || !player.inServer) {
      return null;
    }

    const server = await ctx.db.get(player.inServer);

    if (!server) {
      return null;
    }

    const playersInLobby = await ctx.db
      .query("players")
      .withIndex("by_in_server", (q) => q.eq("inServer", server._id))
      .collect();

    const easy = player.easyQuestion
      ? await ctx.db.get(player.easyQuestion)
      : null;
    const medium = player.mediumQuestion
      ? await ctx.db.get(player.mediumQuestion)
      : null;
    const hard = player.hardQuestion
      ? await ctx.db.get(player.hardQuestion)
      : null;

    const everyoneReady = playersInLobby.filter(
      (candidate) =>
        !!candidate.easyQuestion &&
        !!candidate.mediumQuestion &&
        !!candidate.hardQuestion,
    );

    return {
      code: server.code,
      gameState: server.gameState,
      timePerQuestion: server.timePerQuestion,
      isHost: server.hostPlayer === player._id,
      canStart:
        server.hostPlayer === player._id &&
        playersInLobby.length >= 2 &&
        everyoneReady.length >= 2,
      players: playersInLobby
        .sort((a, b) => a.username.localeCompare(b.username))
        .map((candidate) => ({
          id: candidate._id,
          username: candidate.username,
          score: candidate.score,
          isHost: candidate._id === server.hostPlayer,
          hasEasy: !!candidate.easyQuestion,
          hasMedium: !!candidate.mediumQuestion,
          hasHard: !!candidate.hardQuestion,
          isYou: candidate._id === player._id,
        })),
      viewer: {
        username: player.username,
        score: player.score,
      },
      viewerQuestions: {
        easy: easy ? { query: easy.query, answer: easy.answer } : null,
        medium: medium ? { query: medium.query, answer: medium.answer } : null,
        hard: hard ? { query: hard.query, answer: hard.answer } : null,
      },
    };
  },
});

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
      latestAnswerFeedback: null as {
        questionId: Id<"questions">;
        correctnessStars: number;
        creativityStars: number;
        correctAnswer: string;
        yourAnswer: string;
      } | null,
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
    let latestAnswerFeedback = base.latestAnswerFeedback;

    if (
      typeof server.questionCursor === "number" &&
      server.questionCursor > 0 &&
      Array.isArray(server.questionOrder)
    ) {
      const previousQuestionId =
        server.questionOrder[server.questionCursor - 1];

      if (previousQuestionId) {
        const previousQuestion = await ctx.db.get(previousQuestionId);

        if (previousQuestion) {
          const previousResponse = await ctx.db
            .query("responses")
            .withIndex("by_question_responder", (q) =>
              q
                .eq("question", previousQuestion._id)
                .eq("responder", player._id),
            )
            .unique();

          if (previousResponse && responseIsFullyRated(previousResponse)) {
            latestAnswerFeedback = {
              questionId: previousQuestion._id,
              correctnessStars: normalizeStoredStars(
                previousResponse.correctnessStars,
              ),
              creativityStars: normalizeStoredStars(
                previousResponse.creativityStars,
              ),
              correctAnswer: previousQuestion.answer,
              yourAnswer: previousResponse.answer,
            };
          }
        }
      }
    }

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
      latestAnswerFeedback,
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

export const endScreen = query({
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

    if (!server || !player.inServer || player.inServer !== server._id) {
      return null;
    }

    const playersInLobby = await ctx.db
      .query("players")
      .withIndex("by_in_server", (q) => q.eq("inServer", server._id))
      .collect();

    const standings = playersInLobby
      .sort((a, b) => b.score - a.score || a.username.localeCompare(b.username))
      .map((entry, index) => ({
        id: entry._id,
        rank: index + 1,
        username: entry.username,
        score: entry.score,
        isHost: entry._id === server.hostPlayer,
        isYou: entry._id === player._id,
      }));

    const bestScore = standings[0]?.score;
    const winnerIds =
      typeof bestScore === "number"
        ? standings
            .filter((entry) => entry.score === bestScore)
            .map((entry) => entry.id)
        : [];

    return {
      code: server.code,
      gameState: server.gameState,
      yourScore: player.score,
      isHost: server.hostPlayer === player._id,
      standings,
      winners: standings.filter((entry) => winnerIds.includes(entry.id)),
    };
  },
});
