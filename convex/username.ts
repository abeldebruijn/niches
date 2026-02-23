export const USERNAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{2,19}$/;

export function normalizeUsername(value: unknown) {
  const username = typeof value === "string" ? value.trim() : "";

  if (!USERNAME_PATTERN.test(username)) {
    throw new Error(
      "Username must be 3-20 chars, start with a letter, and only use letters, numbers, _ or -.",
    );
  }

  return username;
}
