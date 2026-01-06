"use client";

import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, Loader2, Plus, X } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CanvasToolbar } from "@/components/canvas/CanvasToolbar";
import {
	DesignCanvas,
	type DesignCanvasRef,
	type DesignData,
} from "@/components/canvas/DesignCanvas";
import type { CanvasShape, Tool } from "@/components/canvas/types";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { parseDesignConfig } from "@/lib/design-config";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

export default function ProjectEditor() {
	const params = useParams();
	const router = useRouter();
	const projectId = params.projectId as Id<"projects">;

	const project = useQuery(api.projects.getProject, { projectId });
	const designs = useQuery(api.designs.getDesignsByProject, { projectId });
	const addDesign = useMutation(api.designs.addDesign);
	const deleteDesignMutation = useMutation(api.designs.deleteDesign);

	const [activeDesignId, setActiveDesignId] = useState<Id<"designs"> | null>(
		null,
	);
	const [addDialogOpen, setAddDialogOpen] = useState(false);
	const [newDesignName, setNewDesignName] = useState("Design");
	const [newDesignWidth, setNewDesignWidth] = useState("1280");
	const [newDesignHeight, setNewDesignHeight] = useState("720");
	const [isAdding, setIsAdding] = useState(false);

	// Shared tool state
	const [tool, setTool] = useState<Tool>("select");
	const [canUndo, setCanUndo] = useState(false);
	const [hasSelection, setHasSelection] = useState(false);

	const canvasRef = useRef<DesignCanvasRef>(null);

	// Set first design as active when designs load
	useEffect(() => {
		if (designs && designs.length > 0 && !activeDesignId) {
			setActiveDesignId(designs[0]._id);
		}
	}, [designs, activeDesignId]);

	// Handle undo stack changes from canvas
	const handleUndoStackChange = useCallback(
		(designId: string, hasUndo: boolean) => {
			if (designId === activeDesignId) {
				setCanUndo(hasUndo);
			}
		},
		[activeDesignId],
	);

	// Update canUndo when active design changes
	useEffect(() => {
		if (canvasRef.current && activeDesignId) {
			setCanUndo(canvasRef.current.canUndo());
		}
	}, [activeDesignId]);

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

	const handleUndo = useCallback(() => {
		canvasRef.current?.undo();
	}, []);

	const handleResetView = useCallback(() => {
		canvasRef.current?.resetView();
	}, []);

	const handleSelectionChange = useCallback((selected: boolean) => {
		setHasSelection(selected);
	}, []);

	const handleMoveUp = useCallback(() => {
		canvasRef.current?.moveSelectionUp();
	}, []);

	const handleMoveDown = useCallback(() => {
		canvasRef.current?.moveSelectionDown();
	}, []);

	const handleDelete = useCallback(() => {
		canvasRef.current?.deleteSelection();
	}, []);

	const handleDeleteDesign = useCallback(
		async (designId: Id<"designs">) => {
			if (!designs || designs.length <= 1) return; // Prevent deleting the last design

			// If deleting the active design, switch to another one first
			if (activeDesignId === designId) {
				const otherDesign = designs.find((d) => d._id !== designId);
				if (otherDesign) {
					setActiveDesignId(otherDesign._id);
				}
			}

			await deleteDesignMutation({ designId });
		},
		[designs, activeDesignId, deleteDesignMutation],
	);

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

	// Prepare design data for the canvas
	const designsData: DesignData[] = designs.map((design) => {
		const config = parseDesignConfig(design.config);
		return {
			id: design._id,
			name: design.name,
			width: design.width,
			height: design.height,
			initialShapes: config.shapes as CanvasShape[],
		};
	});

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
			{designs.length > 0 && (
				<div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 py-2 flex gap-2 overflow-x-auto">
					{designs.map((design) => (
						<div
							key={design._id}
							className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
								activeDesignId === design._id
									? "bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300"
									: "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
							}`}
						>
							<button
								type="button"
								onClick={() => setActiveDesignId(design._id)}
								className="flex items-center"
							>
								{design.name}
								<span className="ml-2 text-xs opacity-60">
									{design.width}×{design.height}
								</span>
							</button>
							{designs.length > 1 && (
								<button
									type="button"
									onClick={(e) => {
										e.stopPropagation();
										void handleDeleteDesign(design._id);
									}}
									className="ml-1 p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 hover:text-red-600 dark:hover:text-red-400 transition-colors"
									title="Delete design"
								>
									<X className="w-3.5 h-3.5" />
								</button>
							)}
						</div>
					))}
				</div>
			)}

			{/* Shared Toolbar */}
			<CanvasToolbar
				tool={tool}
				onToolChange={setTool}
				onUndo={handleUndo}
				onResetView={handleResetView}
				canUndo={canUndo}
				hasSelection={hasSelection}
				onMoveUp={handleMoveUp}
				onMoveDown={handleMoveDown}
				onDelete={handleDelete}
			/>

			{/* Canvas area - operations are saved directly via CRDT */}
			{designsData.length > 0 && (
				<DesignCanvas
					ref={canvasRef}
					designs={designsData}
					activeDesignId={activeDesignId}
					onActivate={(designId) =>
						setActiveDesignId(designId as Id<"designs">)
					}
					tool={tool}
					onToolChange={setTool}
					onUndoStackChange={handleUndoStackChange}
					onSelectionChange={handleSelectionChange}
				/>
			)}

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
							<label
								htmlFor="design-name"
								className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5 block"
							>
								Design Name
							</label>
							<Input
								id="design-name"
								value={newDesignName}
								onChange={(e) => setNewDesignName(e.target.value)}
								placeholder="Design name"
							/>
						</div>
						<div className="grid grid-cols-2 gap-4">
							<div>
								<label
									htmlFor="design-width"
									className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5 block"
								>
									Width (px)
								</label>
								<Input
									id="design-width"
									type="number"
									value={newDesignWidth}
									onChange={(e) => setNewDesignWidth(e.target.value)}
									min={1}
									max={4096}
								/>
							</div>
							<div>
								<label
									htmlFor="design-height"
									className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5 block"
								>
									Height (px)
								</label>
								<Input
									id="design-height"
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
