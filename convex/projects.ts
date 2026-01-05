import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Template definitions with default dimensions
export const TEMPLATES = {
	"youtube-thumbnail": {
		name: "YouTube Thumbnail",
		width: 1280,
		height: 720,
	},
	"social-media": {
		name: "Social Media Post",
		width: 1080,
		height: 1080,
	},
	"website-design": {
		name: "Website Design",
		width: 1440,
		height: 900,
	},
} as const;

export type TemplateId = keyof typeof TEMPLATES;

// Create a new project with an initial design
export const createProject = mutation({
	args: {
		name: v.string(),
		templateId: v.optional(
			v.union(
				v.literal("youtube-thumbnail"),
				v.literal("social-media"),
				v.literal("website-design"),
			),
		),
		// For custom canvas, allow specifying dimensions
		customWidth: v.optional(v.number()),
		customHeight: v.optional(v.number()),
	},
	returns: v.id("projects"),
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			throw new Error("Not authenticated");
		}

		const now = Date.now();

		// Determine dimensions
		let width = args.customWidth ?? 800;
		let height = args.customHeight ?? 600;
		let designName = "Design 1";

		if (args.templateId) {
			const template = TEMPLATES[args.templateId];
			width = template.width;
			height = template.height;
			designName = template.name;
		}

		// Create the project
		const projectId = await ctx.db.insert("projects", {
			userId: identity.subject,
			name: args.name,
			templateId: args.templateId,
			createdAt: now,
			updatedAt: now,
		});

		// Create the initial design
		await ctx.db.insert("designs", {
			projectId,
			name: designName,
			width,
			height,
			config: { shapes: [] },
			createdAt: now,
			updatedAt: now,
		});

		return projectId;
	},
});

// Get a project by ID
export const getProject = query({
	args: { projectId: v.id("projects") },
	returns: v.union(
		v.object({
			_id: v.id("projects"),
			_creationTime: v.number(),
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
		}),
		v.null(),
	),
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			return null;
		}

		const project = await ctx.db.get(args.projectId);
		if (!project || project.userId !== identity.subject) {
			return null;
		}

		return project;
	},
});

// List all projects for the current user
export const listProjects = query({
	args: {},
	returns: v.array(
		v.object({
			_id: v.id("projects"),
			_creationTime: v.number(),
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
		}),
	),
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			return [];
		}

		return await ctx.db
			.query("projects")
			.withIndex("by_user", (q) => q.eq("userId", identity.subject))
			.order("desc")
			.collect();
	},
});

// Delete a project and all its designs
export const deleteProject = mutation({
	args: { projectId: v.id("projects") },
	returns: v.null(),
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			throw new Error("Not authenticated");
		}

		const project = await ctx.db.get(args.projectId);
		if (!project || project.userId !== identity.subject) {
			throw new Error("Project not found");
		}

		// Delete all designs for this project
		const designs = await ctx.db
			.query("designs")
			.withIndex("by_project", (q) => q.eq("projectId", args.projectId))
			.collect();

		for (const design of designs) {
			await ctx.db.delete(design._id);
		}

		// Delete the project
		await ctx.db.delete(args.projectId);

		return null;
	},
});
