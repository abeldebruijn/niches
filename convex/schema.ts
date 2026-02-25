import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const gameStateValidator = v.union(
  v.literal("CREATE_QUESTIONS"),
  v.literal("PLAY"),
  v.literal("END_SCREEN"),
);

export const roundPhaseValidator = v.union(
  v.literal("ANSWERING"),
  v.literal("RATING"),
);

export default defineSchema({
  ...authTables,

  servers: defineTable({
    code: v.number(),
    hostPlayer: v.id("players"),
    gameState: gameStateValidator,
    currentQuestion: v.optional(v.id("questions")),
    maxQuestions: v.number(),
    timePerQuestion: v.number(),
    maxQuestions: v.optional(v.number()),
    questionOrder: v.optional(v.array(v.id("questions"))),
    questionCursor: v.optional(v.number()),
    phase: v.optional(roundPhaseValidator),
    phaseStartedAtSec: v.optional(v.number()),
    phaseEndsAtSec: v.optional(v.number()),
    phaseNonce: v.optional(v.number()),
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
    server: v.id("servers"),
    difficulty: v.union(
      v.literal("EASY"),
      v.literal("MEDIUM"),
      v.literal("HARD"),
    ),
    isAnswered: v.boolean(),
  })
    .index("by_player", ["player"])
    .index("by_server", ["server"]),

  responses: defineTable({
    server: v.id("servers"),
    question: v.id("questions"),
    responder: v.id("players"),
    answer: v.string(),
    submittedAtSec: v.number(),
    updatedAtSec: v.number(),
    correctnessStars: v.optional(v.number()),
    creativityStars: v.optional(v.number()),
    ratedAtSec: v.optional(v.number()),
  })
    .index("by_question", ["question"])
    .index("by_question_responder", ["question", "responder"]),
});
