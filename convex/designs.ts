import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Get all designs for a project
export const getDesignsByProject = query({
	args: { projectId: v.id("projects") },
	returns: v.array(
		v.object({
			_id: v.id("designs"),
			_creationTime: v.number(),
			projectId: v.id("projects"),
			name: v.string(),
			width: v.number(),
			height: v.number(),
			config: v.any(),
			createdAt: v.number(),
			updatedAt: v.number(),
		}),
	),
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			return [];
		}

		// Verify the user owns this project
		const project = await ctx.db.get(args.projectId);
		if (!project || project.userId !== identity.subject) {
			return [];
		}

		return await ctx.db
			.query("designs")
			.withIndex("by_project", (q) => q.eq("projectId", args.projectId))
			.collect();
	},
});

// Get a single design by ID
export const getDesign = query({
	args: { designId: v.id("designs") },
	returns: v.union(
		v.object({
			_id: v.id("designs"),
			_creationTime: v.number(),
			projectId: v.id("projects"),
			name: v.string(),
			width: v.number(),
			height: v.number(),
			config: v.any(),
			createdAt: v.number(),
			updatedAt: v.number(),
		}),
		v.null(),
	),
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			return null;
		}

		const design = await ctx.db.get(args.designId);
		if (!design) {
			return null;
		}

		// Verify the user owns the parent project
		const project = await ctx.db.get(design.projectId);
		if (!project || project.userId !== identity.subject) {
			return null;
		}

		return design;
	},
});

// Add a new design to a project
export const addDesign = mutation({
	args: {
		projectId: v.id("projects"),
		name: v.string(),
		width: v.number(),
		height: v.number(),
	},
	returns: v.id("designs"),
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			throw new Error("Not authenticated");
		}

		// Verify the user owns this project
		const project = await ctx.db.get(args.projectId);
		if (!project || project.userId !== identity.subject) {
			throw new Error("Project not found");
		}

		const now = Date.now();

		const designId = await ctx.db.insert("designs", {
			projectId: args.projectId,
			name: args.name,
			width: args.width,
			height: args.height,
			config: { shapes: [] },
			createdAt: now,
			updatedAt: now,
		});

		// Update project's updatedAt
		await ctx.db.patch(args.projectId, { updatedAt: now });

		return designId;
	},
});

// Update a design's config (shapes, etc.)
export const updateDesignConfig = mutation({
	args: {
		designId: v.id("designs"),
		config: v.any(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			throw new Error("Not authenticated");
		}

		const design = await ctx.db.get(args.designId);
		if (!design) {
			throw new Error("Design not found");
		}

		// Verify the user owns the parent project
		const project = await ctx.db.get(design.projectId);
		if (!project || project.userId !== identity.subject) {
			throw new Error("Design not found");
		}

		const now = Date.now();

		await ctx.db.patch(args.designId, {
			config: args.config,
			updatedAt: now,
		});

		// Update project's updatedAt
		await ctx.db.patch(design.projectId, { updatedAt: now });

		return null;
	},
});

// Update design dimensions
export const updateDesignDimensions = mutation({
	args: {
		designId: v.id("designs"),
		width: v.number(),
		height: v.number(),
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			throw new Error("Not authenticated");
		}

		const design = await ctx.db.get(args.designId);
		if (!design) {
			throw new Error("Design not found");
		}

		// Verify the user owns the parent project
		const project = await ctx.db.get(design.projectId);
		if (!project || project.userId !== identity.subject) {
			throw new Error("Design not found");
		}

		const now = Date.now();

		await ctx.db.patch(args.designId, {
			width: args.width,
			height: args.height,
			updatedAt: now,
		});

		await ctx.db.patch(design.projectId, { updatedAt: now });

		return null;
	},
});

// Add a new design with an initial image shape (using storage URL)
export const addDesignWithImage = mutation({
	args: {
		projectId: v.id("projects"),
		name: v.string(),
		width: v.number(),
		height: v.number(),
		imageUrl: v.string(), // Storage URL for the image
	},
	returns: v.id("designs"),
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			throw new Error("Not authenticated");
		}

		// Verify the user owns this project
		const project = await ctx.db.get(args.projectId);
		if (!project || project.userId !== identity.subject) {
			throw new Error("Project not found");
		}

		const now = Date.now();

		// Create image shape with the storage URL
		const imageShape = {
			id: `img_${now}_${Math.random().toString(36).slice(2, 9)}`,
			type: "image" as const,
			x: 0,
			y: 0,
			width: args.width,
			height: args.height,
			href: args.imageUrl,
		};

		const designId = await ctx.db.insert("designs", {
			projectId: args.projectId,
			name: args.name,
			width: args.width,
			height: args.height,
			config: { shapes: [imageShape] },
			createdAt: now,
			updatedAt: now,
		});

		// Update project's updatedAt
		await ctx.db.patch(args.projectId, { updatedAt: now });

		return designId;
	},
});

// Delete a design
export const deleteDesign = mutation({
	args: { designId: v.id("designs") },
	returns: v.null(),
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			throw new Error("Not authenticated");
		}

		const design = await ctx.db.get(args.designId);
		if (!design) {
			throw new Error("Design not found");
		}

		// Verify the user owns the parent project
		const project = await ctx.db.get(design.projectId);
		if (!project || project.userId !== identity.subject) {
			throw new Error("Design not found");
		}

		await ctx.db.delete(args.designId);

		// Update project's updatedAt
		await ctx.db.patch(design.projectId, { updatedAt: Date.now() });

		return null;
	},
});
