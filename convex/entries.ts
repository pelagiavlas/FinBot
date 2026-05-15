import { mutation } from "./_generated/server";
import { v } from "convex/values";

const entryArgs = {
  sessionId: v.string(),
  condition: v.optional(v.union(v.number(), v.null())),
  error_timing: v.optional(v.union(v.string(), v.null())),
  show_conf: v.boolean(),
  category: v.string(),
  field: v.string(),
  value: v.optional(v.any()),
  detail: v.optional(v.any()),
  /** Alias από το υπάρχον frontend (experimental_condition) */
  experimental_condition: v.optional(v.union(v.number(), v.null())),
};

/** Αποθηκεύει μία απάντηση FinBot στον πίνακα entries */
export const insert = mutation({
  args: entryArgs,
  handler: async (ctx, args) => {
    const condition =
      args.condition !== undefined && args.condition !== null
        ? args.condition
        : args.experimental_condition ?? undefined;

    return await ctx.db.insert("entries", {
      sessionId: args.sessionId,
      condition,
      error_timing: args.error_timing ?? undefined,
      show_conf: args.show_conf,
      category: args.category,
      field: args.field,
      value: args.value,
      detail: args.detail,
    });
  },
});
