import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import {
  createConvexTest,
  ensureAuthedPlayer,
  fillAllQuestions,
  getQuestion,
  getServer,
  getServerByCode,
  patchServer,
} from "./_testUtils";

async function setupReadyLobby() {
  const t = createConvexTest();
  const host = await ensureAuthedPlayer(t, "Host Name", "HostUser");
  const guest = await ensureAuthedPlayer(t, "Guest Name", "GuestUser");
  const { code } = await host.client.mutation(api.game.createLobby, {});
  await guest.client.mutation(api.game.joinLobby, { code });

  await fillAllQuestions(host.client, "host");
  await fillAllQuestions(guest.client, "guest");

  const server = await getServerByCode(t, code);
  if (!server) {
    throw new Error("Expected server to exist.");
  }

  return { t, host, guest, code, server };
}

describe("game question mutations", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test("saveQuestion only allows CREATE_QUESTIONS", async () => {
    const { t, host, server } = await setupReadyLobby();

    await patchServer(t, server._id, {
      gameState: "PLAY",
    });

    await expect(
      host.client.mutation(api.game.saveQuestion, {
        difficulty: "easy",
        query: "Q",
        answer: "A",
      }),
    ).rejects.toThrow("Questions can only be edited before the game starts.");
  });

  test("saveQuestion rejects blank query and answer", async () => {
    const t = createConvexTest();
    const host = await ensureAuthedPlayer(t, "Host Name", "HostUser");
    await host.client.mutation(api.game.createLobby, {});

    await expect(
      host.client.mutation(api.game.saveQuestion, {
        difficulty: "easy",
        query: "   ",
        answer: "ValidAnswer",
      }),
    ).rejects.toThrow("Question must be at least 1 character long.");

    await expect(
      host.client.mutation(api.game.saveQuestion, {
        difficulty: "easy",
        query: "ValidQuestion",
        answer: "   ",
      }),
    ).rejects.toThrow("Answer must be at least 1 character long.");
  });

  test("saveQuestion inserts and links a new question", async () => {
    const t = createConvexTest();
    const host = await ensureAuthedPlayer(t, "Host Name", "HostUser");
    await host.client.mutation(api.game.createLobby, {});

    await host.client.mutation(api.game.saveQuestion, {
      difficulty: "easy",
      query: "  What is my pet name?  ",
      answer: "  Luna  ",
    });
    const player = await t.run(async (ctx) => ctx.db.get(host.playerId));

    const easyQuestionId = player?.easyQuestion;
    expect(easyQuestionId).toBeDefined();
    if (!easyQuestionId) {
      throw new Error("Expected easy question id.");
    }
    const question = await getQuestion(t, easyQuestionId);
    expect(question?.query).toBe("What is my pet name?");
    expect(question?.answer).toBe("Luna");
    expect(question?.difficulty).toBe("EASY");
  });

  test("saveQuestion updates existing linked question", async () => {
    const t = createConvexTest();
    const host = await ensureAuthedPlayer(t, "Host Name", "HostUser");
    await host.client.mutation(api.game.createLobby, {});

    await host.client.mutation(api.game.saveQuestion, {
      difficulty: "medium",
      query: "Old query",
      answer: "Old answer",
    });
    const before = await t.run(async (ctx) => ctx.db.get(host.playerId));

    await host.client.mutation(api.game.saveQuestion, {
      difficulty: "medium",
      query: "New query",
      answer: "New answer",
    });
    const after = await t.run(async (ctx) => ctx.db.get(host.playerId));
    const mediumQuestionId = after?.mediumQuestion;
    expect(mediumQuestionId).toBeDefined();
    if (!mediumQuestionId) {
      throw new Error("Expected medium question id.");
    }
    const question = await getQuestion(t, mediumQuestionId);

    expect(after?.mediumQuestion).toBe(before?.mediumQuestion);
    expect(question?.query).toBe("New query");
    expect(question?.answer).toBe("New answer");
    expect(question?.isAnswered).toBe(false);
  });

  test("saveQuestion recreates linked question if referenced doc is missing", async () => {
    const t = createConvexTest();
    const host = await ensureAuthedPlayer(t, "Host Name", "HostUser");
    await host.client.mutation(api.game.createLobby, {});

    await host.client.mutation(api.game.saveQuestion, {
      difficulty: "hard",
      query: "Hard query 1",
      answer: "Hard answer 1",
    });
    const before = await t.run(async (ctx) => ctx.db.get(host.playerId));
    const hardQuestionId = before?.hardQuestion;
    if (!hardQuestionId) {
      throw new Error("Expected hard question id.");
    }
    await t.run(async (ctx) => {
      await ctx.db.delete(hardQuestionId);
    });

    await host.client.mutation(api.game.saveQuestion, {
      difficulty: "hard",
      query: "Hard query 2",
      answer: "Hard answer 2",
    });
    const after = await t.run(async (ctx) => ctx.db.get(host.playerId));

    expect(after?.hardQuestion).toBeDefined();
    expect(after?.hardQuestion).not.toBe(before?.hardQuestion);
  });

  test("startGame only allows host", async () => {
    const { guest } = await setupReadyLobby();

    await expect(guest.client.mutation(api.game.startGame, {})).rejects.toThrow(
      "Only the host can start the game.",
    );
  });

  test("startGame is idempotent once already in PLAY", async () => {
    const { host } = await setupReadyLobby();
    const first = await host.client.mutation(api.game.startGame, {});
    const second = await host.client.mutation(api.game.startGame, {});

    expect(second.code).toBe(first.code);
  });

  test("startGame rejects invalid source states", async () => {
    const { t, host, server } = await setupReadyLobby();

    await patchServer(t, server._id, {
      gameState: "END_SCREEN",
    });

    await expect(host.client.mutation(api.game.startGame, {})).rejects.toThrow(
      "This game can no longer be started from this screen.",
    );
  });

  test("startGame requires at least 2 players and all questions", async () => {
    const t = createConvexTest();
    const host = await ensureAuthedPlayer(t, "Host Name", "HostUser");
    const { code } = await host.client.mutation(api.game.createLobby, {});

    await expect(host.client.mutation(api.game.startGame, {})).rejects.toThrow(
      "At least 2 players are required.",
    );

    const guest = await ensureAuthedPlayer(t, "Guest Name", "GuestUser");
    await guest.client.mutation(api.game.joinLobby, { code });

    await fillAllQuestions(host.client, "host");
    await expect(host.client.mutation(api.game.startGame, {})).rejects.toThrow(
      "still needs all 3 questions filled in.",
    );
  });

  test("startGame rejects when no unanswered questions exist", async () => {
    const { t, host, server } = await setupReadyLobby();

    await t.run(async (ctx) => {
      const questions = await ctx.db
        .query("questions")
        .withIndex("by_server", (q) => q.eq("server", server._id))
        .collect();
      for (const question of questions) {
        await ctx.db.patch(question._id, {
          isAnswered: true,
        });
      }
    });

    await expect(host.client.mutation(api.game.startGame, {})).rejects.toThrow(
      "No unanswered questions are available to start this game.",
    );
  });

  test("startGame sets play phase fields with balanced difficulties", async () => {
    const { t, host, server } = await setupReadyLobby();

    await host.client.mutation(api.game.startGame, {});
    const updated = await getServer(t, server._id);

    expect(updated?.gameState).toBe("PLAY");
    expect(updated?.phase).toBe("ANSWERING");
    expect(updated?.phaseNonce).toBe(1);
    expect(updated?.phaseStartedAtSec).toBeTypeOf("number");
    expect(updated?.phaseEndsAtSec).toBeTypeOf("number");
    const startedAtSec = updated?.phaseStartedAtSec;
    const endsAtSec = updated?.phaseEndsAtSec;
    if (typeof startedAtSec !== "number" || typeof endsAtSec !== "number") {
      throw new Error("Expected phase timing fields to be set.");
    }
    expect(endsAtSec).toBeGreaterThan(startedAtSec);
    expect(updated?.currentQuestion).toBeDefined();
    expect(updated?.questionCursor).toBe(0);
    expect(updated?.questionOrder?.length).toBeGreaterThan(0);

    const orderedQuestions = await t.run(async (ctx) => {
      const docs = [];
      for (const questionId of updated?.questionOrder ?? []) {
        const doc = await ctx.db.get(questionId);
        if (doc) {
          docs.push(doc);
        }
      }
      return docs;
    });

    const difficultyCounts = orderedQuestions.reduce(
      (acc, question) => {
        acc[question.difficulty] += 1;
        return acc;
      },
      {
        EASY: 0,
        MEDIUM: 0,
        HARD: 0,
      },
    );
    const counts = Object.values(difficultyCounts);

    expect(updated?.questionOrder).toHaveLength(6);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  test("startGame applies configured max question count", async () => {
    const { t, host, server } = await setupReadyLobby();

    await host.client.mutation(api.game.updateMaxQuestions, {
      count: 4,
    });
    await host.client.mutation(api.game.startGame, {});

    const updated = await getServer(t, server._id);
    expect(updated?.questionOrder).toHaveLength(4);
  });

  test("startGame schedules phase advance to RATING", async () => {
    vi.useFakeTimers();
    const { t, host, server } = await setupReadyLobby();

    await host.client.mutation(api.game.startGame, {});
    vi.advanceTimersByTime(60_001);
    await t.finishInProgressScheduledFunctions();

    const updated = await getServer(t, server._id);
    expect(updated?.phase).toBe("RATING");
    expect(updated?.phaseNonce).toBe(2);
  });
});
