import type React from "react";
import type {
	CanvasShape,
	EllipseShape,
	ImageShape,
	LineShape,
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
	return (
		<g>
			<rect
				x={x}
				y={y}
				width={w}
				height={h}
				fill="none"
				stroke="#2563eb"
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
					x={hnd.cx - 4}
					y={hnd.cy - 4}
					width={8}
					height={8}
					fill="#fff"
					stroke="#2563eb"
					strokeWidth={1.5}
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
