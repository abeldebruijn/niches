// Simplified type-safe env validation
// In the full Lola app, this uses @t3-oss/env-nextjs

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const env = {
  NEXT_PUBLIC_CONVEX_URL: () => requireEnv("NEXT_PUBLIC_CONVEX_URL"),
};
