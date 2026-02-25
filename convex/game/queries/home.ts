import { getAuthUserId } from "@convex-dev/auth/server";
import { query } from "../../_generated/server";
import { getPlayerByUserId } from "../helpers/authPlayer";

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
