import { describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import {
  createConvexTest,
  createQuestionDirect,
  createResponseDirect,
  ensureAuthedPlayer,
  getServer,
  getServerByCode,
} from "./_testUtils";

async function setupInternalFixture() {
  const t = createConvexTest();
  const host = await ensureAuthedPlayer(t, "Host Name", "HostUser");
  const responder = await ensureAuthedPlayer(
    t,
    "Responder Name",
    "ResponderUser",
  );
  const { code } = await host.client.mutation(api.game.createLobby, {});
  await responder.client.mutation(api.game.joinLobby, { code });

  const server = await getServerByCode(t, code);
  if (!server) {
    throw new Error("Expected server to exist.");
  }

  const questionId = await createQuestionDirect(t, {
    query: "Question 1",
    answer: "Answer 1",
    player: host.playerId,
    server: server._id,
    difficulty: "EASY",
    isAnswered: false,
  });

  const nowSec = Math.floor(Date.now() / 1000);
  await t.run(async (ctx) => {
    await ctx.db.patch(server._id, {
      gameState: "PLAY",
      currentQuestion: questionId,
      questionOrder: [questionId],
      questionCursor: 0,
      phase: "ANSWERING",
      phaseStartedAtSec: nowSec - 1,
      phaseEndsAtSec: nowSec + 60,
      phaseNonce: 1,
    });
  });

  return { t, host, responder, serverId: server._id, questionId };
}

describe("internal advancePhaseOnTimer", () => {
  test("returns not_in_play for non-play servers", async () => {
    const { t, serverId } = await setupInternalFixture();

    await t.run(async (ctx) => {
      await ctx.db.patch(serverId, {
        gameState: "CREATE_QUESTIONS",
      });
    });

    const result = await t.mutation(internal.game.advancePhaseOnTimer, {
      serverId,
      expectedNonce: 1,
    });

    expect(result).toEqual({
      advanced: false,
      reason: "not_in_play",
    });
  });

  test("returns stale_nonce when nonce does not match", async () => {
    const { t, serverId } = await setupInternalFixture();

    const result = await t.mutation(internal.game.advancePhaseOnTimer, {
      serverId,
      expectedNonce: 999,
    });

    expect(result).toEqual({
      advanced: false,
      reason: "stale_nonce",
    });
  });

  test("returns missing_phase_state when phase data is incomplete", async () => {
    const { t, serverId } = await setupInternalFixture();

    await t.run(async (ctx) => {
      await ctx.db.patch(serverId, {
        phase: undefined,
      });
    });

    const result = await t.mutation(internal.game.advancePhaseOnTimer, {
      serverId,
      expectedNonce: 1,
    });

    expect(result).toEqual({
      advanced: false,
      reason: "missing_phase_state",
    });
  });

  test("moves to END_SCREEN when current question document is missing", async () => {
    const { t, serverId, questionId } = await setupInternalFixture();

    await t.run(async (ctx) => {
      await ctx.db.delete(questionId);
    });

    const result = await t.mutation(internal.game.advancePhaseOnTimer, {
      serverId,
      expectedNonce: 1,
    });
    const server = await getServer(t, serverId);

    expect(result).toEqual({
      advanced: false,
      reason: "missing_question",
    });
    expect(server?.gameState).toBe("END_SCREEN");
    expect(server?.phase).toBeUndefined();
  });

  test("transitions ANSWERING to RATING", async () => {
    const { t, serverId } = await setupInternalFixture();

    const result = await t.mutation(internal.game.advancePhaseOnTimer, {
      serverId,
      expectedNonce: 1,
    });
    const server = await getServer(t, serverId);

    expect(result).toEqual({
      advanced: true,
      phase: "RATING",
    });
    expect(server?.phase).toBe("RATING");
    expect(server?.phaseNonce).toBe(2);
  });

  test("finalizes RATING, normalizes stars, and awards points", async () => {
    const { t, serverId, questionId, responder } = await setupInternalFixture();
    const responseId = await createResponseDirect(t, {
      server: serverId,
      question: questionId,
      responder: responder.playerId,
      answer: "Guess",
      submittedAtSec: Math.floor(Date.now() / 1000) - 20,
      updatedAtSec: Math.floor(Date.now() / 1000) - 20,
      correctnessStars: 4.2,
      creativityStars: undefined,
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(serverId, {
        phase: "RATING",
        phaseNonce: 2,
      });
    });

    const result = await t.mutation(internal.game.advancePhaseOnTimer, {
      serverId,
      expectedNonce: 2,
    });
    const response = await t.run(async (ctx) => ctx.db.get(responseId));
    const question = await t.run(async (ctx) => ctx.db.get(questionId));
    const responderAfter = await t.run(async (ctx) =>
      ctx.db.get(responder.playerId),
    );

    expect(result).toEqual({
      advanced: true,
      phase: "ANSWERING_OR_END",
    });
    expect(response?.correctnessStars).toBe(4);
    expect(response?.creativityStars).toBe(0);
    expect(response?.ratedAtSec).toBeTypeOf("number");
    expect(question?.isAnswered).toBe(true);
    expect(responderAfter?.score).toBe(4);
  });

  test("does not award points to responders not in lobby", async () => {
    const { t, serverId, questionId, responder } = await setupInternalFixture();
    await createResponseDirect(t, {
      server: serverId,
      question: questionId,
      responder: responder.playerId,
      answer: "Guess",
      submittedAtSec: Math.floor(Date.now() / 1000) - 20,
      updatedAtSec: Math.floor(Date.now() / 1000) - 20,
      correctnessStars: 5,
      creativityStars: 5,
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(responder.playerId, {
        inServer: undefined,
      });
      await ctx.db.patch(serverId, {
        phase: "RATING",
        phaseNonce: 2,
      });
    });

    await t.mutation(internal.game.advancePhaseOnTimer, {
      serverId,
      expectedNonce: 2,
    });
    const responderAfter = await t.run(async (ctx) =>
      ctx.db.get(responder.playerId),
    );

    expect(responderAfter?.score).toBe(0);
  });

  test("moves to END_SCREEN when finishing final question", async () => {
    const { t, serverId, questionId, responder } = await setupInternalFixture();
    await createResponseDirect(t, {
      server: serverId,
      question: questionId,
      responder: responder.playerId,
      answer: "Guess",
      submittedAtSec: Math.floor(Date.now() / 1000) - 20,
      updatedAtSec: Math.floor(Date.now() / 1000) - 20,
      correctnessStars: 3,
      creativityStars: 3,
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(serverId, {
        phase: "RATING",
        phaseNonce: 2,
        questionOrder: [questionId],
        questionCursor: 0,
      });
    });

    await t.mutation(internal.game.advancePhaseOnTimer, {
      serverId,
      expectedNonce: 2,
    });
    const server = await getServer(t, serverId);

    expect(server?.gameState).toBe("END_SCREEN");
    expect(server?.currentQuestion).toBeUndefined();
  });

  test("moves to next question when not on final question", async () => {
    const { t, serverId, questionId, responder, host } =
      await setupInternalFixture();
    const secondQuestionId = await createQuestionDirect(t, {
      query: "Question 2",
      answer: "Answer 2",
      player: host.playerId,
      server: serverId,
      difficulty: "MEDIUM",
      isAnswered: false,
    });

    await createResponseDirect(t, {
      server: serverId,
      question: questionId,
      responder: responder.playerId,
      answer: "Guess",
      submittedAtSec: Math.floor(Date.now() / 1000) - 20,
      updatedAtSec: Math.floor(Date.now() / 1000) - 20,
      correctnessStars: 2,
      creativityStars: 2,
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(serverId, {
        phase: "RATING",
        phaseNonce: 2,
        questionOrder: [questionId, secondQuestionId],
        questionCursor: 0,
      });
    });

    await t.mutation(internal.game.advancePhaseOnTimer, {
      serverId,
      expectedNonce: 2,
    });
    const server = await getServer(t, serverId);

    expect(server?.gameState).toBe("PLAY");
    expect(server?.phase).toBe("ANSWERING");
    expect(server?.currentQuestion).toBe(secondQuestionId);
    expect(server?.questionCursor).toBe(1);
  });
});
