import type {
	AnyCommand,
	CanvasShape,
	EllipseShape,
	LineShape,
	RectShape,
	SvgShape,
	TextShape,
} from "./types";

// Helper type for shapes with width/height
type SizedShape = RectShape | EllipseShape | SvgShape | { type: "image"; width: number; height: number };

function isSizedShape(s: CanvasShape): s is CanvasShape & { width: number; height: number } {
	return "width" in s && "height" in s;
}

function isRectShape(s: CanvasShape): s is RectShape {
	return s.type === "rect";
}

export function applyCommandsToState(
	prev: CanvasShape[],
	commands: Array<AnyCommand>,
	selectedId: string | null,
): CanvasShape[] {
	const selectId = (cmdId?: string): string | null => cmdId || selectedId;
	let next = prev.slice();
	for (const cmd of commands) {
		if (cmd.tool === "generateSvg") {
			if (!cmd.svg) continue;
			const id = cmd.id || `svg_${Date.now()}`;
			const newShape: SvgShape = {
				id,
				type: "svg",
				x: cmd.x ?? 40,
				y: cmd.y ?? 40,
				width: cmd.width ?? 200,
				height: cmd.height ?? 200,
				svg: cmd.svg,
				stroke: undefined,
				fill: undefined,
			};
			next = [...next, newShape];
			continue;
		}
		if (cmd.tool === "replaceShape") {
			const shape = cmd.shape;
			next = next.map((s) => (s.id === shape.id ? shape : s));
			if (!next.find((s) => s.id === shape.id)) next = [...next, shape];
			continue;
		}
		if (cmd.tool === "deleteObject") {
			next = next.filter((s) => s.id !== cmd.id);
			continue;
		}
		if (cmd.tool === "editShape") {
			const id = selectId(cmd.id);
			if (!id) continue;
			next = next.map((s) => {
				if (s.id !== id) return s;
				let updated = { ...s };

				// Movement
				if (cmd.x !== undefined) updated.x = cmd.x;
				if (cmd.y !== undefined) updated.y = cmd.y;
				if (cmd.dx !== undefined) {
					updated.x += cmd.dx;
					if (updated.type === "line") updated.x2 += cmd.dx;
				}
				if (cmd.dy !== undefined) {
					updated.y += cmd.dy;
					if (updated.type === "line") updated.y2 += cmd.dy;
				}

				// Line-specific
				if (updated.type === "line") {
					if (cmd.x2 !== undefined) updated.x2 = cmd.x2;
					if (cmd.y2 !== undefined) updated.y2 = cmd.y2;
				}

				// Sizing
				if ("width" in updated && "height" in updated) {
					if (cmd.scale !== undefined) {
						updated.width = Math.max(1, updated.width * cmd.scale);
						updated.height = Math.max(1, updated.height * cmd.scale);
					} else {
						if (cmd.width !== undefined)
							updated.width = Math.max(1, cmd.width);
						if (cmd.height !== undefined)
							updated.height = Math.max(1, cmd.height);
					}
				}

				// Styling
				if (cmd.fill !== undefined) updated.fill = cmd.fill;
				if (cmd.stroke !== undefined) updated.stroke = cmd.stroke;
				if (cmd.strokeWidth !== undefined)
					updated.strokeWidth = cmd.strokeWidth;
				if (cmd.radius !== undefined && "radius" in updated) {
					updated.radius = cmd.radius;
				}

				return updated as CanvasShape;
			});
			continue;
		}
	}
	return next;
}

export function invertCommands(
	commands: Array<AnyCommand>,
	shapesBefore: CanvasShape[],
	selectedId: string | null,
): Array<AnyCommand> {
	const findShape = (id?: string | null): CanvasShape | null => {
		if (!id) return null;
		return shapesBefore.find((s) => s.id === id) ?? null;
	};
	const resolveId = (cmd: AnyCommand) =>
		(cmd as { id?: string }).id !== undefined
			? (cmd as { id?: string }).id
			: selectedId;
	const inverses: Array<AnyCommand> = [];
	for (const cmd of commands) {
		if (cmd.tool === "generateSvg") {
			const id = (cmd as { id?: string }).id;
			if (id) inverses.push({ tool: "deleteObject", id });
			continue;
		}
		if (cmd.tool === "generateImage") {
			const id = (cmd as { id?: string }).id;
			if (id) inverses.push({ tool: "deleteObject", id });
			continue;
		}
		if (cmd.tool === "replaceShape") {
			const prior = findShape((cmd as { shape: { id: string } }).shape.id);
			if (prior) inverses.push({ tool: "replaceShape", shape: prior });
			continue;
		}
		if (cmd.tool === "deleteObject") {
			const prior = findShape((cmd as { id: string }).id);
			if (prior) inverses.push({ tool: "replaceShape", shape: prior });
			continue;
		}
		if (cmd.tool === "editShape") {
			const id = resolveId(cmd);
			if (!id) continue;
			const s = findShape(id);
			if (!s) continue;
			const updates: AnyCommand = { tool: "editShape", id };

			if (cmd.dx !== undefined) {
				updates.dx = -cmd.dx;
			}
			if (cmd.dy !== undefined) {
				updates.dy = -cmd.dy;
			}
			if (cmd.x !== undefined) updates.x = s.x;
			if (cmd.y !== undefined) updates.y = s.y;

			if (cmd.scale !== undefined) {
				updates.scale = 1 / cmd.scale;
			} else {
				if (cmd.width !== undefined && isSizedShape(s)) updates.width = s.width;
				if (cmd.height !== undefined && isSizedShape(s))
					updates.height = s.height;
			}

			if (cmd.fill !== undefined) updates.fill = s.fill;
			if (cmd.stroke !== undefined) updates.stroke = s.stroke;
			if (cmd.strokeWidth !== undefined) updates.strokeWidth = s.strokeWidth;
			if (cmd.radius !== undefined && isRectShape(s))
				updates.radius = s.radius;

			if (s.type === "line") {
				if (cmd.x2 !== undefined) updates.x2 = s.x2;
				if (cmd.y2 !== undefined) updates.y2 = s.y2;
			}

			inverses.push(updates);
			continue;
		}
		if (cmd.tool === "editText") {
			const id = resolveId(cmd);
			if (!id) continue;
			const s = findShape(id);
			if (!s || s.type !== "text") continue;
			const updates: AnyCommand = { tool: "editText", id };

			if (cmd.text !== undefined) updates.text = s.text;
			if (cmd.fontSize !== undefined) updates.fontSize = s.fontSize;
			if (cmd.fontWeight !== undefined) updates.fontWeight = s.fontWeight;
			if (cmd.fontFamily !== undefined) updates.fontFamily = s.fontFamily;
			if (cmd.fill !== undefined) updates.fill = s.fill;
			if (cmd.stroke !== undefined) updates.stroke = s.stroke;
			if (cmd.strokeWidth !== undefined) updates.strokeWidth = s.strokeWidth;
			if (cmd.shadow !== undefined) updates.shadow = s.shadow;
			if (cmd.x !== undefined) updates.x = s.x;
			if (cmd.y !== undefined) updates.y = s.y;
			if (cmd.dx !== undefined) updates.dx = -cmd.dx;
			if (cmd.dy !== undefined) updates.dy = -cmd.dy;

			inverses.push(updates);
			continue;
		}
	}
	inverses.reverse();
	return inverses;
}
