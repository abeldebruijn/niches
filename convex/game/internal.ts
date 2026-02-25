import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { advanceRoundPhase } from "./helpers/roundLifecycle";

export const advancePhaseOnTimer = internalMutation({
  args: {
    serverId: v.id("servers"),
    expectedNonce: v.number(),
  },
  handler: async (ctx, args) => {
    return await advanceRoundPhase(ctx, args.serverId, args.expectedNonce);
  },
});
