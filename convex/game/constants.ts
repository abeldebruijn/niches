import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { Difficulty } from "./types";

export const difficultyValidator = v.union(
  v.literal("easy"),
  v.literal("medium"),
  v.literal("hard"),
);

export const difficultyToField: Record<Difficulty, keyof Doc<"players">> = {
  easy: "easyQuestion",
  medium: "mediumQuestion",
  hard: "hardQuestion",
};

export const minTimerSeconds = 15;
export const maxTimerSeconds = 300;
export const minStars = 0;
export const maxStars = 5;
export const acceleratedAnswerWindowSeconds = 10;
export const acceleratedRatingWindowSeconds = 10;
