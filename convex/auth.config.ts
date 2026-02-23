/** biome-ignore-all lint/style/noNonNullAssertion: <explanation>This is a configuration file and we need to ensure that the environment variables are set.</explanation> */
import type { AuthConfig } from "convex/server";

export default {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
