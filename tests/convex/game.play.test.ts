import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import {
  createConvexTest,
  createQuestionDirect,
  createResponseDirect,
  ensureAuthedPlayer,
  getServer,
  getServerByCode,
  responsesByQuestion,
} from "./_testUtils";

async function setupPlayRound(answererCount = 1) {
  const t = createConvexTest();
  const host = await ensureAuthedPlayer(t, "Host Name", "HostUser");
  const answerers = [];

  for (let index = 0; index < answererCount; index += 1) {
    const player = await ensureAuthedPlayer(
      t,
      `Guest ${index + 1}`,
      `Guest${index + 1}`,
    );
    answerers.push(player);
  }

  const { code } = await host.client.mutation(api.game.createLobby, {});
  for (const answerer of answerers) {
    await answerer.client.mutation(api.game.joinLobby, { code });
  }

  const server = await getServerByCode(t, code);
  if (!server) {
    throw new Error("Expected server to exist.");
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const questionId = await createQuestionDirect(t, {
    query: "What is my favorite color?",
    answer: "Blue",
    player: host.playerId,
    server: server._id,
    difficulty: "EASY",
    isAnswered: false,
  });

  await t.run(async (ctx) => {
    await ctx.db.patch(server._id, {
      gameState: "PLAY",
      currentQuestion: questionId,
      questionOrder: [questionId],
      questionCursor: 0,
      phase: "ANSWERING",
      phaseStartedAtSec: nowSec - 1,
      phaseEndsAtSec: nowSec + 120,
      phaseNonce: 1,
    });
  });

  return { t, host, answerers, code, serverId: server._id, questionId };
}

async function setupRatingRound(responseCount = 1) {
  const fixture = await setupPlayRound(Math.max(1, responseCount));
  const { t, answerers, questionId, serverId } = fixture;
  const nowSec = Math.floor(Date.now() / 1000);

  const responseIds = [];
  for (let index = 0; index < responseCount; index += 1) {
    const responseId = await createResponseDirect(t, {
      server: serverId,
      question: questionId,
      responder: answerers[index].playerId,
      answer: `Response ${index + 1}`,
      submittedAtSec: nowSec - 10,
      updatedAtSec: nowSec - 10,
    });
    responseIds.push(responseId);
  }

  await t.run(async (ctx) => {
    await ctx.db.patch(serverId, {
      phase: "RATING",
      phaseStartedAtSec: nowSec - 1,
      phaseEndsAtSec: nowSec + 120,
      phaseNonce: 2,
    });
  });

  return { ...fixture, responseIds };
}

describe("game play mutations", () => {
  test("submitResponse only allows PLAY state", async () => {
    const { t, answerers, code, serverId } = await setupPlayRound(1);
    await t.run(async (ctx) => {
      await ctx.db.patch(serverId, {
        gameState: "CREATE_QUESTIONS",
      });
    });

    await expect(
      answerers[0].client.mutation(api.game.submitResponse, {
        code,
        answer: "Blue",
      }),
    ).rejects.toThrow("This game is not currently in play mode.");
  });

  test("submitResponse requires active ANSWERING phase and open timer", async () => {
    const { t, answerers, code, serverId } = await setupPlayRound(1);
    const nowSec = Math.floor(Date.now() / 1000);

    await t.run(async (ctx) => {
      await ctx.db.patch(serverId, {
        phase: "RATING",
      });
    });

    await expect(
      answerers[0].client.mutation(api.game.submitResponse, {
        code,
        answer: "Blue",
      }),
    ).rejects.toThrow("The answer window is currently closed.");

    await t.run(async (ctx) => {
      await ctx.db.patch(serverId, {
        phase: "ANSWERING",
        phaseEndsAtSec: nowSec - 1,
      });
    });

    await expect(
      answerers[0].client.mutation(api.game.submitResponse, {
        code,
        answer: "Blue",
      }),
    ).rejects.toThrow("The answer timer for this question has ended.");
  });

  test("submitResponse rejects own question and blank answers", async () => {
    const { host, answerers, code } = await setupPlayRound(1);

    await expect(
      host.client.mutation(api.game.submitResponse, {
        code,
        answer: "Owner answer",
      }),
    ).rejects.toThrow("You cannot answer your own question.");

    await expect(
      answerers[0].client.mutation(api.game.submitResponse, {
        code,
        answer: "   ",
      }),
    ).rejects.toThrow("Answer must be at least 1 character long.");
  });

  test("submitResponse inserts and updates responses", async () => {
    const { t, answerers, code, questionId } = await setupPlayRound(1);

    const first = await answerers[0].client.mutation(api.game.submitResponse, {
      code,
      answer: "First",
    });
    const second = await answerers[0].client.mutation(api.game.submitResponse, {
      code,
      answer: "Second",
    });

    const responses = await responsesByQuestion(t, questionId);
    expect(first.submitted).toBe(true);
    expect(second.submitted).toBe(true);
    expect(responses).toHaveLength(1);
    expect(responses[0].answer).toBe("Second");
  });

  test("submitResponse accelerates answer window only when all required responses are in", async () => {
    const full = await setupPlayRound(1);
    const nowSec = Math.floor(Date.now() / 1000);
    await full.answerers[0].client.mutation(api.game.submitResponse, {
      code: full.code,
      answer: "Done",
    });
    const acceleratedServer = await getServer(full.t, full.serverId);

    expect(acceleratedServer?.phaseEndsAtSec).toBeLessThanOrEqual(nowSec + 10);

    const partial = await setupPlayRound(2);
    const partialBefore = await getServer(partial.t, partial.serverId);
    await partial.answerers[0].client.mutation(api.game.submitResponse, {
      code: partial.code,
      answer: "Only one answer",
    });
    const partialAfter = await getServer(partial.t, partial.serverId);

    expect(partialAfter?.phaseEndsAtSec).toBe(partialBefore?.phaseEndsAtSec);
  });

  test("rateResponse only allows PLAY and active RATING state", async () => {
    const { t, host, code, responseIds, serverId } = await setupRatingRound(1);
    const nowSec = Math.floor(Date.now() / 1000);

    await t.run(async (ctx) => {
      await ctx.db.patch(serverId, {
        gameState: "CREATE_QUESTIONS",
      });
    });

    await expect(
      host.client.mutation(api.game.rateResponse, {
        code,
        responseId: responseIds[0],
        correctnessStars: 3,
        creativityStars: 4,
      }),
    ).rejects.toThrow("This game is not currently in play mode.");

    await t.run(async (ctx) => {
      await ctx.db.patch(serverId, {
        gameState: "PLAY",
        phase: "ANSWERING",
      });
    });
    await expect(
      host.client.mutation(api.game.rateResponse, {
        code,
        responseId: responseIds[0],
        correctnessStars: 3,
        creativityStars: 4,
      }),
    ).rejects.toThrow("Ratings are not open right now.");

    await t.run(async (ctx) => {
      await ctx.db.patch(serverId, {
        phase: "RATING",
        phaseEndsAtSec: nowSec - 1,
      });
    });
    await expect(
      host.client.mutation(api.game.rateResponse, {
        code,
        responseId: responseIds[0],
        correctnessStars: 3,
        creativityStars: 4,
      }),
    ).rejects.toThrow("The rating timer for this question has ended.");
  });

  test("rateResponse enforces role and response ownership", async () => {
    const { t, host, answerers, code, responseIds, questionId, serverId } =
      await setupRatingRound(1);

    await expect(
      answerers[0].client.mutation(api.game.rateResponse, {
        code,
        responseId: responseIds[0],
        correctnessStars: 2,
        creativityStars: 2,
      }),
    ).rejects.toThrow("Only the question owner can submit ratings.");

    const invalidResponseId = await createResponseDirect(t, {
      server: serverId,
      question: questionId,
      responder: host.playerId,
      answer: "Wrong",
      submittedAtSec: Math.floor(Date.now() / 1000),
      updatedAtSec: Math.floor(Date.now() / 1000),
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(invalidResponseId, {
        server: serverId,
      });
      const otherQuestion = await ctx.db.insert("questions", {
        query: "Other",
        answer: "Other",
        player: host.playerId,
        server: serverId,
        difficulty: "MEDIUM",
        isAnswered: false,
      });
      await ctx.db.patch(invalidResponseId, {
        question: otherQuestion,
      });
    });

    await expect(
      host.client.mutation(api.game.rateResponse, {
        code,
        responseId: invalidResponseId,
        correctnessStars: 2,
        creativityStars: 2,
      }),
    ).rejects.toThrow("This response is not part of the active question.");
  });

  test("rateResponse validates stars, rounds values and stores ratings", async () => {
    const { t, host, code, responseIds } = await setupRatingRound(1);

    await expect(
      host.client.mutation(api.game.rateResponse, {
        code,
        responseId: responseIds[0],
        correctnessStars: Number.NaN,
        creativityStars: 3,
      }),
    ).rejects.toThrow("Star rating must be a number.");

    await expect(
      host.client.mutation(api.game.rateResponse, {
        code,
        responseId: responseIds[0],
        correctnessStars: 6,
        creativityStars: 3,
      }),
    ).rejects.toThrow("Star rating must be between 0 and 5.");

    await host.client.mutation(api.game.rateResponse, {
      code,
      responseId: responseIds[0],
      correctnessStars: 3.7,
      creativityStars: 1.2,
    });
    const responses = await t.run(async (ctx) => {
      return await ctx.db.get(responseIds[0]);
    });

    expect(responses?.correctnessStars).toBe(4);
    expect(responses?.creativityStars).toBe(1);
    expect(responses?.ratedAtSec).toBeTypeOf("number");
  });

  test("rateResponse accelerates rating only when all responses are fully rated", async () => {
    const full = await setupRatingRound(1);
    const nowSec = Math.floor(Date.now() / 1000);
    await full.host.client.mutation(api.game.rateResponse, {
      code: full.code,
      responseId: full.responseIds[0],
      correctnessStars: 5,
      creativityStars: 5,
    });
    const acceleratedServer = await getServer(full.t, full.serverId);
    expect(acceleratedServer?.phaseEndsAtSec).toBeLessThanOrEqual(nowSec + 10);

    const partial = await setupRatingRound(2);
    const before = await getServer(partial.t, partial.serverId);
    await partial.host.client.mutation(api.game.rateResponse, {
      code: partial.code,
      responseId: partial.responseIds[0],
      correctnessStars: 4,
      creativityStars: 4,
    });
    const after = await getServer(partial.t, partial.serverId);
    expect(after?.phaseEndsAtSec).toBe(before?.phaseEndsAtSec);
  });

  test("goToNextQuestionEarly enforces state and role constraints", async () => {
    const answering = await setupPlayRound(1);

    await answering.t.run(async (ctx) => {
      await ctx.db.patch(answering.serverId, {
        gameState: "CREATE_QUESTIONS",
      });
    });
    await expect(
      answering.host.client.mutation(api.game.goToNextQuestionEarly, {
        code: answering.code,
      }),
    ).rejects.toThrow("This game is not currently in play mode.");

    await answering.t.run(async (ctx) => {
      await ctx.db.patch(answering.serverId, {
        gameState: "PLAY",
        phase: undefined,
      });
    });
    await expect(
      answering.host.client.mutation(api.game.goToNextQuestionEarly, {
        code: answering.code,
      }),
    ).rejects.toThrow("Round state is not ready for skipping.");

    const preRating = await setupPlayRound(1);
    await expect(
      preRating.answerers[0].client.mutation(api.game.goToNextQuestionEarly, {
        code: preRating.code,
      }),
    ).rejects.toThrow("Only the host can skip before ratings start.");
  });

  test("goToNextQuestionEarly allows host skip and rating owner skip with fully rated responses", async () => {
    const hostSkip = await setupPlayRound(1);
    const hostResult = await hostSkip.host.client.mutation(
      api.game.goToNextQuestionEarly,
      {
        code: hostSkip.code,
      },
    );
    const serverAfterHostSkip = await getServer(hostSkip.t, hostSkip.serverId);

    expect(hostResult.advanced).toBe(true);
    expect(serverAfterHostSkip?.phase).toBe("RATING");

    const rating = await setupRatingRound(1);
    await expect(
      rating.answerers[0].client.mutation(api.game.goToNextQuestionEarly, {
        code: rating.code,
      }),
    ).rejects.toThrow(
      "Only the rating player can skip early after ratings are complete.",
    );

    const nonHostOwner = await setupPlayRound(1);
    const nowSec = Math.floor(Date.now() / 1000);
    const ownerQuestionId = await createQuestionDirect(nonHostOwner.t, {
      query: "Guest-owned question",
      answer: "Guest answer",
      player: nonHostOwner.answerers[0].playerId,
      server: nonHostOwner.serverId,
      difficulty: "MEDIUM",
      isAnswered: false,
    });
    const ownerResponseId = await createResponseDirect(nonHostOwner.t, {
      server: nonHostOwner.serverId,
      question: ownerQuestionId,
      responder: nonHostOwner.host.playerId,
      answer: "Host response",
      submittedAtSec: nowSec - 10,
      updatedAtSec: nowSec - 10,
    });
    await nonHostOwner.t.run(async (ctx) => {
      await ctx.db.patch(nonHostOwner.serverId, {
        phase: "RATING",
        phaseNonce: 2,
        currentQuestion: ownerQuestionId,
        questionOrder: [ownerQuestionId],
        questionCursor: 0,
      });
    });

    await expect(
      nonHostOwner.answerers[0].client.mutation(
        api.game.goToNextQuestionEarly,
        {
          code: nonHostOwner.code,
        },
      ),
    ).rejects.toThrow(
      "Rate every submitted response before moving to the next question.",
    );

    await nonHostOwner.answerers[0].client.mutation(api.game.rateResponse, {
      code: nonHostOwner.code,
      responseId: ownerResponseId,
      correctnessStars: 4,
      creativityStars: 4,
    });
    await expect(
      nonHostOwner.answerers[0].client.mutation(
        api.game.goToNextQuestionEarly,
        {
          code: nonHostOwner.code,
        },
      ),
    ).resolves.toEqual({
      advanced: true,
      phase: "ANSWERING_OR_END",
    });

    const nonHostServerAfterOwnerSkip = await getServer(
      nonHostOwner.t,
      nonHostOwner.serverId,
    );
    expect(nonHostServerAfterOwnerSkip?.gameState).toBe("END_SCREEN");
  });
});
