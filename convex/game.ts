import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { mutation, MutationCtx, query, QueryCtx } from "./_generated/server";
import { normalizeUsername } from "./username";

const difficultyValidator = v.union(
  v.literal("easy"),
  v.literal("medium"),
  v.literal("hard"),
);

type Difficulty = "easy" | "medium" | "hard";

const difficultyToField: Record<Difficulty, keyof Doc<"players">> = {
  easy: "easyQuestion",
  medium: "mediumQuestion",
  hard: "hardQuestion",
};

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

async function requireLobbyForPlayer(
  ctx: MutationCtx,
  player: Doc<"players">,
) {
  if (!player.inServer) {
    throw new Error("Join or create a lobby first.");
  }

  const server = await ctx.db.get(player.inServer);

  if (!server) {
    throw new Error("Lobby no longer exists.");
  }

  return server;
}

function sanitizeQuestion(value: string, label: string) {
  const trimmed = value.trim();

  if (trimmed.length < 3) {
    throw new Error(`${label} must be at least 3 characters.`);
  }

  return trimmed;
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
    if (!Number.isInteger(args.code) || args.code < 100000 || args.code > 999999) {
      throw new Error("Lobby code must be a 6-digit number.");
    }

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
    const clampedSeconds = Math.max(15, Math.min(300, Math.round(args.seconds)));
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
        !candidate.easyQuestion || !candidate.mediumQuestion || !candidate.hardQuestion,
    );

    if (missingQuestions) {
      throw new Error(
        `${missingQuestions.username} still needs all 3 questions filled in.`,
      );
    }

    await ctx.db.patch(server._id, {
      gameState: "PLAY",
    });

    return { code: server.code };
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

    const easy = player.easyQuestion ? await ctx.db.get(player.easyQuestion) : null;
    const medium = player.mediumQuestion
      ? await ctx.db.get(player.mediumQuestion)
      : null;
    const hard = player.hardQuestion ? await ctx.db.get(player.hardQuestion) : null;

    const everyoneReady = playersInLobby.every(
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
        everyoneReady,
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

    return {
      code: server.code,
      gameState: server.gameState,
      yourScore: player.score,
      yourUsername: player.username,
      players: playersInLobby
        .sort((a, b) => b.score - a.score || a.username.localeCompare(b.username))
        .map((candidate) => ({
          id: candidate._id,
          username: candidate.username,
          score: candidate.score,
          isHost: candidate._id === server.hostPlayer,
        })),
    };
  },
});
