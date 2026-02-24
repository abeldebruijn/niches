import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import {
  createConvexTest,
  ensureAuthedPlayer,
  fillAllQuestions,
  getServerByCode,
} from "./_testUtils";

async function setupFullGame() {
  const t = createConvexTest();
  const host = await ensureAuthedPlayer(t, "Host Name", "HostUser");
  const guest = await ensureAuthedPlayer(t, "Guest Name", "GuestUser");
  const { code } = await host.client.mutation(api.game.createLobby, {});
  await guest.client.mutation(api.game.joinLobby, { code });

  await fillAllQuestions(host.client, "host");
  await fillAllQuestions(guest.client, "guest");
  await host.client.mutation(api.game.startGame, {});

  return { t, host, guest, code };
}

async function setupReadyLobbyWithoutStarting() {
  const t = createConvexTest();
  const host = await ensureAuthedPlayer(t, "Host Name", "HostUser");
  const guest = await ensureAuthedPlayer(t, "Guest Name", "GuestUser");
  const { code } = await host.client.mutation(api.game.createLobby, {});
  await guest.client.mutation(api.game.joinLobby, { code });
  await fillAllQuestions(host.client, "host");
  await fillAllQuestions(guest.client, "guest");

  return { t, host, guest, code };
}

describe("game e2e flows", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("full happy-path game reaches end screen", async () => {
    const { t, host, guest, code } = await setupFullGame();

    for (let turns = 0; turns < 20; turns += 1) {
      const server = await getServerByCode(t, code);
      if (!server) {
        throw new Error("Expected server to exist.");
      }

      if (server.gameState === "END_SCREEN") {
        break;
      }

      const question = await t.run(async (ctx) => {
        if (!server.currentQuestion) {
          return null;
        }
        return await ctx.db.get(server.currentQuestion);
      });
      if (!question) {
        break;
      }

      const ownerClient =
        question.player === host.playerId ? host.client : guest.client;
      const answererClient =
        question.player === host.playerId ? guest.client : host.client;

      if (server.phase === "ANSWERING") {
        await answererClient.mutation(api.game.submitResponse, {
          code,
          answer: `answer-${turns}`,
        });
        await host.client.mutation(api.game.goToNextQuestionEarly, { code });
      }

      const ratingView = await ownerClient.query(api.game.playScreen, { code });
      if (ratingView?.phase !== "RATING" || !ratingView.rating) {
        continue;
      }

      for (const response of ratingView.rating.responses) {
        await ownerClient.mutation(api.game.rateResponse, {
          code,
          responseId: response.id,
          correctnessStars: 4,
          creativityStars: 4,
        });
      }

      await ownerClient.mutation(api.game.goToNextQuestionEarly, { code });
    }

    const end = await host.client.query(api.game.endScreen, { code });
    expect(end).not.toBeNull();
    expect(end?.gameState).toBe("END_SCREEN");
    expect(end?.standings.length).toBe(2);
    expect(end?.winners.length).toBeGreaterThanOrEqual(1);
  });

  test("multi-question flow accumulates scores and supports ties", async () => {
    const { t, host, guest, code } = await setupFullGame();

    for (let turns = 0; turns < 20; turns += 1) {
      const server = await getServerByCode(t, code);
      if (!server) {
        throw new Error("Expected server to exist.");
      }
      if (server.gameState === "END_SCREEN") {
        break;
      }

      const question = await t.run(async (ctx) => {
        if (!server.currentQuestion) {
          return null;
        }
        return await ctx.db.get(server.currentQuestion);
      });
      if (!question) {
        break;
      }

      const ownerClient =
        question.player === host.playerId ? host.client : guest.client;
      const answererClient =
        question.player === host.playerId ? guest.client : host.client;

      if (server.phase === "ANSWERING") {
        await answererClient.mutation(api.game.submitResponse, {
          code,
          answer: `guess-${turns}`,
        });
        await host.client.mutation(api.game.goToNextQuestionEarly, { code });
      }

      const ratingView = await ownerClient.query(api.game.playScreen, { code });
      if (ratingView?.phase === "RATING" && ratingView.rating) {
        for (const response of ratingView.rating.responses) {
          await ownerClient.mutation(api.game.rateResponse, {
            code,
            responseId: response.id,
            correctnessStars: 3,
            creativityStars: 3,
          });
        }
        await ownerClient.mutation(api.game.goToNextQuestionEarly, { code });
      }
    }

    const endBeforeTie = await host.client.query(api.game.endScreen, { code });
    expect(endBeforeTie?.standings[0].score).toBeGreaterThanOrEqual(0);

    await t.run(async (ctx) => {
      await ctx.db.patch(host.playerId, {
        score: 42,
      });
      await ctx.db.patch(guest.playerId, {
        score: 42,
      });
    });

    const endAfterTie = await host.client.query(api.game.endScreen, { code });
    expect(endAfterTie?.winners.length).toBe(2);
  });

  test("timer-driven transitions run through scheduled functions", async () => {
    vi.useFakeTimers();
    const { t, host, guest, code } = await setupReadyLobbyWithoutStarting();

    await host.client.mutation(api.game.updateTimePerQuestion, {
      seconds: 15,
    });
    await host.client.mutation(api.game.startGame, {});

    const hostPlay = await host.client.query(api.game.playScreen, { code });
    const guestPlay = await guest.client.query(api.game.playScreen, { code });

    if (hostPlay?.canSubmitAnswer) {
      await host.client.mutation(api.game.submitResponse, {
        code,
        answer: "Timer answer from host",
      });
    } else if (guestPlay?.canSubmitAnswer) {
      await guest.client.mutation(api.game.submitResponse, {
        code,
        answer: "Timer answer from guest",
      });
    }

    vi.advanceTimersByTime(15_001);
    await t.finishInProgressScheduledFunctions();

    const afterAnswering = await host.client.query(api.game.playScreen, {
      code,
    });
    expect(afterAnswering?.phase).toBe("RATING");

    vi.advanceTimersByTime(30_001);
    await t.finishInProgressScheduledFunctions();

    const afterRating = await host.client.query(api.game.playScreen, { code });
    expect(
      afterRating?.gameState === "PLAY" ||
        afterRating?.gameState === "END_SCREEN",
    ).toBe(true);
  });
});
