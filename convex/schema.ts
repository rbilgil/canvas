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
	// Following pattern from: https://stack.convex.dev/automerge-and-convex
	// Uses _creationTime for ordering (Convex-managed, more robust than custom timestamps)
	designOperations: defineTable({
		designId: v.id("designs"),
		clientId: v.string(), // Unique ID for each client session (like Automerge's "actor")
		operationId: v.string(), // Unique ID for each operation (for deduplication/idempotency)
		operation: v.string(), // JSON-serialized operation (our CRDT changes)
		clientTimestamp: v.number(), // Client's local timestamp (for debugging/ordering hints)
	})
		.index("by_design", ["designId"]) // For querying all ops, ordered by _creationTime
		.index("by_operation_id", ["designId", "operationId"]), // For deduplication
});
