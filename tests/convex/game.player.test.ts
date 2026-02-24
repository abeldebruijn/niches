import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import {
  createAuthedUser,
  createConvexTest,
  getPlayerByUserId,
} from "./_testUtils";

describe("game.ensurePlayer", () => {
  test("throws when unauthenticated", async () => {
    const t = createConvexTest();

    await expect(t.mutation(api.game.ensurePlayer, {})).rejects.toThrow(
      "Not authenticated.",
    );
  });

  test("creates a new player when missing", async () => {
    const t = createConvexTest();
    const { userId, client } = await createAuthedUser(t, "Alice");

    const result = await client.mutation(api.game.ensurePlayer, {});
    const player = await getPlayerByUserId(t, userId);

    expect(result.playerId).toBeDefined();
    expect(result.username).toBe("Alice");
    expect(player?._id).toBe(result.playerId);
    expect(player?.score).toBe(0);
  });

  test("uses normalized username on first creation", async () => {
    const t = createConvexTest();
    const { userId, client } = await createAuthedUser(t, "IgnoredName");

    const result = await client.mutation(api.game.ensurePlayer, {
      username: "  Alice_123  ",
    });
    const player = await getPlayerByUserId(t, userId);

    expect(result.username).toBe("Alice_123");
    expect(player?.username).toBe("Alice_123");
  });

  test("falls back to generated username when source name is invalid", async () => {
    const t = createConvexTest();
    const { userId, client } = await createAuthedUser(t, "??");

    const result = await client.mutation(api.game.ensurePlayer, {});
    const player = await getPlayerByUserId(t, userId);

    expect(result.username).toMatch(/^Player[A-Za-z0-9]{4}$/);
    expect(player?.username).toBe(result.username);
  });

  test("returns existing player unchanged when username is omitted", async () => {
    const t = createConvexTest();
    const { client } = await createAuthedUser(t, "IgnoredName");

    const created = await client.mutation(api.game.ensurePlayer, {
      username: "HostUser",
    });
    const second = await client.mutation(api.game.ensurePlayer, {});

    expect(second.playerId).toBe(created.playerId);
    expect(second.username).toBe("HostUser");
  });

  test("updates username for existing player", async () => {
    const t = createConvexTest();
    const { client } = await createAuthedUser(t, "Original");

    await client.mutation(api.game.ensurePlayer, {
      username: "AlphaUser",
    });
    const updated = await client.mutation(api.game.ensurePlayer, {
      username: "Beta_User",
    });

    expect(updated.username).toBe("Beta_User");
  });

  test("does not change username when normalized value matches existing", async () => {
    const t = createConvexTest();
    const { userId, client } = await createAuthedUser(t, "Original");

    await client.mutation(api.game.ensurePlayer, {
      username: "AlphaUser",
    });
    const same = await client.mutation(api.game.ensurePlayer, {
      username: "  AlphaUser  ",
    });
    const player = await getPlayerByUserId(t, userId);

    expect(same.username).toBe("AlphaUser");
    expect(player?.username).toBe("AlphaUser");
  });

  test("throws when authenticated user document is missing", async () => {
    const t = createConvexTest();
    const ghostUserId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("users", {
        name: "Ghost",
      });
      await ctx.db.delete(id);
      return id;
    });
    const client = t.withIdentity({
      subject: ghostUserId,
    });

    await expect(client.mutation(api.game.ensurePlayer, {})).rejects.toThrow(
      "Authenticated user was not found.",
    );
  });
});
