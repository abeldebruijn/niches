import { v } from "convex/values";
import { query } from "../../_generated/server";
import { requirePlayerForQuery } from "../helpers/authPlayer";

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
