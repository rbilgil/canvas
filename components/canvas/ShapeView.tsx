import type React from "react";
import { COLORS, SIZES, boundingBox, expandRect } from "./lib";
import type {
	CanvasShape,
	EllipseShape,
	ImageShape,
	LineShape,
	PathShape,
	PointerMode,
	RectShape,
	SvgShape,
	TextShape,
} from "./types";

export function ShapeView({
	shape,
	selected,
	onPointerDown,
	tool,
}: {
	shape: CanvasShape;
	selected: boolean;
	onPointerDown: (
		e: React.PointerEvent,
		shape: CanvasShape,
		mode: PointerMode,
	) => void;
	tool: string;
}) {
	if (shape.type === "rect") {
		const s = shape as RectShape;
		return (
			<g>
				<rect
					x={s.x}
					y={s.y}
					width={s.width}
					height={s.height}
					fill={s.fill || "transparent"}
					stroke={s.stroke || "#0f172a"}
					strokeWidth={s.strokeWidth || 2}
					onPointerDown={(e) => onPointerDown(e, s, "move")}
					style={{ cursor: tool === "select" ? "move" : "crosshair" }}
				/>
				{selected && <SelectionFrameRect s={s} onPointerDown={onPointerDown} />}
			</g>
		);
	}
	if (shape.type === "ellipse") {
		const s = shape as EllipseShape;
		const rx = s.width / 2;
		const ry = s.height / 2;
		return (
			<g>
				<ellipse
					cx={s.x + rx}
					cy={s.y + ry}
					rx={rx}
					ry={ry}
					fill={s.fill || "transparent"}
					stroke={s.stroke || "#0f172a"}
					strokeWidth={s.strokeWidth || 2}
					onPointerDown={(e) => onPointerDown(e, s, "move")}
					style={{ cursor: tool === "select" ? "move" : "crosshair" }}
				/>
				{selected && <SelectionFrameRect s={s} onPointerDown={onPointerDown} />}
			</g>
		);
	}
	if (shape.type === "line") {
		const s = shape as LineShape;
		return (
			<g>
				<line
					x1={s.x}
					y1={s.y}
					x2={s.x2}
					y2={s.y2}
					stroke={s.stroke || "#0f172a"}
					strokeWidth={s.strokeWidth || 2}
					onPointerDown={(e) => onPointerDown(e, s, "move")}
					style={{ cursor: tool === "select" ? "move" : "crosshair" }}
				/>
				{selected && (
					<g>
						<circle
							cx={s.x}
							cy={s.y}
							r={5}
							fill="#fff"
							stroke="#2563eb"
							strokeWidth={2}
							onPointerDown={(e) => onPointerDown(e, s, { lineEnd: 1 })}
						/>
						<circle
							cx={s.x2}
							cy={s.y2}
							r={5}
							fill="#fff"
							stroke="#2563eb"
							strokeWidth={2}
							onPointerDown={(e) => onPointerDown(e, s, { lineEnd: 2 })}
						/>
					</g>
				)}
			</g>
		);
	}
	if (shape.type === "text") {
		const s = shape as TextShape;
		return (
			<g>
				<text
					x={s.x}
					y={s.y}
					fontSize={s.fontSize}
					fontFamily={s.fontFamily || "ui-sans-serif, system-ui"}
					fontWeight={s.fontWeight || "400"}
					fill={s.fill || "#0f172a"}
					stroke={s.stroke}
					strokeWidth={s.strokeWidth}
					dominantBaseline="hanging"
					onPointerDown={(e) => onPointerDown(e, s, "move")}
					style={{ cursor: tool === "select" ? "text" : "crosshair" }}
				>
					{s.text || ""}
				</text>
				{selected && (
					<SelectionFrameRect
						s={
							{
								type: "rect",
								id: s.id,
								x: s.x,
								y: s.y,
								width: Math.max(40, (s.text.length || 1) * (s.fontSize * 0.6)),
								height: s.fontSize * 1.4,
							} as RectShape
						}
						onPointerDown={onPointerDown}
					/>
				)}
			</g>
		);
	}
	if (shape.type === "svg") {
		const s = shape as SvgShape;
		return (
			<g>
				<rect
					x={s.x}
					y={s.y}
					width={s.width}
					height={s.height}
					fill="transparent"
					onPointerDown={(e) => onPointerDown(e, s, "move")}
					style={{ cursor: tool === "select" ? "move" : "crosshair" }}
				/>
				<image
					x={s.x}
					y={s.y}
					width={s.width}
					height={s.height}
					preserveAspectRatio="xMidYMid meet"
					href={`data:image/svg+xml;utf8,${encodeURIComponent(s.svg)}`}
					pointerEvents="none"
				/>
				{selected && (
					<SelectionFrameRect
						s={{ ...s, type: "rect" } as RectShape}
						onPointerDown={onPointerDown}
					/>
				)}
			</g>
		);
	}
	if (shape.type === "image") {
		const s = shape as ImageShape;
		return (
			<g>
				<image
					x={s.x}
					y={s.y}
					width={s.width}
					height={s.height}
					href={s.href}
					onPointerDown={(e) => onPointerDown(e, s, "move")}
					style={{ cursor: tool === "select" ? "move" : "crosshair" }}
				/>
				{selected && (
					<SelectionFrameRect
						s={{ ...s, type: "rect" } as RectShape}
						onPointerDown={onPointerDown}
					/>
				)}
			</g>
		);
	}
	if (shape.type === "path") {
		const s = shape as PathShape;
		if (s.points.length === 0) return null;
		
		const strokeWidth = s.strokeWidth || SIZES.strokeWidth;
		
		// Single point - render as a dot
		if (s.points.length === 1) {
			const pt = s.points[0];
			const dotRadius = strokeWidth / 2 + 2;
			return (
				<g>
					<circle
						cx={pt.x}
						cy={pt.y}
						r={dotRadius + SIZES.selectionPadding}
						fill="transparent"
						onPointerDown={(e) => onPointerDown(e, s, "move")}
						style={{ cursor: tool === "select" ? "move" : "crosshair" }}
					/>
					<circle
						cx={pt.x}
						cy={pt.y}
						r={dotRadius}
						fill={s.stroke || COLORS.stroke}
						pointerEvents="none"
					/>
					{selected && (
						<circle
							cx={pt.x}
							cy={pt.y}
							r={dotRadius + 4}
							fill="none"
							stroke="#3b82f6"
							strokeWidth={1.5}
							strokeDasharray="3 2"
							pointerEvents="none"
						/>
					)}
				</g>
			);
		}
		
		// Build path with moveTo support for discontinuous strokes
		const d = s.points
			.map((p, i) => {
				// Use M (move to) for first point or if moveTo flag is set
				const cmd = i === 0 || p.moveTo ? "M" : "L";
				return `${cmd}${p.x},${p.y}`;
			})
			.join(" ");
		// Compute bounding box for selection frame and hit area
		const bounds = boundingBox(s.points);
		const hitArea = expandRect(bounds, SIZES.selectionPadding);
		return (
			<g>
				{/* Invisible hit area covering bounding box */}
				<rect
					x={hitArea.x}
					y={hitArea.y}
					width={hitArea.width}
					height={hitArea.height}
					fill="transparent"
					onPointerDown={(e) => onPointerDown(e, s, "move")}
					style={{ cursor: tool === "select" ? "move" : "crosshair" }}
				/>
				<path
					d={d}
					fill="none"
					stroke={s.stroke || COLORS.stroke}
					strokeWidth={strokeWidth}
					strokeLinecap="round"
					strokeLinejoin="round"
					pointerEvents="none"
				/>
				{selected && (
					<SelectionFramePath
						shape={s}
						bounds={bounds}
						onPointerDown={onPointerDown}
					/>
				)}
			</g>
		);
	}
	return null;
}

export function SelectionFrameRect({
	s,
	onPointerDown,
}: {
	s: RectShape | EllipseShape;
	onPointerDown: (
		e: React.PointerEvent,
		shape: CanvasShape,
		mode: PointerMode,
	) => void;
}) {
	const x = s.x;
	const y = s.y;
	const w = Math.max(0, (s as RectShape).width ?? 0);
	const h = Math.max(0, (s as RectShape).height ?? 0);
	const halfHandle = SIZES.handleSize / 2;
	return (
		<g>
			<rect
				x={x}
				y={y}
				width={w}
				height={h}
				fill="none"
				stroke={COLORS.selection}
				strokeWidth={1}
				strokeDasharray="4 2"
			/>
			{[
				{ key: "nw", cx: x, cy: y },
				{ key: "ne", cx: x + w, cy: y },
				{ key: "sw", cx: x, cy: y + h },
				{ key: "se", cx: x + w, cy: y + h },
			].map((hnd) => (
				<rect
					key={hnd.key}
					x={hnd.cx - halfHandle}
					y={hnd.cy - halfHandle}
					width={SIZES.handleSize}
					height={SIZES.handleSize}
					fill="#fff"
					stroke={COLORS.selection}
					strokeWidth={SIZES.handleStrokeWidth}
					style={{
						cursor: `${hnd.key}-resize` as React.CSSProperties["cursor"],
					}}
					onPointerDown={(e) =>
						onPointerDown(e, s as CanvasShape, {
							resize: hnd.key as "nw" | "ne" | "sw" | "se",
						})
					}
				/>
			))}
		</g>
	);
}

export function SelectionFramePath({
	shape,
	bounds,
	onPointerDown,
}: {
	shape: PathShape;
	bounds: { x: number; y: number; width: number; height: number };
	onPointerDown: (
		e: React.PointerEvent,
		shape: CanvasShape,
		mode: PointerMode,
	) => void;
}) {
	const { x, y, width: w, height: h } = bounds;
	const halfHandle = SIZES.handleSize / 2;
	return (
		<g>
			<rect
				x={x}
				y={y}
				width={w}
				height={h}
				fill="none"
				stroke={COLORS.selection}
				strokeWidth={1}
				strokeDasharray="4 2"
			/>
			{[
				{ key: "nw", cx: x, cy: y },
				{ key: "ne", cx: x + w, cy: y },
				{ key: "sw", cx: x, cy: y + h },
				{ key: "se", cx: x + w, cy: y + h },
			].map((hnd) => (
				<rect
					key={hnd.key}
					x={hnd.cx - halfHandle}
					y={hnd.cy - halfHandle}
					width={SIZES.handleSize}
					height={SIZES.handleSize}
					fill="#fff"
					stroke={COLORS.selection}
					strokeWidth={SIZES.handleStrokeWidth}
					style={{
						cursor: `${hnd.key}-resize` as React.CSSProperties["cursor"],
					}}
					onPointerDown={(e) =>
						onPointerDown(e, shape, {
							resize: hnd.key as "nw" | "ne" | "sw" | "se",
						})
					}
				/>
			))}
		</g>
	);
}
