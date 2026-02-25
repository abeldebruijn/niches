import type { Doc } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";

export function assertValidLobbyCode(code: number) {
  if (!Number.isInteger(code) || code < 100000 || code > 999999) {
    throw new Error("Lobby code must be a 6-digit number.");
  }
}

export async function requireLobbyForPlayer(
  ctx: MutationCtx,
  player: Doc<"players">,
) {
  if (!player.inServer) {
    throw new Error("Join or create a lobby first.");
  }

  const server = await ctx.db.get(player.inServer);

  if (!server) {
    throw new Error("Lobby no longer exists.");
  }

  return server;
}

export async function requireServerForPlayerByCode(
  ctx: MutationCtx,
  player: Doc<"players">,
  code: number,
) {
  assertValidLobbyCode(code);

  const server = await ctx.db
    .query("servers")
    .withIndex("by_code", (q) => q.eq("code", code))
    .unique();

  if (!server || !player.inServer || server._id !== player.inServer) {
    throw new Error("You are not currently in this lobby.");
  }

  return server;
}

export async function generateUniqueLobbyCode(ctx: MutationCtx) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const code = Math.floor(100000 + Math.random() * 900000);
    const existing = await ctx.db
      .query("servers")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();

    if (!existing) {
      return code;
    }
  }

  throw new Error("Could not allocate a unique lobby code. Try again.");
}
