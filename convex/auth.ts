import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import { convexAuth } from "@convex-dev/auth/server";
import { normalizeUsername } from "./username";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Anonymous({
      profile: (params) => {
        const username = normalizeUsername(params.username);

        return {
          name: username,
          isAnonymous: true,
        };
      },
    }),
  ],
});
