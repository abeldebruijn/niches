import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { normalizeUsername } from "../../username";

export async function requireUserId(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);

  if (!userId) {
    throw new Error("Not authenticated.");
  }

  return userId;
}

export async function getPlayerByUserId(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
) {
  return await ctx.db
    .query("players")
    .withIndex("by_userid", (q) => q.eq("userid", userId))
    .unique();
}

export function fallbackUsername(userId: Id<"users">) {
  const suffix = userId.slice(-4).replace(/[^a-zA-Z0-9]/g, "");
  return `Player${suffix || "0000"}`;
}

export function coerceUsername(value: unknown, fallback: string) {
  try {
    return normalizeUsername(value);
  } catch {
    return fallback;
  }
}

export async function requireOrCreatePlayer(ctx: MutationCtx) {
  const userId = await requireUserId(ctx);
  const existing = await getPlayerByUserId(ctx, userId);

  if (existing) {
    return existing;
  }

  const user = await ctx.db.get(userId);

  if (!user) {
    throw new Error("Authenticated user was not found.");
  }

  const username = coerceUsername(user.name, fallbackUsername(userId));
  const playerId = await ctx.db.insert("players", {
    username,
    userid: userId,
    score: 0,
  });

  const player = await ctx.db.get(playerId);

  if (!player) {
    throw new Error("Failed to create player profile.");
  }

  return player;
}

export async function requirePlayerForQuery(ctx: QueryCtx) {
  const userId = await requireUserId(ctx);
  const player = await getPlayerByUserId(ctx, userId);

  if (!player) {
    return null;
  }

  return player;
}
