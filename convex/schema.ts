import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  entries: defineTable({
    sessionId: v.string(),
    condition: v.optional(v.union(v.number(), v.null())),
    error_timing: v.optional(v.union(v.string(), v.null())),
    show_conf: v.boolean(),
    category: v.string(),
    field: v.string(),
    value: v.optional(v.any()),
    detail: v.optional(v.any()),
  }).index("by_session", ["sessionId"]),
});
