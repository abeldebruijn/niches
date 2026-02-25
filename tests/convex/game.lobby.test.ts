import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import {
  createAuthedUser,
  createConvexTest,
  ensureAuthedPlayer,
  fillAllQuestions,
  getServerByCode,
  patchServer,
} from "./_testUtils";

async function setupLobby() {
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

describe("game lobby mutations", () => {
  test("createLobby creates a lobby with defaults", async () => {
    const t = createConvexTest();
    const host = await ensureAuthedPlayer(t, "Host Name", "HostUser");

    const { code } = await host.client.mutation(api.game.createLobby, {});
    const server = await getServerByCode(t, code);

    expect(server).not.toBeNull();
    expect(server?.gameState).toBe("CREATE_QUESTIONS");
    expect(server?.timePerQuestion).toBe(60);
    expect(server?.maxQuestions).toBeUndefined();
    expect(server?.hostPlayer).toBe(host.playerId);
  });

  test("createLobby reuses existing host lobby in CREATE_QUESTIONS", async () => {
    const t = createConvexTest();
    const host = await ensureAuthedPlayer(t, "Host Name", "HostUser");

    const first = await host.client.mutation(api.game.createLobby, {});
    const second = await host.client.mutation(api.game.createLobby, {});

    expect(second.code).toBe(first.code);
  });

  test("createLobby resets player round fields", async () => {
    const t = createConvexTest();
    const host = await ensureAuthedPlayer(t, "Host Name", "HostUser");

    await t.run(async (ctx) => {
      const serverId = await ctx.db.insert("servers", {
        code: 123456,
        hostPlayer: host.playerId,
        gameState: "CREATE_QUESTIONS",
        maxQuestions: 6,
        timePerQuestion: 60,
      });
      const easyQuestion = await ctx.db.insert("questions", {
        query: "q1",
        answer: "a1",
        player: host.playerId,
        server: serverId,
        difficulty: "EASY",
        isAnswered: false,
      });
      const mediumQuestion = await ctx.db.insert("questions", {
        query: "q2",
        answer: "a2",
        player: host.playerId,
        server: serverId,
        difficulty: "MEDIUM",
        isAnswered: false,
      });
      const hardQuestion = await ctx.db.insert("questions", {
        query: "q3",
        answer: "a3",
        player: host.playerId,
        server: serverId,
        difficulty: "HARD",
        isAnswered: false,
      });

      await ctx.db.patch(host.playerId, {
        score: 99,
        easyQuestion,
        mediumQuestion,
        hardQuestion,
      });
    });

    await host.client.mutation(api.game.createLobby, {});
    const player = await t.run(async (ctx) => ctx.db.get(host.playerId));

    expect(player?.score).toBe(0);
    expect(player?.easyQuestion).toBeUndefined();
    expect(player?.mediumQuestion).toBeUndefined();
    expect(player?.hardQuestion).toBeUndefined();
  });

  test("joinLobby rejects invalid lobby codes", async () => {
    const t = createConvexTest();
    const player = await ensureAuthedPlayer(t, "Joiner Name", "JoinerUser");

    await expect(
      player.client.mutation(api.game.joinLobby, {
        code: 12,
      }),
    ).rejects.toThrow("Lobby code must be a 6-digit number.");
  });

  test("joinLobby throws when lobby not found", async () => {
    const t = createConvexTest();
    const player = await ensureAuthedPlayer(t, "Joiner Name", "JoinerUser");

    await expect(
      player.client.mutation(api.game.joinLobby, {
        code: 654321,
      }),
    ).rejects.toThrow("Lobby not found.");
  });

  test("joinLobby rejects started lobbies", async () => {
    const { t, host, guest, code, server } = await setupLobby();

    await patchServer(t, server._id, {
      gameState: "PLAY",
    });

    await expect(
      guest.client.mutation(api.game.joinLobby, { code }),
    ).rejects.toThrow("This lobby already started the game.");
    await expect(
      host.client.mutation(api.game.joinLobby, { code }),
    ).rejects.toThrow("This lobby already started the game.");
  });

  test("joinLobby returns code without changing state when already joined", async () => {
    const { t, guest, code } = await setupLobby();
    const before = await t.run(async (ctx) => ctx.db.get(guest.playerId));

    const result = await guest.client.mutation(api.game.joinLobby, { code });
    const after = await t.run(async (ctx) => ctx.db.get(guest.playerId));

    expect(result.code).toBe(code);
    expect(after?.inServer).toBe(before?.inServer);
  });

  test("updateTimePerQuestion requires user to be in a lobby", async () => {
    const t = createConvexTest();
    const host = await ensureAuthedPlayer(t, "Host Name", "HostUser");

    await expect(
      host.client.mutation(api.game.updateTimePerQuestion, {
        seconds: 40,
      }),
    ).rejects.toThrow("Join or create a lobby first.");
  });

  test("updateTimePerQuestion only allows host", async () => {
    const { guest } = await setupLobby();

    await expect(
      guest.client.mutation(api.game.updateTimePerQuestion, {
        seconds: 45,
      }),
    ).rejects.toThrow("Only the host can update the timer.");
  });

  test("updateTimePerQuestion only allows CREATE_QUESTIONS state", async () => {
    const { t, host, server } = await setupLobby();

    await patchServer(t, server._id, {
      gameState: "PLAY",
    });

    await expect(
      host.client.mutation(api.game.updateTimePerQuestion, {
        seconds: 45,
      }),
    ).rejects.toThrow("Timer can only be edited before the game starts.");
  });

  test("updateTimePerQuestion clamps to min and max", async () => {
    const { host } = await setupLobby();

    const minResult = await host.client.mutation(
      api.game.updateTimePerQuestion,
      {
        seconds: 1,
      },
    );
    const maxResult = await host.client.mutation(
      api.game.updateTimePerQuestion,
      {
        seconds: 999,
      },
    );

    expect(minResult.seconds).toBe(15);
    expect(maxResult.seconds).toBe(300);
  });

  test("updateMaxQuestions only allows host and CREATE_QUESTIONS state", async () => {
    const { t, host, guest, server } = await setupLobby();

    await expect(
      guest.client.mutation(api.game.updateMaxQuestions, {
        count: 5,
      }),
    ).rejects.toThrow("Only the host can update the maximum questions.");

    await patchServer(t, server._id, {
      gameState: "PLAY",
    });
    await expect(
      host.client.mutation(api.game.updateMaxQuestions, {
        count: 5,
      }),
    ).rejects.toThrow(
      "Maximum questions can only be edited before the game starts.",
    );
  });

  test("updateMaxQuestions enforces minimum availability and clamps to lobby range", async () => {
    const { host, guest, t, code } = await setupLobby();

    await expect(
      host.client.mutation(api.game.updateMaxQuestions, {
        count: 5,
      }),
    ).rejects.toThrow(
      "At least 3 questions must be saved before setting a maximum.",
    );

    await fillAllQuestions(host.client, "host");
    await fillAllQuestions(guest.client, "guest");

    const minResult = await host.client.mutation(api.game.updateMaxQuestions, {
      count: 1,
    });
    const maxResult = await host.client.mutation(api.game.updateMaxQuestions, {
      count: 999,
    });

    const server = await getServerByCode(t, code);

    expect(minResult.count).toBe(3);
    expect(maxResult.count).toBe(6);
    expect(server?.maxQuestions).toBe(6);
  });

  test("kickPlayer only allows host and CREATE_QUESTIONS state", async () => {
    const { t, host, guest, server } = await setupLobby();

    await expect(
      guest.client.mutation(api.game.kickPlayer, {
        targetPlayerId: host.playerId,
      }),
    ).rejects.toThrow("Only the host can remove players.");

    await patchServer(t, server._id, {
      gameState: "PLAY",
    });
    await expect(
      host.client.mutation(api.game.kickPlayer, {
        targetPlayerId: guest.playerId,
      }),
    ).rejects.toThrow("Players can only be removed before the game starts.");
  });

  test("kickPlayer rejects invalid target scenarios", async () => {
    const { t, host, guest } = await setupLobby();
    const outsider = await ensureAuthedPlayer(
      t,
      "Outsider Name",
      "OutsiderUser",
    );

    await expect(
      host.client.mutation(api.game.kickPlayer, {
        targetPlayerId: host.playerId,
      }),
    ).rejects.toThrow("Host cannot remove themselves.");

    await expect(
      host.client.mutation(api.game.kickPlayer, {
        targetPlayerId: outsider.playerId,
      }),
    ).rejects.toThrow("Player is no longer in your lobby.");

    await expect(
      host.client.mutation(api.game.kickPlayer, {
        targetPlayerId: guest.playerId,
      }),
    ).resolves.toEqual({ removed: true });
  });

  test("leaveServer returns false when not in lobby", async () => {
    const t = createConvexTest();
    const player = await ensureAuthedPlayer(t, "Solo Name", "SoloUser");

    const result = await player.client.mutation(api.game.leaveServer, {});
    expect(result).toEqual({ left: false });
  });

  test("leaveServer removes non-host from lobby", async () => {
    const { t, guest } = await setupLobby();

    const result = await guest.client.mutation(api.game.leaveServer, {});
    const guestAfter = await t.run(async (ctx) => ctx.db.get(guest.playerId));

    expect(result).toEqual({ left: true });
    expect(guestAfter?.inServer).toBeUndefined();
  });

  test("leaveServer reassigns host to lexicographically smallest username", async () => {
    const t = createConvexTest();
    const host = await ensureAuthedPlayer(t, "Host Name", "ZetaHost");
    const guestA = await ensureAuthedPlayer(t, "Guest A Name", "AlphaGuest");
    const guestB = await ensureAuthedPlayer(t, "Guest B Name", "BetaGuest");
    const { code } = await host.client.mutation(api.game.createLobby, {});
    await guestA.client.mutation(api.game.joinLobby, { code });
    await guestB.client.mutation(api.game.joinLobby, { code });
    const serverBefore = await getServerByCode(t, code);

    if (!serverBefore) {
      throw new Error("Expected server to exist.");
    }

    await host.client.mutation(api.game.leaveServer, {});
    const serverAfter = await t.run(async (ctx) =>
      ctx.db.get(serverBefore._id),
    );

    expect(serverAfter?.hostPlayer).toBe(guestA.playerId);
  });

  test("leaveServer with no remaining players keeps server host unchanged", async () => {
    const t = createConvexTest();
    const host = await ensureAuthedPlayer(t, "Host Name", "HostUser");
    const { code } = await host.client.mutation(api.game.createLobby, {});
    const serverBefore = await getServerByCode(t, code);

    if (!serverBefore) {
      throw new Error("Expected server to exist.");
    }

    await host.client.mutation(api.game.leaveServer, {});
    const serverAfter = await t.run(async (ctx) =>
      ctx.db.get(serverBefore._id),
    );

    expect(serverAfter?.hostPlayer).toBe(serverBefore.hostPlayer);
  });

  test("createLobby and joinLobby behave with direct identity setup", async () => {
    const t = createConvexTest();
    const hostUser = await createAuthedUser(t, "Host Name");
    const guestUser = await createAuthedUser(t, "Guest Name");

    await hostUser.client.mutation(api.game.ensurePlayer, {
      username: "HostUser",
    });
    await guestUser.client.mutation(api.game.ensurePlayer, {
      username: "GuestUser",
    });

    const { code } = await hostUser.client.mutation(api.game.createLobby, {});
    const joined = await guestUser.client.mutation(api.game.joinLobby, {
      code,
    });

    expect(joined.code).toBe(code);
  });
});
