import { v } from "convex/values";
import { mutation } from "../../_generated/server";
import { maxTimerSeconds, minTimerSeconds } from "../constants";
import { requireOrCreatePlayer } from "../helpers/authPlayer";
import {
  assertValidLobbyCode,
  generateUniqueLobbyCode,
  requireLobbyForPlayer,
} from "../helpers/lobby";

/**
 * Creates a new lobby and returns the lobby code.
 * If the player is already in a lobby that they are hosting and is in the "CREATE_QUESTIONS" phase,
 * it will return the existing lobby code instead of creating a new lobby.
 */
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
      maxQuestions: 6,
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

/**
 * Joins an existing lobby with the provided code. The player must not already be in a different lobby.
 * If the player is already in the lobby they are trying to join, it will simply return the lobby code.
 */
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

/**
 * Removes a player from the lobby. Only the host can remove other players,
 * and players can only be removed before the game starts.
 */
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
