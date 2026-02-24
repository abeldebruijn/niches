import { convexTest } from "convex-test";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";

type ModuleLoader = () => Promise<unknown>;

declare global {
  interface ImportMeta {
    glob: (pattern: string) => Record<string, ModuleLoader>;
  }
}

const modules = import.meta.glob("../../convex/**/*.{ts,tsx}");

export function createConvexTest() {
  return convexTest(schema, modules);
}

export async function createAuthedUser(
  t: ReturnType<typeof createConvexTest>,
  name = "User",
) {
  const userId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      name,
    });
  });

  return {
    userId,
    client: t.withIdentity({
      subject: userId,
    }),
  };
}

export async function ensureAuthedPlayer(
  t: ReturnType<typeof createConvexTest>,
  name: string,
  username?: string,
) {
  const { userId, client } = await createAuthedUser(t, name);
  const ensured = await client.mutation(
    api.game.ensurePlayer,
    username ? { username } : {},
  );
  const player = await t.run(async (ctx) => {
    return await ctx.db.get(ensured.playerId);
  });

  if (!player) {
    throw new Error("Failed to create player in test fixture.");
  }

  return {
    userId,
    client,
    player,
    playerId: player._id,
  };
}

export async function getPlayerByUserId(
  t: ReturnType<typeof createConvexTest>,
  userId: Id<"users">,
) {
  return await t.run(async (ctx) => {
    return await ctx.db
      .query("players")
      .withIndex("by_userid", (q) => q.eq("userid", userId))
      .unique();
  });
}

export async function getServerByCode(
  t: ReturnType<typeof createConvexTest>,
  code: number,
) {
  return await t.run(async (ctx) => {
    return await ctx.db
      .query("servers")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
  });
}

export const difficulties = ["easy", "medium", "hard"] as const;

export async function fillAllQuestions(
  client: Awaited<ReturnType<typeof createAuthedUser>>["client"],
  prefix: string,
) {
  for (const difficulty of difficulties) {
    await client.mutation(api.game.saveQuestion, {
      difficulty,
      query: `${prefix}-${difficulty}-question`,
      answer: `${prefix}-${difficulty}-answer`,
    });
  }
}

export async function playersInServer(
  t: ReturnType<typeof createConvexTest>,
  serverId: Id<"servers">,
) {
  return await t.run(async (ctx) => {
    return await ctx.db
      .query("players")
      .withIndex("by_in_server", (q) => q.eq("inServer", serverId))
      .collect();
  });
}

export async function responsesByQuestion(
  t: ReturnType<typeof createConvexTest>,
  questionId: Id<"questions">,
) {
  return await t.run(async (ctx) => {
    return await ctx.db
      .query("responses")
      .withIndex("by_question", (q) => q.eq("question", questionId))
      .collect();
  });
}

export async function patchServer(
  t: ReturnType<typeof createConvexTest>,
  serverId: Id<"servers">,
  patch: Partial<Doc<"servers">>,
) {
  await t.run(async (ctx) => {
    await ctx.db.patch(serverId, patch);
  });
}

export async function getServer(
  t: ReturnType<typeof createConvexTest>,
  serverId: Id<"servers">,
) {
  return await t.run(async (ctx) => {
    return await ctx.db.get(serverId);
  });
}

export async function getQuestion(
  t: ReturnType<typeof createConvexTest>,
  questionId: Id<"questions">,
) {
  return await t.run(async (ctx) => {
    return await ctx.db.get(questionId);
  });
}

export async function createQuestionDirect(
  t: ReturnType<typeof createConvexTest>,
  values: Omit<Doc<"questions">, "_creationTime" | "_id">,
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("questions", values);
  });
}

export async function createResponseDirect(
  t: ReturnType<typeof createConvexTest>,
  values: Omit<Doc<"responses">, "_creationTime" | "_id">,
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("responses", values);
  });
}
