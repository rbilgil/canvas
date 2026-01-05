/**
 * CRDT Operations for Canvas Designs
 *
 * Following the pattern from: https://stack.convex.dev/automerge-and-convex
 *
 * Key principles:
 * - Use _creationTime for ordering (Convex-managed, robust)
 * - Operations are idempotent (deduplicated by operationId)
 * - Clients track the last _creationTime they've seen
 * - Sync only fetches changes since that timestamp
 */

import { v } from "convex/values";
import { parseOperation } from "../lib/schemas/canvas-operations";
import { mutation, query } from "./_generated/server";

/**
 * Validate an operation JSON string.
 * Throws if the operation is invalid.
 */
function validateOperation(operationJson: string): void {
	const parsed = JSON.parse(operationJson);
	parseOperation(parsed); // Throws ZodError if invalid
}

// Apply a single operation to a design
export const applyOperation = mutation({
	args: {
		designId: v.id("designs"),
		clientId: v.string(),
		operationId: v.string(),
		operation: v.string(), // JSON-serialized operation
		clientTimestamp: v.number(),
	},
	returns: v.object({
		success: v.boolean(),
		creationTime: v.number(),
		isDuplicate: v.boolean(),
	}),
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			throw new Error("Not authenticated");
		}

		// Verify the design exists and user has access
		const design = await ctx.db.get(args.designId);
		if (!design) {
			throw new Error("Design not found");
		}

		const project = await ctx.db.get(design.projectId);
		if (!project || project.userId !== identity.subject) {
			throw new Error("Design not found");
		}

		// Validate the operation before storing
		// This ensures only well-formed operations are persisted
		validateOperation(args.operation);

		// Check for duplicate operation (idempotency)
		// This is critical for CRDT correctness - operations must be safely re-applicable
		const existing = await ctx.db
			.query("designOperations")
			.withIndex("by_operation_id", (q) =>
				q.eq("designId", args.designId).eq("operationId", args.operationId),
			)
			.first();

		if (existing) {
			return {
				success: true,
				creationTime: existing._creationTime,
				isDuplicate: true,
			};
		}

		// Store the operation - _creationTime is automatically set by Convex
		const docId = await ctx.db.insert("designOperations", {
			designId: args.designId,
			clientId: args.clientId,
			operationId: args.operationId,
			operation: args.operation,
			clientTimestamp: args.clientTimestamp,
		});

		// Get the created document to return its _creationTime
		const created = await ctx.db.get(docId);

		// Update design's updatedAt
		const now = Date.now();
		await ctx.db.patch(args.designId, { updatedAt: now });
		await ctx.db.patch(design.projectId, { updatedAt: now });

		return {
			success: true,
			creationTime: created?._creationTime ?? now,
			isDuplicate: false,
		};
	},
});

// Apply multiple operations at once (for batching)
export const applyOperations = mutation({
	args: {
		designId: v.id("designs"),
		clientId: v.string(),
		operations: v.array(
			v.object({
				operationId: v.string(),
				operation: v.string(),
				timestamp: v.number(),
			}),
		),
	},
	returns: v.object({
		success: v.boolean(),
		lastCreationTime: v.number(),
		appliedCount: v.number(),
	}),
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			throw new Error("Not authenticated");
		}

		// Verify the design exists and user has access
		const design = await ctx.db.get(args.designId);
		if (!design) {
			throw new Error("Design not found");
		}

		const project = await ctx.db.get(design.projectId);
		if (!project || project.userId !== identity.subject) {
			throw new Error("Design not found");
		}

		let appliedCount = 0;
		let lastCreationTime = 0;

		for (const op of args.operations) {
			// Validate each operation before storing
			validateOperation(op.operation);

			// Check for duplicate (idempotency)
			const existing = await ctx.db
				.query("designOperations")
				.withIndex("by_operation_id", (q) =>
					q.eq("designId", args.designId).eq("operationId", op.operationId),
				)
				.first();

			if (!existing) {
				const docId = await ctx.db.insert("designOperations", {
					designId: args.designId,
					clientId: args.clientId,
					operationId: op.operationId,
					operation: op.operation,
					clientTimestamp: op.timestamp,
				});
				const created = await ctx.db.get(docId);
				if (created) {
					lastCreationTime = Math.max(lastCreationTime, created._creationTime);
				}
				appliedCount++;
			} else {
				lastCreationTime = Math.max(lastCreationTime, existing._creationTime);
			}
		}

		if (appliedCount > 0) {
			const now = Date.now();
			await ctx.db.patch(args.designId, { updatedAt: now });
			await ctx.db.patch(design.projectId, { updatedAt: now });
		}

		return {
			success: true,
			lastCreationTime,
			appliedCount,
		};
	},
});

// Get operations for a design since a given _creationTime
// Following the article's pattern: query by _creationTime for sync
// Note: As mentioned in the article, there's an edge case where mutations
// running around the same time might insert slightly out of order.
// We handle this by fetching a small buffer before the requested timestamp.
export const getOperationsSince = query({
	args: {
		designId: v.id("designs"),
		sinceCreationTime: v.number(),
		excludeClientId: v.optional(v.string()), // Exclude operations from this client
	},
	returns: v.array(
		v.object({
			operationId: v.string(),
			operation: v.string(),
			clientId: v.string(),
			clientTimestamp: v.number(),
			creationTime: v.number(),
		}),
	),
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			return [];
		}

		// Verify access
		const design = await ctx.db.get(args.designId);
		if (!design) {
			return [];
		}

		const project = await ctx.db.get(design.projectId);
		if (!project || project.userId !== identity.subject) {
			return [];
		}

		// Query operations for this design, ordered by _creationTime
		// Per the article: we add a small buffer (100ms) to handle edge cases
		// where mutations running concurrently might insert slightly out of order
		const bufferMs = 100;
		const queryFrom = Math.max(0, args.sinceCreationTime - bufferMs);

		const operations = await ctx.db
			.query("designOperations")
			.withIndex("by_design", (q) => q.eq("designId", args.designId))
			.filter((q) => q.gt(q.field("_creationTime"), queryFrom))
			.collect();

		// Filter out operations from the requesting client if specified
		// and filter to only include operations after the actual requested time
		const filtered = operations.filter((op) => {
			if (args.excludeClientId && op.clientId === args.excludeClientId) {
				return false;
			}
			// Only include if actually after the requested time (not in the buffer zone)
			// unless we haven't seen it before
			return op._creationTime > args.sinceCreationTime;
		});

		return filtered.map((op) => ({
			operationId: op.operationId,
			operation: op.operation,
			clientId: op.clientId,
			clientTimestamp: op.clientTimestamp,
			creationTime: op._creationTime,
		}));
	},
});

// Get all operations for a design (for initial load)
// This replays the full history to reconstruct the current state
export const getAllOperations = query({
	args: {
		designId: v.id("designs"),
	},
	returns: v.array(
		v.object({
			operationId: v.string(),
			operation: v.string(),
			clientId: v.string(),
			clientTimestamp: v.number(),
			creationTime: v.number(),
		}),
	),
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			return [];
		}

		// Verify access
		const design = await ctx.db.get(args.designId);
		if (!design) {
			return [];
		}

		const project = await ctx.db.get(design.projectId);
		if (!project || project.userId !== identity.subject) {
			return [];
		}

		// Get all operations ordered by _creationTime (implicit ordering)
		const operations = await ctx.db
			.query("designOperations")
			.withIndex("by_design", (q) => q.eq("designId", args.designId))
			.collect();

		return operations.map((op) => ({
			operationId: op.operationId,
			operation: op.operation,
			clientId: op.clientId,
			clientTimestamp: op.clientTimestamp,
			creationTime: op._creationTime,
		}));
	},
});

// Get the latest _creationTime for a design's operations
// Used by clients to initialize their sync cursor
export const getLatestCreationTime = query({
	args: {
		designId: v.id("designs"),
	},
	returns: v.number(),
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			return 0;
		}

		const design = await ctx.db.get(args.designId);
		if (!design) {
			return 0;
		}

		const project = await ctx.db.get(design.projectId);
		if (!project || project.userId !== identity.subject) {
			return 0;
		}

		// Get the most recent operation
		const latest = await ctx.db
			.query("designOperations")
			.withIndex("by_design", (q) => q.eq("designId", args.designId))
			.order("desc")
			.first();

		return latest?._creationTime ?? 0;
	},
});
