import type { Doc } from "../../_generated/dataModel";
import { maxStars, minStars } from "../constants";

export function sanitizeQuestion(value: string, label: string) {
  const trimmed = value.trim();

  if (trimmed.length < 1) {
    throw new Error(`${label} must be at least 1 character long.`);
  }

  return trimmed;
}

export function clampAndValidateStars(raw: number) {
  if (!Number.isFinite(raw)) {
    throw new Error("Star rating must be a number.");
  }

  const rounded = Math.round(raw);

  if (rounded < minStars || rounded > maxStars) {
    throw new Error("Star rating must be between 0 and 5.");
  }

  return rounded;
}

export function normalizeStoredStars(raw: number | undefined) {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return 0;
  }

  return Math.max(minStars, Math.min(maxStars, Math.round(raw)));
}

export function responseIsFullyRated(response: Doc<"responses">) {
  return (
    typeof response.correctnessStars === "number" &&
    typeof response.creativityStars === "number"
  );
}
