import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CanvasShape, TextShape } from "./types";

export function PropertiesPanel({
	selectedShape,
	setShapeById,
	setUndoSnapshot,
}: {
	selectedShape: CanvasShape | null;
	setShapeById: (id: string, updater: (s: CanvasShape) => CanvasShape) => void;
	setUndoSnapshot: (shapeId: string) => void;
}) {
	if (!selectedShape) return null;
	if (selectedShape.type === "text") {
		return (
			<div className="flex items-center gap-2 bg-white/90 dark:bg-slate-900/90 border border-slate-300 dark:border-slate-700 rounded px-2 py-1 shadow-sm">
				<span className="text-xs opacity-70">Font size</span>
				<Input
					type="number"
					min={8}
					max={200}
					value={(selectedShape as TextShape).fontSize}
					onChange={(e) => {
						setUndoSnapshot(selectedShape.id);
						setShapeById(selectedShape.id, (s) =>
							s.type === "text"
								? { ...s, fontSize: Number(e.target.value) || 12 }
								: s,
						);
					}}
					className="h-7 w-20"
				/>
				<Button
					type="button"
					variant="outline"
					className="h-7 px-2 text-xs"
					onClick={() => {
						const t = selectedShape as TextShape;
						const event = new CustomEvent("canvas:edit-text", {
							detail: {
								id: t.id,
								x: t.x,
								y: t.y,
								fontSize: t.fontSize,
								text: t.text,
							},
						});
						window.dispatchEvent(event);
					}}
				>
					Edit text
				</Button>
			</div>
		);
	}
	return null;
}
