"use client";

import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
	Youtube,
	Share2,
	Monitor,
	Plus,
	Loader2,
	Trash2,
	FolderOpen,
} from "lucide-react";
import { api } from "../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
	DialogFooter,
} from "@/components/ui/dialog";
import { formatRelativeTime } from "@/lib/utils";
import type { Id } from "../../convex/_generated/dataModel";

type TemplateId = "youtube-thumbnail" | "social-media" | "website-design";

const TEMPLATES: Array<{
	id: TemplateId;
	name: string;
	description: string;
	dimensions: string;
	icon: React.ReactNode;
}> = [
	{
		id: "youtube-thumbnail",
		name: "YouTube Thumbnail",
		description: "Standard YouTube video thumbnail",
		dimensions: "1280 × 720",
		icon: <Youtube className="w-8 h-8" />,
	},
	{
		id: "social-media",
		name: "Social Media Post",
		description: "Square format for Instagram, Facebook",
		dimensions: "1080 × 1080",
		icon: <Share2 className="w-8 h-8" />,
	},
	{
		id: "website-design",
		name: "Website Design",
		description: "Desktop website mockup",
		dimensions: "1440 × 900",
		icon: <Monitor className="w-8 h-8" />,
	},
];

export default function AppDashboard() {
	const router = useRouter();
	const projects = useQuery(api.projects.listProjects);
	const createProject = useMutation(api.projects.createProject);
	const deleteProject = useMutation(api.projects.deleteProject);

	const [isCreating, setIsCreating] = useState(false);
	const [customDialogOpen, setCustomDialogOpen] = useState(false);
	const [customWidth, setCustomWidth] = useState("800");
	const [customHeight, setCustomHeight] = useState("600");
	const [projectName, setProjectName] = useState("Untitled Project");
	const [deletingId, setDeletingId] = useState<Id<"projects"> | null>(null);

	const handleCreateFromTemplate = async (templateId: TemplateId) => {
		if (isCreating) return;
		setIsCreating(true);
		try {
			const template = TEMPLATES.find((t) => t.id === templateId);
			const projectId = await createProject({
				name: template?.name ?? "New Project",
				templateId,
			});
			router.push(`/app/${projectId}`);
		} catch (error) {
			console.error("Failed to create project:", error);
			setIsCreating(false);
		}
	};

	const handleCreateCustom = async () => {
		if (isCreating) return;
		setIsCreating(true);
		try {
			const projectId = await createProject({
				name: projectName || "Untitled Project",
				customWidth: parseInt(customWidth) || 800,
				customHeight: parseInt(customHeight) || 600,
			});
			setCustomDialogOpen(false);
			router.push(`/app/${projectId}`);
		} catch (error) {
			console.error("Failed to create project:", error);
			setIsCreating(false);
		}
	};

	const handleDeleteProject = async (projectId: Id<"projects">) => {
		try {
			await deleteProject({ projectId });
		} catch (error) {
			console.error("Failed to delete project:", error);
		} finally {
			setDeletingId(null);
		}
	};

	return (
		<div className="min-h-screen bg-slate-50 dark:bg-slate-950">
			<div className="max-w-6xl mx-auto px-6 py-12">
				{/* Header */}
				<div className="mb-12">
					<h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
						Create a new design
					</h1>
					<p className="text-slate-600 dark:text-slate-400">
						Choose a template to get started or create a custom canvas
					</p>
				</div>

				{/* Templates Grid */}
				<div className="grid md:grid-cols-3 gap-6 mb-16">
					{TEMPLATES.map((template) => (
						<button
							key={template.id}
							onClick={() => handleCreateFromTemplate(template.id)}
							disabled={isCreating}
							className="group p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-violet-500 dark:hover:border-violet-500 hover:shadow-lg transition-all text-left disabled:opacity-50 disabled:cursor-not-allowed"
						>
							<div className="w-14 h-14 rounded-xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center mb-4 text-violet-600 dark:text-violet-400 group-hover:scale-110 transition-transform">
								{template.icon}
							</div>
							<h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
								{template.name}
							</h3>
							<p className="text-sm text-slate-600 dark:text-slate-400 mb-2">
								{template.description}
							</p>
							<p className="text-xs font-mono text-slate-500 dark:text-slate-500">
								{template.dimensions}
							</p>
						</button>
					))}

					{/* Custom Canvas Button */}
					<button
						onClick={() => setCustomDialogOpen(true)}
						disabled={isCreating}
						className="group p-6 rounded-xl bg-white dark:bg-slate-900 border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-violet-500 dark:hover:border-violet-500 transition-all text-left disabled:opacity-50 disabled:cursor-not-allowed"
					>
						<div className="w-14 h-14 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4 text-slate-500 dark:text-slate-400 group-hover:scale-110 transition-transform">
							<Plus className="w-8 h-8" />
						</div>
						<h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
							Custom Canvas
						</h3>
						<p className="text-sm text-slate-600 dark:text-slate-400 mb-2">
							Create with custom dimensions
						</p>
						<p className="text-xs font-mono text-slate-500 dark:text-slate-500">
							Any size
						</p>
					</button>
				</div>

				{/* Recent Projects */}
				{projects && projects.length > 0 && (
					<div>
						<h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-6">
							Recent Projects
						</h2>
						<div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
							{projects.map((project) => (
								<div
									key={project._id}
									className="group p-4 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 transition-all"
								>
									<div className="flex items-start justify-between mb-3">
										<div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500">
											<FolderOpen className="w-5 h-5" />
										</div>
										<button
											onClick={(e) => {
												e.stopPropagation();
												setDeletingId(project._id);
											}}
											className="opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400 transition-all"
										>
											<Trash2 className="w-4 h-4" />
										</button>
									</div>
									<h3 className="font-medium text-slate-900 dark:text-white mb-1 truncate">
										{project.name}
									</h3>
									<p className="text-xs text-slate-500 dark:text-slate-500">
										{formatRelativeTime(project.updatedAt)}
									</p>
									<Button
										variant="ghost"
										size="sm"
										className="mt-3 w-full"
										onClick={() => router.push(`/app/${project._id}`)}
									>
										Open
									</Button>
								</div>
							))}
						</div>
					</div>
				)}

				{/* Loading state */}
				{projects === undefined && (
					<div className="flex items-center justify-center py-12">
						<Loader2 className="w-6 h-6 animate-spin text-slate-400" />
					</div>
				)}
			</div>

			{/* Custom Canvas Dialog */}
			<Dialog open={customDialogOpen} onOpenChange={setCustomDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Create Custom Canvas</DialogTitle>
						<DialogDescription>
							Set your canvas dimensions and project name
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-4 py-4">
						<div>
							<label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5 block">
								Project Name
							</label>
							<Input
								value={projectName}
								onChange={(e) => setProjectName(e.target.value)}
								placeholder="My Project"
							/>
						</div>
						<div className="grid grid-cols-2 gap-4">
							<div>
								<label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5 block">
									Width (px)
								</label>
								<Input
									type="number"
									value={customWidth}
									onChange={(e) => setCustomWidth(e.target.value)}
									min={1}
									max={4096}
								/>
							</div>
							<div>
								<label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5 block">
									Height (px)
								</label>
								<Input
									type="number"
									value={customHeight}
									onChange={(e) => setCustomHeight(e.target.value)}
									min={1}
									max={4096}
								/>
							</div>
						</div>
					</div>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => setCustomDialogOpen(false)}
							disabled={isCreating}
						>
							Cancel
						</Button>
						<Button onClick={handleCreateCustom} disabled={isCreating}>
							{isCreating ? (
								<>
									<Loader2 className="w-4 h-4 animate-spin mr-2" />
									Creating...
								</>
							) : (
								"Create Canvas"
							)}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Delete Confirmation Dialog */}
			<Dialog open={deletingId !== null} onOpenChange={() => setDeletingId(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete Project</DialogTitle>
						<DialogDescription>
							Are you sure you want to delete this project? This action cannot be
							undone.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setDeletingId(null)}>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={() => deletingId && handleDeleteProject(deletingId)}
						>
							Delete
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
