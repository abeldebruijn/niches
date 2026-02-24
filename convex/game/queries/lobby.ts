import { query } from "../../_generated/server";
import { requirePlayerForQuery } from "../helpers/authPlayer";

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

    const easy = player.easyQuestion
      ? await ctx.db.get(player.easyQuestion)
      : null;
    const medium = player.mediumQuestion
      ? await ctx.db.get(player.mediumQuestion)
      : null;
    const hard = player.hardQuestion
      ? await ctx.db.get(player.hardQuestion)
      : null;

    const everyoneReady = playersInLobby.filter(
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
        everyoneReady.length >= 2,
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
