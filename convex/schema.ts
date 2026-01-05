import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
	projects: defineTable({
		userId: v.string(),
		name: v.string(),
		templateId: v.optional(
			v.union(
				v.literal("youtube-thumbnail"),
				v.literal("social-media"),
				v.literal("website-design"),
			),
		),
		createdAt: v.number(),
		updatedAt: v.number(),
	}).index("by_user", ["userId"]),

	designs: defineTable({
		projectId: v.id("projects"),
		name: v.string(),
		width: v.number(),
		height: v.number(),
		config: v.any(), // JSON document validated with Zod on the client
		createdAt: v.number(),
		updatedAt: v.number(),
	}).index("by_project", ["projectId"]),
});
