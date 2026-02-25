import { v } from "convex/values";
import { mutation } from "../../_generated/server";
import { normalizeUsername } from "../../username";
import {
  coerceUsername,
  fallbackUsername,
  getPlayerByUserId,
  requireUserId,
} from "../helpers/authPlayer";

export const ensurePlayer = mutation({
  args: {
    username: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const existing = await getPlayerByUserId(ctx, userId);
    const user = await ctx.db.get(userId);

    if (!user) {
      throw new Error("Authenticated user was not found.");
    }

    const fallback = fallbackUsername(userId);

    if (!existing) {
      const username = coerceUsername(args.username ?? user.name, fallback);
      const playerId = await ctx.db.insert("players", {
        username,
        userid: userId,
        score: 0,
      });

      return {
        playerId,
        username,
      };
    }

    if (args.username) {
      const username = normalizeUsername(args.username);

      if (username !== existing.username) {
        await ctx.db.patch(existing._id, {
          username,
        });
      }

      return {
        playerId: existing._id,
        username,
      };
    }

    return {
      playerId: existing._id,
      username: existing.username,
    };
  },
});
