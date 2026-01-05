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

	// CRDT operation log for each design
	// Operations are stored in order and can be replayed to reconstruct state
	designOperations: defineTable({
		designId: v.id("designs"),
		clientId: v.string(), // Unique ID for each client session
		operationId: v.string(), // Unique ID for each operation (for deduplication)
		operation: v.string(), // JSON-serialized operation
		timestamp: v.number(), // Client timestamp
		serverTimestamp: v.number(), // Server timestamp for ordering
	})
		.index("by_design", ["designId", "serverTimestamp"])
		.index("by_design_after", ["designId", "serverTimestamp"])
		.index("by_operation_id", ["designId", "operationId"]),
});
