import type {
	AnyCommand,
	CanvasShape,
	EllipseShape,
	RectShape,
	SvgShape,
} from "./types";

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
		if (cmd.tool === "moveObject") {
			const id = selectId(cmd.id);
			if (!id) continue;
			next = next.map((s) =>
				s.id !== id
					? s
					: s.type === "line"
						? {
								...s,
								x: s.x + (cmd.dx || 0),
								y: s.y + (cmd.dy || 0),
								x2: s.x2 + (cmd.dx || 0),
								y2: s.y2 + (cmd.dy || 0),
							}
						: { ...s, x: s.x + (cmd.dx || 0), y: s.y + (cmd.dy || 0) },
			);
			continue;
		}
		if (cmd.tool === "resize") {
			const id = selectId(cmd.id);
			if (!id) continue;
			next = next.map((s) => {
				if (s.id !== id) return s;
				if (s.type === "line") {
					const scale = cmd.scale || 1;
					const cx = (s.x + s.x2) / 2;
					const cy = (s.y + s.y2) / 2;
					return {
						...s,
						x: cx + (s.x - cx) * scale,
						y: cy + (s.y - cy) * scale,
						x2: cx + (s.x2 - cx) * scale,
						y2: cy + (s.y2 - cy) * scale,
					};
				}
				if (s.type === "svg") {
					if (cmd.scale) {
						return {
							...s,
							width: Math.max(1, s.width * (cmd.scale || 1)),
							height: Math.max(1, s.height * (cmd.scale || 1)),
						} as CanvasShape;
					}
					return {
						...s,
						width: Math.max(1, cmd.width ?? s.width),
						height: Math.max(1, cmd.height ?? s.height),
					} as CanvasShape;
				}
				if (s.type === "image") {
					if (cmd.scale) {
						return {
							...s,
							width: Math.max(1, s.width * (cmd.scale || 1)),
							height: Math.max(1, s.height * (cmd.scale || 1)),
						} as CanvasShape;
					}
					return {
						...s,
						width: Math.max(1, cmd.width ?? s.width),
						height: Math.max(1, cmd.height ?? s.height),
					} as CanvasShape;
				}
				if ("width" in s && "height" in s) {
					if (cmd.scale) {
						return {
							...s,
							width: Math.max(
								1,
								(s as RectShape | EllipseShape).width * (cmd.scale || 1),
							),
							height: Math.max(
								1,
								(s as RectShape | EllipseShape).height * (cmd.scale || 1),
							),
						} as CanvasShape;
					}
					return {
						...s,
						width: Math.max(
							1,
							cmd.width ?? (s as RectShape | EllipseShape).width,
						),
						height: Math.max(
							1,
							cmd.height ?? (s as RectShape | EllipseShape).height,
						),
					} as CanvasShape;
				}
				return s;
			});
			continue;
		}
		if (cmd.tool === "changeColor") {
			const id = selectId(cmd.id);
			if (!id) continue;
			next = next.map((s) =>
				s.id !== id
					? s
					: ({
							...s,
							fill: cmd.fill ?? s.fill,
							stroke: cmd.stroke ?? s.stroke,
						} as CanvasShape),
			);
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
		if (cmd.tool === "moveObject") {
			const id = resolveId(cmd);
			if (!id) continue;
			const dx = -((cmd as { dx?: number }).dx || 0);
			const dy = -((cmd as { dy?: number }).dy || 0);
			inverses.push({ tool: "moveObject", id, dx, dy });
			continue;
		}
		if (cmd.tool === "resize") {
			const id = resolveId(cmd);
			if (!id) continue;
			const s = findShape(id);
			if (!s) continue;
			const scale = (cmd as { scale?: number }).scale;
			if (scale) {
				inverses.push({ tool: "resize", id, scale: 1 / (scale || 1) });
			} else if ("width" in s && "height" in s) {
				inverses.push({
					tool: "resize",
					id,
					width: (s as RectShape | EllipseShape).width,
					height: (s as RectShape | EllipseShape).height,
				});
			}
			continue;
		}
		if (cmd.tool === "changeColor") {
			const id = resolveId(cmd);
			if (!id) continue;
			const s = findShape(id);
			if (!s) continue;
			inverses.push({
				tool: "changeColor",
				id,
				fill: (s as { fill?: string }).fill,
				stroke: (s as { stroke?: string }).stroke,
			});
		}
	}
	inverses.reverse();
	return inverses;
}
