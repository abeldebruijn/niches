import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const gameStateValidator = v.union(
  v.literal("CREATE_QUESTIONS"),
  v.literal("PLAY"),
  v.literal("END_SCREEN"),
);

export default defineSchema({
  ...authTables,

  servers: defineTable({
    code: v.number(),
    hostPlayer: v.id("players"),
    gameState: gameStateValidator,
    currentQuestion: v.optional(v.id("questions")),
    timePerQuestion: v.number(),
  }).index("by_code", ["code"]),

  players: defineTable({
    username: v.string(),
    userid: v.id("users"),
    inServer: v.optional(v.id("servers")),
    score: v.number(),
    easyQuestion: v.optional(v.id("questions")),
    mediumQuestion: v.optional(v.id("questions")),
    hardQuestion: v.optional(v.id("questions")),
  })
    .index("by_userid", ["userid"])
    .index("by_in_server", ["inServer"]),

  questions: defineTable({
    query: v.string(),
    answer: v.string(),
    player: v.id("players"),
    isAnswered: v.boolean(),
  }).index("by_player", ["player"]),
});
