"use client";

import { useMutation, useQuery } from "convex/react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Loader2, Plus } from "lucide-react";
import Link from "next/link";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
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
import {
	DesignCanvas,
	type DesignCanvasRef,
} from "@/components/canvas/DesignCanvas";
import { parseDesignConfig } from "@/lib/design-config";
import type { CanvasShape } from "@/components/canvas/types";

export default function ProjectEditor() {
	const params = useParams();
	const router = useRouter();
	const projectId = params.projectId as Id<"projects">;

	const project = useQuery(api.projects.getProject, { projectId });
	const designs = useQuery(api.designs.getDesignsByProject, { projectId });
	const updateDesignConfig = useMutation(api.designs.updateDesignConfig);
	const addDesign = useMutation(api.designs.addDesign);

	const [activeDesignId, setActiveDesignId] = useState<Id<"designs"> | null>(
		null,
	);
	const [addDialogOpen, setAddDialogOpen] = useState(false);
	const [newDesignName, setNewDesignName] = useState("Design");
	const [newDesignWidth, setNewDesignWidth] = useState("1280");
	const [newDesignHeight, setNewDesignHeight] = useState("720");
	const [isAdding, setIsAdding] = useState(false);

	// Track pending changes per design for debounced saving
	const pendingChangesRef = useRef<Map<string, CanvasShape[]>>(new Map());
	const saveTimerRef = useRef<Map<string, number>>(new Map());
	const canvasRefs = useRef<Map<string, DesignCanvasRef>>(new Map());

	// Set first design as active when designs load
	useEffect(() => {
		if (designs && designs.length > 0 && !activeDesignId) {
			setActiveDesignId(designs[0]._id);
		}
	}, [designs, activeDesignId]);

	// Debounced save handler
	const handleShapesChange = useCallback(
		(designId: Id<"designs">, shapes: CanvasShape[]) => {
			pendingChangesRef.current.set(designId, shapes);

			// Clear existing timer for this design
			const existingTimer = saveTimerRef.current.get(designId);
			if (existingTimer) {
				window.clearTimeout(existingTimer);
			}

			// Set new timer
			const timer = window.setTimeout(() => {
				const shapesToSave = pendingChangesRef.current.get(designId);
				if (shapesToSave) {
					void updateDesignConfig({
						designId,
						config: { shapes: shapesToSave },
					});
					pendingChangesRef.current.delete(designId);
				}
				saveTimerRef.current.delete(designId);
			}, 1000);

			saveTimerRef.current.set(designId, timer);
		},
		[updateDesignConfig],
	);

	// Cleanup timers on unmount
	useEffect(() => {
		return () => {
			saveTimerRef.current.forEach((timer) => window.clearTimeout(timer));
		};
	}, []);

	const handleAddDesign = async () => {
		if (isAdding) return;
		setIsAdding(true);
		try {
			const designId = await addDesign({
				projectId,
				name: newDesignName || "Design",
				width: parseInt(newDesignWidth) || 1280,
				height: parseInt(newDesignHeight) || 720,
			});
			setAddDialogOpen(false);
			setActiveDesignId(designId);
			setNewDesignName("Design");
			setNewDesignWidth("1280");
			setNewDesignHeight("720");
		} catch (error) {
			console.error("Failed to add design:", error);
		} finally {
			setIsAdding(false);
		}
	};

	// Loading state
	if (project === undefined || designs === undefined) {
		return (
			<div className="min-h-screen bg-slate-100 dark:bg-slate-950 flex items-center justify-center">
				<Loader2 className="w-8 h-8 animate-spin text-slate-400" />
			</div>
		);
	}

	// Not found state
	if (project === null) {
		return (
			<div className="min-h-screen bg-slate-100 dark:bg-slate-950 flex flex-col items-center justify-center gap-4">
				<h1 className="text-2xl font-semibold text-slate-900 dark:text-white">
					Project not found
				</h1>
				<p className="text-slate-600 dark:text-slate-400">
					This project doesn&apos;t exist or you don&apos;t have access to it.
				</p>
				<Button onClick={() => router.push("/app")}>Go to Dashboard</Button>
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-slate-100 dark:bg-slate-950 flex flex-col">
			{/* Header */}
			<header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 py-3 flex items-center gap-4">
				<Link
					href="/app"
					className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
				>
					<ArrowLeft className="w-5 h-5 text-slate-600 dark:text-slate-400" />
				</Link>
				<div className="flex-1">
					<h1 className="font-semibold text-slate-900 dark:text-white">
						{project.name}
					</h1>
					<p className="text-xs text-slate-500">
						{designs.length} design{designs.length !== 1 ? "s" : ""}
					</p>
				</div>
				<Button
					variant="outline"
					size="sm"
					onClick={() => setAddDialogOpen(true)}
				>
					<Plus className="w-4 h-4 mr-1" />
					Add Design
				</Button>
			</header>

			{/* Design tabs */}
			{designs.length > 1 && (
				<div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 py-2 flex gap-2 overflow-x-auto">
					{designs.map((design) => (
						<button
							key={design._id}
							onClick={() => setActiveDesignId(design._id)}
							className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
								activeDesignId === design._id
									? "bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300"
									: "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
							}`}
						>
							{design.name}
							<span className="ml-2 text-xs opacity-60">
								{design.width}×{design.height}
							</span>
						</button>
					))}
				</div>
			)}

			{/* Canvas area with horizontal scroll */}
			<div className="flex-1 overflow-x-auto overflow-y-hidden p-6">
				<div className="flex gap-6 min-w-min">
					{designs.map((design) => {
						const config = parseDesignConfig(design.config);
						return (
							<div
								key={design._id}
								className={`flex-shrink-0 ${
									activeDesignId === design._id ? "" : "opacity-60"
								}`}
							>
								<div className="mb-2 flex items-center gap-2">
									<span className="text-sm font-medium text-slate-700 dark:text-slate-300">
										{design.name}
									</span>
									<span className="text-xs text-slate-500">
										{design.width} × {design.height}
									</span>
								</div>
								<DesignCanvas
									ref={(ref) => {
										if (ref) {
											canvasRefs.current.set(design._id, ref);
										} else {
											canvasRefs.current.delete(design._id);
										}
									}}
									designId={design._id}
									width={design.width}
									height={design.height}
									initialShapes={config.shapes as CanvasShape[]}
									onShapesChange={(shapes) =>
										handleShapesChange(design._id, shapes)
									}
									isActive={activeDesignId === design._id}
									onActivate={() => setActiveDesignId(design._id)}
								/>
							</div>
						);
					})}
				</div>
			</div>

			{/* Add Design Dialog */}
			<Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Add New Design</DialogTitle>
						<DialogDescription>
							Create a new design canvas for this project
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-4 py-4">
						<div>
							<label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5 block">
								Design Name
							</label>
							<Input
								value={newDesignName}
								onChange={(e) => setNewDesignName(e.target.value)}
								placeholder="Design name"
							/>
						</div>
						<div className="grid grid-cols-2 gap-4">
							<div>
								<label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5 block">
									Width (px)
								</label>
								<Input
									type="number"
									value={newDesignWidth}
									onChange={(e) => setNewDesignWidth(e.target.value)}
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
									value={newDesignHeight}
									onChange={(e) => setNewDesignHeight(e.target.value)}
									min={1}
									max={4096}
								/>
							</div>
						</div>
					</div>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => setAddDialogOpen(false)}
							disabled={isAdding}
						>
							Cancel
						</Button>
						<Button onClick={handleAddDesign} disabled={isAdding}>
							{isAdding ? (
								<>
									<Loader2 className="w-4 h-4 animate-spin mr-2" />
									Adding...
								</>
							) : (
								"Add Design"
							)}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
