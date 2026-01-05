import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Apply a single operation to a design
export const applyOperation = mutation({
	args: {
		designId: v.id("designs"),
		clientId: v.string(),
		operationId: v.string(),
		operation: v.string(), // JSON-serialized operation
		timestamp: v.number(),
	},
	returns: v.object({
		success: v.boolean(),
		serverTimestamp: v.number(),
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

		// Check for duplicate operation (idempotency)
		const existing = await ctx.db
			.query("designOperations")
			.withIndex("by_operation_id", (q) =>
				q.eq("designId", args.designId).eq("operationId", args.operationId),
			)
			.first();

		if (existing) {
			return {
				success: true,
				serverTimestamp: existing.serverTimestamp,
				isDuplicate: true,
			};
		}

		const serverTimestamp = Date.now();

		// Store the operation
		await ctx.db.insert("designOperations", {
			designId: args.designId,
			clientId: args.clientId,
			operationId: args.operationId,
			operation: args.operation,
			timestamp: args.timestamp,
			serverTimestamp,
		});

		// Update design's updatedAt
		await ctx.db.patch(args.designId, { updatedAt: serverTimestamp });
		await ctx.db.patch(design.projectId, { updatedAt: serverTimestamp });

		return {
			success: true,
			serverTimestamp,
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
		serverTimestamp: v.number(),
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

		const serverTimestamp = Date.now();
		let appliedCount = 0;

		for (const op of args.operations) {
			// Check for duplicate
			const existing = await ctx.db
				.query("designOperations")
				.withIndex("by_operation_id", (q) =>
					q.eq("designId", args.designId).eq("operationId", op.operationId),
				)
				.first();

			if (!existing) {
				await ctx.db.insert("designOperations", {
					designId: args.designId,
					clientId: args.clientId,
					operationId: op.operationId,
					operation: op.operation,
					timestamp: op.timestamp,
					serverTimestamp: serverTimestamp + appliedCount, // Ensure ordering
				});
				appliedCount++;
			}
		}

		if (appliedCount > 0) {
			await ctx.db.patch(args.designId, { updatedAt: serverTimestamp });
			await ctx.db.patch(design.projectId, { updatedAt: serverTimestamp });
		}

		return {
			success: true,
			serverTimestamp,
			appliedCount,
		};
	},
});

// Get operations for a design since a given timestamp
export const getOperationsSince = query({
	args: {
		designId: v.id("designs"),
		sinceTimestamp: v.number(),
		excludeClientId: v.optional(v.string()), // Exclude operations from this client
	},
	returns: v.array(
		v.object({
			operationId: v.string(),
			operation: v.string(),
			clientId: v.string(),
			timestamp: v.number(),
			serverTimestamp: v.number(),
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

		const operations = await ctx.db
			.query("designOperations")
			.withIndex("by_design_after", (q) =>
				q.eq("designId", args.designId).gt("serverTimestamp", args.sinceTimestamp),
			)
			.collect();

		// Filter out operations from the requesting client if specified
		const filtered = args.excludeClientId
			? operations.filter((op) => op.clientId !== args.excludeClientId)
			: operations;

		return filtered.map((op) => ({
			operationId: op.operationId,
			operation: op.operation,
			clientId: op.clientId,
			timestamp: op.timestamp,
			serverTimestamp: op.serverTimestamp,
		}));
	},
});

// Get all operations for a design (for initial load)
export const getAllOperations = query({
	args: {
		designId: v.id("designs"),
	},
	returns: v.array(
		v.object({
			operationId: v.string(),
			operation: v.string(),
			clientId: v.string(),
			timestamp: v.number(),
			serverTimestamp: v.number(),
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

		const operations = await ctx.db
			.query("designOperations")
			.withIndex("by_design", (q) => q.eq("designId", args.designId))
			.collect();

		return operations.map((op) => ({
			operationId: op.operationId,
			operation: op.operation,
			clientId: op.clientId,
			timestamp: op.timestamp,
			serverTimestamp: op.serverTimestamp,
		}));
	},
});

// Get the latest server timestamp for a design
export const getLatestTimestamp = query({
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

		const latest = await ctx.db
			.query("designOperations")
			.withIndex("by_design", (q) => q.eq("designId", args.designId))
			.order("desc")
			.first();

		return latest?.serverTimestamp ?? 0;
	},
});

