import { afterEach, describe, expect, test, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import {
  coerceUsername,
  fallbackUsername,
} from "../../convex/game/helpers/authPlayer";
import { shuffleInPlace } from "../../convex/game/helpers/collections";
import {
  assertValidLobbyCode,
  generateUniqueLobbyCode,
} from "../../convex/game/helpers/lobby";
import {
  ensureCurrentQuestion,
  nowInSeconds,
  questionDurationSeconds,
} from "../../convex/game/helpers/roundLifecycle";
import {
  clampAndValidateStars,
  normalizeStoredStars,
  responseIsFullyRated,
  sanitizeQuestion,
} from "../../convex/game/helpers/validation";
import { createConvexTest, ensureAuthedPlayer } from "./_testUtils";

describe("game helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test("assertValidLobbyCode accepts only 6-digit integer codes", () => {
    expect(() => assertValidLobbyCode(123456)).not.toThrow();
    expect(() => assertValidLobbyCode(999999)).not.toThrow();
    expect(() => assertValidLobbyCode(99999)).toThrow(
      "Lobby code must be a 6-digit number.",
    );
    expect(() => assertValidLobbyCode(1000000)).toThrow(
      "Lobby code must be a 6-digit number.",
    );
    expect(() => assertValidLobbyCode(123456.5)).toThrow(
      "Lobby code must be a 6-digit number.",
    );
  });

  test("generateUniqueLobbyCode returns an unused 6-digit code", async () => {
    const t = createConvexTest();
    const code = await t.run(async (ctx) => {
      return await generateUniqueLobbyCode(ctx);
    });

    expect(Number.isInteger(code)).toBe(true);
    expect(code).toBeGreaterThanOrEqual(100000);
    expect(code).toBeLessThanOrEqual(999999);
  });

  test("generateUniqueLobbyCode throws after 50 collisions", async () => {
    const t = createConvexTest();
    const host = await ensureAuthedPlayer(t, "Host Name", "HostUser");
    await t.run(async (ctx) => {
      await ctx.db.insert("servers", {
        code: 100000,
        hostPlayer: host.playerId,
        gameState: "CREATE_QUESTIONS",
        timePerQuestion: 60,
      });
    });
    vi.spyOn(Math, "random").mockReturnValue(0);

    await expect(
      t.run(async (ctx) => {
        return await generateUniqueLobbyCode(ctx);
      }),
    ).rejects.toThrow("Could not allocate a unique lobby code. Try again.");
  });

  test("sanitizeQuestion trims and rejects empty values", () => {
    expect(sanitizeQuestion("  hello  ", "Question")).toBe("hello");
    expect(() => sanitizeQuestion("   ", "Question")).toThrow(
      "Question must be at least 1 character long.",
    );
  });

  test("clampAndValidateStars validates and rounds stars", () => {
    expect(clampAndValidateStars(2.6)).toBe(3);
    expect(() => clampAndValidateStars(Number.NaN)).toThrow(
      "Star rating must be a number.",
    );
    expect(() => clampAndValidateStars(6)).toThrow(
      "Star rating must be between 0 and 5.",
    );
  });

  test("normalizeStoredStars returns clamped values", () => {
    expect(normalizeStoredStars(undefined)).toBe(0);
    expect(normalizeStoredStars(Number.NaN)).toBe(0);
    expect(normalizeStoredStars(-5)).toBe(0);
    expect(normalizeStoredStars(2.7)).toBe(3);
    expect(normalizeStoredStars(99)).toBe(5);
  });

  test("responseIsFullyRated checks both ratings", () => {
    const fullyRated = {
      correctnessStars: 1,
      creativityStars: 2,
    } as unknown as Parameters<typeof responseIsFullyRated>[0];
    const missingCreativity = {
      correctnessStars: 1,
    } as unknown as Parameters<typeof responseIsFullyRated>[0];

    expect(responseIsFullyRated(fullyRated)).toBe(true);
    expect(responseIsFullyRated(missingCreativity)).toBe(false);
  });

  test("nowInSeconds uses floored unix time and questionDurationSeconds scales by phase", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:03.999Z"));

    expect(nowInSeconds()).toBe(1_767_225_603);
    expect(questionDurationSeconds("ANSWERING", 60)).toBe(60);
    expect(questionDurationSeconds("RATING", 60)).toBe(120);
  });

  test("ensureCurrentQuestion throws for missing currentQuestion and missing doc", async () => {
    const t = createConvexTest();
    const host = await ensureAuthedPlayer(t, "Host Name", "HostUser");
    const serverId = await t.run(async (ctx) => {
      return await ctx.db.insert("servers", {
        code: 123456,
        hostPlayer: host.playerId,
        gameState: "PLAY",
        timePerQuestion: 60,
      });
    });

    await expect(
      t.run(async (ctx) => {
        const server = await ctx.db.get(serverId);
        if (!server) {
          throw new Error("Expected server.");
        }
        return await ensureCurrentQuestion(ctx, server, "Test");
      }),
    ).rejects.toThrow("Test is missing the active question.");

    const questionId = await t.run(async (ctx) => {
      return await ctx.db.insert("questions", {
        query: "Q",
        answer: "A",
        player: host.playerId,
        server: serverId,
        difficulty: "EASY",
        isAnswered: false,
      });
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(serverId, {
        currentQuestion: questionId,
      });
      await ctx.db.delete(questionId);
    });

    await expect(
      t.run(async (ctx) => {
        const server = await ctx.db.get(serverId);
        if (!server) {
          throw new Error("Expected server.");
        }
        return await ensureCurrentQuestion(ctx, server, "Test");
      }),
    ).rejects.toThrow("Test active question no longer exists.");
  });

  test("shuffleInPlace preserves contents and returns same reference", () => {
    const values = [1, 2, 3, 4, 5];
    const original = [...values].sort((a, b) => a - b);
    const shuffled = shuffleInPlace(values);
    const sorted = [...shuffled].sort((a, b) => a - b);

    expect(shuffled).toBe(values);
    expect(sorted).toEqual(original);
  });

  test("fallbackUsername and coerceUsername", () => {
    const generated = fallbackUsername("1234abcd" as unknown as Id<"users">);
    expect(generated).toMatch(/^Player[A-Za-z0-9]{4}$/);
    expect(coerceUsername("  ValidUser  ", "FallbackUser")).toBe("ValidUser");
    expect(coerceUsername("??", "FallbackUser")).toBe("FallbackUser");
  });
});
