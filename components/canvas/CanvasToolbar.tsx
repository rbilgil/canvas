"use client";

import {
	Circle,
	LassoSelect,
	Minus,
	MousePointer,
	Pencil,
	RotateCw,
	Square,
	Type as TypeIcon,
	Undo2,
} from "lucide-react";
import { ToolbarButton } from "./ToolbarButton";
import type { Tool } from "./types";

export interface CanvasToolbarProps {
	tool: Tool;
	onToolChange: (tool: Tool) => void;
	onUndo?: () => void;
	onResetView?: () => void;
	canUndo?: boolean;
}

export function CanvasToolbar({
	tool,
	onToolChange,
	onUndo,
	onResetView,
	canUndo = false,
}: CanvasToolbarProps) {
	return (
		<div className="flex gap-1 p-2 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
			<ToolbarButton
				title="Select (V)"
				active={tool === "select"}
				onClick={() => onToolChange("select")}
			>
				<MousePointer className="w-4 h-4" />
			</ToolbarButton>
			<ToolbarButton
				title="Rectangle (R)"
				active={tool === "draw-rect"}
				onClick={() => onToolChange("draw-rect")}
			>
				<Square className="w-4 h-4" />
			</ToolbarButton>
			<ToolbarButton
				title="Ellipse (O)"
				active={tool === "draw-ellipse"}
				onClick={() => onToolChange("draw-ellipse")}
			>
				<Circle className="w-4 h-4" />
			</ToolbarButton>
			<ToolbarButton
				title="Line (L)"
				active={tool === "draw-line"}
				onClick={() => onToolChange("draw-line")}
			>
				<Minus className="w-4 h-4" />
			</ToolbarButton>
			<ToolbarButton
				title="Text (T)"
				active={tool === "draw-text"}
				onClick={() => onToolChange("draw-text")}
			>
				<TypeIcon className="w-4 h-4" />
			</ToolbarButton>
			<ToolbarButton
				title="Pencil (P)"
				active={tool === "draw-pencil"}
				onClick={() => onToolChange("draw-pencil")}
			>
				<Pencil className="w-4 h-4" />
			</ToolbarButton>
			<ToolbarButton
				title="Image Lasso"
				active={tool === "lasso"}
				onClick={() => onToolChange("lasso")}
			>
				<LassoSelect className="w-4 h-4" />
			</ToolbarButton>
			<div className="w-px h-6 bg-slate-300 dark:bg-slate-700 mx-1 self-center" />
			<ToolbarButton
				title="Undo (Ctrl+Z)"
				onClick={() => onUndo?.()}
				active={false}
			>
				<Undo2 className={`w-4 h-4 ${!canUndo ? "opacity-40" : ""}`} />
			</ToolbarButton>
			<ToolbarButton
				title="Reset view"
				onClick={() => onResetView?.()}
				active={false}
			>
				<RotateCw className="w-4 h-4" />
			</ToolbarButton>
		</div>
	);
}

