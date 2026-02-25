import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import {
  createConvexTest,
  createQuestionDirect,
  createResponseDirect,
  ensureAuthedPlayer,
  fillAllQuestions,
  getServerByCode,
} from "./_testUtils";

async function setupLobbyQueryFixture() {
  const t = createConvexTest();
  const host = await ensureAuthedPlayer(t, "Host Name", "HostUser");
  const guest = await ensureAuthedPlayer(t, "Guest Name", "GuestUser");
  const { code } = await host.client.mutation(api.game.createLobby, {});
  await guest.client.mutation(api.game.joinLobby, { code });
  const server = await getServerByCode(t, code);

  if (!server) {
    throw new Error("Expected server to exist.");
  }

  return { t, host, guest, code, server };
}

describe("game queries", () => {
  test("viewerHome returns null when unauthenticated", async () => {
    const t = createConvexTest();

    await expect(t.query(api.game.viewerHome, {})).resolves.toBeNull();
  });

  test("viewerHome handles missing player, no lobby, missing server, and active server", async () => {
    const t = createConvexTest();
    const authOnlyUser = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        name: "AuthOnly",
      });
    });
    const authOnlyClient = t.withIdentity({
      subject: authOnlyUser,
    });

    await expect(
      authOnlyClient.query(api.game.viewerHome, {}),
    ).resolves.toEqual({
      username: null,
      activeServer: null,
    });

    const host = await ensureAuthedPlayer(t, "Host Name", "HostUser");
    await expect(host.client.query(api.game.viewerHome, {})).resolves.toEqual({
      username: "HostUser",
      activeServer: null,
    });

    const { code } = await host.client.mutation(api.game.createLobby, {});
    const server = await getServerByCode(t, code);
    if (!server) {
      throw new Error("Expected server to exist.");
    }

    await t.run(async (ctx) => {
      await ctx.db.delete(server._id);
    });
    await expect(host.client.query(api.game.viewerHome, {})).resolves.toEqual({
      username: "HostUser",
      activeServer: null,
    });

    const recreated = await host.client.mutation(api.game.createLobby, {});
    const active = await host.client.query(api.game.viewerHome, {});
    expect(active?.activeServer).toEqual({
      code: recreated.code,
      gameState: "CREATE_QUESTIONS",
      isHost: true,
    });
  });

  test("currentLobby auth and null behavior", async () => {
    const t = createConvexTest();

    await expect(t.query(api.game.currentLobby, {})).rejects.toThrow(
      "Not authenticated.",
    );

    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        name: "NoPlayer",
      });
    });
    const client = t.withIdentity({
      subject: userId,
    });
    await expect(client.query(api.game.currentLobby, {})).resolves.toBeNull();
  });

  test("currentLobby returns sorted players, canStart, and viewer questions", async () => {
    const { host, guest, code } = await setupLobbyQueryFixture();
    const beforeReady = await host.client.query(api.game.currentLobby, {});

    expect(beforeReady?.players.map((player) => player.username)).toEqual([
      "GuestUser",
      "HostUser",
    ]);
    expect(beforeReady?.canStart).toBe(false);

    await fillAllQuestions(host.client, "host");
    await fillAllQuestions(guest.client, "guest");
    const ready = await host.client.query(api.game.currentLobby, {});

    expect(ready?.canStart).toBe(true);
    expect(ready?.viewerQuestions.easy?.query).toContain("host-easy-question");
    expect(ready?.viewerQuestions.medium?.query).toContain(
      "host-medium-question",
    );
    expect(ready?.viewerQuestions.hard?.query).toContain("host-hard-question");

    const guestLobby = await guest.client.query(api.game.currentLobby, {});
    expect(guestLobby?.code).toBe(code);
  });

  test("playScreen auth and membership behavior", async () => {
    const t = createConvexTest();
    await expect(
      t.query(api.game.playScreen, { code: 123456 }),
    ).rejects.toThrow("Not authenticated.");

    const { host } = await setupLobbyQueryFixture();
    const unknown = await host.client.query(api.game.playScreen, {
      code: 999999,
    });
    expect(unknown).toBeNull();
  });

  test("playScreen returns base payload when game is not actively playable", async () => {
    const { host, code } = await setupLobbyQueryFixture();

    const screen = await host.client.query(api.game.playScreen, { code });
    expect(screen?.phase).toBeNull();
    expect(screen?.question).toBeNull();
    expect(screen?.rating).toBeNull();
    expect(screen?.answering).toBeNull();
  });

  test("playScreen handles missing current question doc fallback", async () => {
    const { t, host, code, server } = await setupLobbyQueryFixture();
    const nowSec = Math.floor(Date.now() / 1000);
    const transientQuestionId = await createQuestionDirect(t, {
      query: "Transient",
      answer: "Transient",
      player: host.playerId,
      server: server._id,
      difficulty: "EASY",
      isAnswered: false,
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(server._id, {
        gameState: "PLAY",
        currentQuestion: transientQuestionId,
        questionOrder: [transientQuestionId],
        questionCursor: 0,
        phase: "ANSWERING",
        phaseNonce: 1,
        phaseStartedAtSec: nowSec - 2,
        phaseEndsAtSec: nowSec + 120,
      });
      await ctx.db.delete(transientQuestionId);
    });

    const screen = await host.client.query(api.game.playScreen, { code });
    expect(screen?.phase).toBe("ANSWERING");
    expect(screen?.question).toBeNull();
    expect(screen?.phaseDurationSec).toBe(60);
  });

  test("playScreen answering and rating shapes", async () => {
    const { t, host, guest, code, server } = await setupLobbyQueryFixture();
    const nowSec = Math.floor(Date.now() / 1000);
    const questionId = await createQuestionDirect(t, {
      query: "Favorite city?",
      answer: "Paris",
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
        phaseNonce: 1,
        phaseStartedAtSec: nowSec - 2,
        phaseEndsAtSec: nowSec + 120,
      });
    });

    const answeringView = await guest.client.query(api.game.playScreen, {
      code,
    });
    expect(answeringView?.role).toBe("ANSWERING_PLAYER");
    expect(answeringView?.canSubmitAnswer).toBe(true);
    expect(answeringView?.phaseDurationSec).toBe(60);
    expect(answeringView?.question?.canonicalAnswer).toBeNull();

    const responseId = await createResponseDirect(t, {
      server: server._id,
      question: questionId,
      responder: guest.playerId,
      answer: "Rome",
      submittedAtSec: nowSec - 4,
      updatedAtSec: nowSec - 4,
      correctnessStars: 4,
      creativityStars: 5,
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(server._id, {
        phase: "RATING",
        phaseNonce: 2,
        phaseStartedAtSec: nowSec - 2,
        phaseEndsAtSec: nowSec + 120,
      });
      await ctx.db.patch(responseId, {
        ratedAtSec: nowSec - 1,
      });
    });

    const ratingView = await host.client.query(api.game.playScreen, { code });
    expect(ratingView?.role).toBe("RATING_PLAYER");
    expect(ratingView?.canRateResponses).toBe(true);
    expect(ratingView?.question?.canonicalAnswer).toBe("Paris");
    expect(ratingView?.rating?.responses).toHaveLength(1);
    expect(ratingView?.phaseDurationSec).toBe(120);
    expect(ratingView?.canGoNextEarly).toBe(true);
  });

  test("playScreen allows rating owner to go next early only when all are rated", async () => {
    const { t, host, guest, code, server } = await setupLobbyQueryFixture();
    const nowSec = Math.floor(Date.now() / 1000);
    const questionId = await createQuestionDirect(t, {
      query: "Question",
      answer: "Answer",
      player: guest.playerId,
      server: server._id,
      difficulty: "MEDIUM",
      isAnswered: false,
    });
    const responseId = await createResponseDirect(t, {
      server: server._id,
      question: questionId,
      responder: host.playerId,
      answer: "Maybe",
      submittedAtSec: nowSec - 6,
      updatedAtSec: nowSec - 6,
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(server._id, {
        gameState: "PLAY",
        currentQuestion: questionId,
        questionOrder: [questionId],
        questionCursor: 0,
        phase: "RATING",
        phaseNonce: 1,
        phaseStartedAtSec: nowSec - 2,
        phaseEndsAtSec: nowSec + 120,
      });
    });

    const unrated = await guest.client.query(api.game.playScreen, { code });
    expect(unrated?.canGoNextEarly).toBe(false);

    await t.run(async (ctx) => {
      await ctx.db.patch(responseId, {
        correctnessStars: 3,
        creativityStars: 2,
        ratedAtSec: nowSec - 1,
      });
    });

    const rated = await guest.client.query(api.game.playScreen, { code });
    expect(rated?.canGoNextEarly).toBe(true);
  });

  test("endScreen auth and result behavior", async () => {
    const t = createConvexTest();
    await expect(t.query(api.game.endScreen, { code: 123456 })).rejects.toThrow(
      "Not authenticated.",
    );

    const {
      t: fixtureT,
      host,
      guest,
      code,
      server,
    } = await setupLobbyQueryFixture();
    await fixtureT.run(async (ctx) => {
      await ctx.db.patch(host.playerId, {
        score: 12,
      });
      await ctx.db.patch(guest.playerId, {
        score: 12,
      });
      await ctx.db.patch(server._id, {
        gameState: "END_SCREEN",
      });
    });

    const hostEnd = await host.client.query(api.game.endScreen, { code });
    expect(hostEnd?.standings).toHaveLength(2);
    expect(hostEnd?.standings[0].score).toBe(12);
    expect(hostEnd?.winners).toHaveLength(2);
    expect(hostEnd?.standings[0].username).toBe("GuestUser");
    expect(hostEnd?.standings.some((entry) => entry.isHost)).toBe(true);
    expect(hostEnd?.standings.some((entry) => entry.isYou)).toBe(true);
  });

  test("endScreen returns null when user is not in requested lobby", async () => {
    const { guest, code } = await setupLobbyQueryFixture();
    await guest.client.mutation(api.game.leaveServer, {});

    const result = await guest.client.query(api.game.endScreen, { code });
    expect(result).toBeNull();
  });
});
