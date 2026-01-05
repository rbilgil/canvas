"use client";

import { useAction } from "convex/react";
import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import {
	applyCommandsToState,
	invertCommands,
} from "@/components/canvas/commands";
import { runLassoEdit as externalRunLassoEdit } from "@/components/canvas/imageLasso";
import { PropertiesPanel } from "@/components/canvas/PropertiesPanel";
import { ShapeView } from "@/components/canvas/ShapeView";
import {
	createEllipse,
	createLine,
	createRect,
	createText,
} from "@/components/canvas/shapeFactories";
import type {
	AnyCommand,
	CanvasShape,
	CanvasToolCommand,
	ImageShape,
	Tool,
} from "@/components/canvas/types";
import {
	clientToSvg,
	createShapeId,
	readImageFile,
	svgToClient,
} from "@/components/canvas/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "../../convex/_generated/api";

export interface DesignData {
	id: string;
	name: string;
	width: number;
	height: number;
	initialShapes: CanvasShape[];
}

export interface DesignCanvasProps {
	designs: DesignData[];
	activeDesignId: string | null;
	onActivate: (designId: string) => void;
	onShapesChange?: (designId: string, shapes: CanvasShape[]) => void;
	tool: Tool;
	onToolChange: (tool: Tool) => void;
	onUndoStackChange?: (designId: string, canUndo: boolean) => void;
}

export interface DesignCanvasRef {
	getShapes: (designId: string) => CanvasShape[];
	undo: () => void;
	resetView: () => void;
	canUndo: () => boolean;
}

function getShapeBounds(s: CanvasShape): {
	x: number;
	y: number;
	width: number;
	height: number;
} {
	if (
		s.type === "rect" ||
		s.type === "ellipse" ||
		s.type === "image" ||
		s.type === "svg"
	) {
		const t = s as Extract<CanvasShape, { width: number; height: number }>;
		return { x: t.x, y: t.y, width: t.width, height: t.height };
	}
	if (s.type === "line") {
		const x1 = Math.min(s.x, s.x2);
		const y1 = Math.min(s.y, s.y2);
		return {
			x: x1,
			y: y1,
			width: Math.abs(s.x2 - s.x),
			height: Math.abs(s.y2 - s.y),
		};
	}
	if (s.type === "text") {
		const w = Math.max(40, (s.text.length || 1) * (s.fontSize * 0.6));
		const h = s.fontSize * 1.4;
		return { x: s.x, y: s.y, width: w, height: h };
	}
	return {
		x: (s as { x?: number }).x ?? 0,
		y: (s as { y?: number }).y ?? 0,
		width: 0,
		height: 0,
	};
}

// Internal component for a single design canvas
interface SingleDesignCanvasProps {
	design: DesignData;
	isActive: boolean;
	onActivate: () => void;
	tool: Tool;
	onToolChange: (tool: Tool) => void;
	onShapesChange?: (shapes: CanvasShape[]) => void;
	undoStackRef: React.MutableRefObject<Map<string, Array<Array<AnyCommand>>>>;
	onUndoStackChange?: (canUndo: boolean) => void;
}

function SingleDesignCanvas({
	design,
	isActive,
	onActivate,
	tool,
	onToolChange,
	onShapesChange,
	undoStackRef,
	onUndoStackChange,
}: SingleDesignCanvasProps) {
	const [shapes, setShapes] = useState<CanvasShape[]>(design.initialShapes);
	const [selectedId, setSelectedId] = useState<string | null>(null);

	// Track which design we've initialized to avoid re-syncing from server on our own saves
	const initializedForDesignRef = useRef<string | null>(null);
	const [selectedIds, setSelectedIds] = useState<Array<string>>([]);
	const [isPointerDown, setIsPointerDown] = useState(false);
	const [draftId, setDraftId] = useState<string | null>(null);
	const [activeHandle, setActiveHandle] = useState<
		| null
		| { kind: "corner"; corner: "nw" | "ne" | "sw" | "se" }
		| { kind: "line-end"; end: 1 | 2 }
	>(null);
	const svgRef = useRef<SVGSVGElement | null>(null);
	const groupDragRef = useRef<null | {
		startX: number;
		startY: number;
		originals: Record<string, CanvasShape>;
	}>(null);

	const interactionOriginalRef = useRef<CanvasShape | null>(null);
	const createdShapeIdRef = useRef<string | null>(null);

	// Get/set undo stack for this design
	const getUndoStack = useCallback(() => {
		return undoStackRef.current.get(design.id) ?? [];
	}, [design.id, undoStackRef]);

	const setUndoStack = useCallback(
		(updater: (prev: Array<Array<AnyCommand>>) => Array<Array<AnyCommand>>) => {
			const current = undoStackRef.current.get(design.id) ?? [];
			const next = updater(current);
			undoStackRef.current.set(design.id, next);
			onUndoStackChange?.(next.length > 0);
		},
		[design.id, undoStackRef, onUndoStackChange],
	);

	// Text editing overlay state
	const [editingTextId, setEditingTextId] = useState<string | null>(null);
	const [textEditorValue, setTextEditorValue] = useState<string>("");
	const textEditorRef = useRef<HTMLTextAreaElement | null>(null);
	const [textEditorPos, setTextEditorPos] = useState<{
		left: number;
		top: number;
		fontSize: number;
	}>({ left: 0, top: 0, fontSize: 16 });

	// Right-click command palette state
	const [rcOpen, setRcOpen] = useState(false);
	const [rcText, setRcText] = useState("");
	const [rcPos, setRcPos] = useState<{ left: number; top: number }>({
		left: 0,
		top: 0,
	});
	const [rcBusy, setRcBusy] = useState(false);
	const [rcPlaceholder, setRcPlaceholder] = useState("what should we do?");

	const interpret = useAction(api.canvas_ai.interpret);
	const generateCanvasImage = useAction(api.images.generateCanvasImage);
	const fuseCanvasImages = useAction(api.images.fuseCanvasImages);
	const editCanvasImage = useAction(api.images.editCanvasImage);

	// Lasso tool state
	const [isLassoing, setIsLassoing] = useState(false);
	const [lassoPoints, setLassoPoints] = useState<
		Array<{ x: number; y: number }>
	>([]);
	const [lassoImageId, setLassoImageId] = useState<string | null>(null);
	const [lassoPending, setLassoPending] = useState<null | {
		imageId: string;
		points: Array<{ x: number; y: number }>;
	}>(null);

	// Marquee selection
	const [marquee, setMarquee] = useState<null | {
		x: number;
		y: number;
		width: number;
		height: number;
	}>(null);

	// Notify parent of shape changes (but skip initial notification to avoid triggering saves)
	const hasNotifiedRef = useRef(false);
	useEffect(() => {
		if (hasNotifiedRef.current) {
			onShapesChange?.(shapes);
		} else {
			hasNotifiedRef.current = true;
		}
	}, [shapes, onShapesChange]);

	// Only sync from initialShapes when switching to a different design
	// This prevents server updates from overwriting local state during editing
	useEffect(() => {
		if (initializedForDesignRef.current !== design.id) {
			setShapes(design.initialShapes);
			initializedForDesignRef.current = design.id;
			hasNotifiedRef.current = false; // Reset notification flag for new design
		}
	}, [design.id, design.initialShapes]);

	const applyCommandGroup = useCallback(
		(commands: Array<AnyCommand>, opts?: { recordUndo?: boolean }) => {
			const imageCommands = commands.filter(
				(c) =>
					c.tool === "generateImage" ||
					c.tool === "editImage" ||
					c.tool === "combineSelection",
			) as Array<CanvasToolCommand>;
			const restCommands = commands.filter(
				(c) =>
					c.tool !== "generateImage" &&
					c.tool !== "editImage" &&
					c.tool !== "combineSelection",
			);

			if (restCommands.length > 0) {
				setShapes((prev) => {
					if (opts?.recordUndo) {
						const inverse = invertCommands(restCommands, prev, selectedId);
						setUndoStack((stack) => [...stack, inverse]);
					}
					return applyCommandsToState(prev, restCommands, selectedId);
				});
			}

			if (imageCommands.length > 0) {
				void (async () => {
					for (const cmd of imageCommands) {
						if (cmd.tool === "generateImage") {
							const prompt = cmd.prompt || "";
							const res = await generateCanvasImage({
								prompt,
								width: cmd.width,
								height: cmd.height,
							});
							const id = cmd.id || createShapeId("img");
							setShapes((prev) => [
								...prev,
								{
									id,
									type: "image",
									x: cmd.x ?? 40,
									y: cmd.y ?? 40,
									width: res.width,
									height: res.height,
									href: res.dataUrl,
								} as ImageShape,
							]);
							setUndoStack((stack) => [
								...stack,
								[{ tool: "deleteObject", id }],
							]);
						} else if (cmd.tool === "editImage") {
							const id = cmd.id || selectedId;
							if (!id || !cmd.prompt) continue;
							const before = shapes.find(
								(s): s is ImageShape => s.id === id && s.type === "image",
							);
							if (!before) continue;
							const res = await editCanvasImage({
								dataUrl: before.href,
								prompt: cmd.prompt,
							});
							const snapshot = JSON.parse(JSON.stringify(before)) as ImageShape;
							setUndoStack((stack) => [
								...stack,
								[{ tool: "replaceShape", shape: snapshot }],
							]);
							setShapes((prev) =>
								prev.map((s) =>
									s.id === before.id ? { ...before, href: res.dataUrl } : s,
								),
							);
						} else if (cmd.tool === "combineSelection") {
							const ids = selectedIds.length
								? selectedIds.slice()
								: selectedId
									? [selectedId]
									: [];
							if (ids.length === 0) continue;
							const originals = shapes.filter((s) => ids.includes(s.id));
							if (originals.length === 0) continue;
							const bounds = originals.map((s) => getShapeBounds(s));
							const minX = Math.min(...bounds.map((b) => b.x));
							const minY = Math.min(...bounds.map((b) => b.y));
							const maxX = Math.max(...bounds.map((b) => b.x + b.width));
							const maxY = Math.max(...bounds.map((b) => b.y + b.height));
							const bbox = {
								x: minX,
								y: minY,
								width: maxX - minX,
								height: maxY - minY,
							};
							if (!Number.isFinite(bbox.x) || !Number.isFinite(bbox.y))
								continue;

							const makeDataUrlForShape = async (
								s: CanvasShape,
							): Promise<string> => {
								if (s.type === "image") return s.href;
								const localCanvas = document.createElement("canvas");
								const b = getShapeBounds(s);
								localCanvas.width = Math.max(1, Math.ceil(b.width));
								localCanvas.height = Math.max(1, Math.ceil(b.height));
								const lctx = localCanvas.getContext("2d");
								if (!lctx) return localCanvas.toDataURL("image/png");
								lctx.save();
								const rot = (s as { rotationDeg?: number }).rotationDeg || 0;
								const opacity = (s as { opacity?: number }).opacity ?? 1;
								lctx.globalAlpha = opacity;
								if (rot) {
									const cx = localCanvas.width / 2;
									const cy = localCanvas.height / 2;
									lctx.translate(cx, cy);
									lctx.rotate((rot * Math.PI) / 180);
									lctx.translate(-cx, -cy);
								}
								if (s.type === "rect") {
									lctx.beginPath();
									lctx.rect(0, 0, s.width, s.height);
									if (s.fill) {
										lctx.fillStyle = s.fill;
										lctx.fill();
									}
									lctx.lineWidth = s.strokeWidth || 0;
									if (s.stroke && (s.strokeWidth || 0) > 0) {
										lctx.strokeStyle = s.stroke;
										lctx.stroke();
									}
								} else if (s.type === "ellipse") {
									lctx.beginPath();
									lctx.ellipse(
										s.width / 2,
										s.height / 2,
										s.width / 2,
										s.height / 2,
										0,
										0,
										Math.PI * 2,
									);
									if (s.fill) {
										lctx.fillStyle = s.fill;
										lctx.fill();
									}
									lctx.lineWidth = s.strokeWidth || 0;
									if (s.stroke && (s.strokeWidth || 0) > 0) {
										lctx.strokeStyle = s.stroke;
										lctx.stroke();
									}
								} else if (s.type === "line") {
									lctx.beginPath();
									lctx.moveTo(s.x - b.x, s.y - b.y);
									lctx.lineTo(s.x2 - b.x, s.y2 - b.y);
									lctx.lineWidth = s.strokeWidth || 2;
									lctx.strokeStyle = s.stroke || "#0f172a";
									lctx.stroke();
								} else if (s.type === "text") {
									const fontWeight = s.fontWeight || "400";
									const fontFamily = s.fontFamily || "ui-sans-serif, system-ui";
									lctx.font = `${fontWeight} ${s.fontSize}px ${fontFamily}`;
									lctx.textBaseline = "top";
									if (s.fill) {
										lctx.fillStyle = s.fill;
										lctx.fillText(s.text, s.x - b.x, s.y - b.y);
									}
									if (s.stroke && (s.strokeWidth || 0) > 0) {
										lctx.lineWidth = s.strokeWidth || 1;
										lctx.strokeStyle = s.stroke;
										lctx.strokeText(s.text, s.x - b.x, s.y - b.y);
									}
								} else if (s.type === "svg") {
									await new Promise<void>((resolve) => {
										const img = new Image();
										img.onload = () => {
											lctx.drawImage(img, 0, 0, s.width, s.height);
											resolve();
										};
										img.onerror = () => resolve();
										img.src = `data:image/svg+xml;utf8,${encodeURIComponent(s.svg)}`;
									});
								}
								lctx.restore();
								return localCanvas.toDataURL("image/png");
							};

							const imagePayloads: Array<{ dataUrl: string; label?: string }> =
								[];
							for (const s of originals) {
								const dataUrl = await makeDataUrlForShape(s);
								imagePayloads.push({ dataUrl });
							}

							const instruction = [
								"Combine the following image layers into a single, beautiful, photoreal image.",
								"Ignore any text or watermark artifacts. Return a single, re-imagined, photoreal image only.",
							].join(" \n");

							try {
								const fused = await fuseCanvasImages({
									images: imagePayloads,
									prompt: instruction,
								});
								const id = createShapeId("img");
								const combined: ImageShape = {
									id,
									type: "image",
									x: Math.round(bbox.x),
									y: Math.round(bbox.y),
									width: Math.max(1, Math.ceil(bbox.width)),
									height: Math.max(1, Math.ceil(bbox.height)),
									href: fused.dataUrl,
								};
								setShapes((prev) => [
									...prev.filter((s) => !ids.includes(s.id)),
									combined,
								]);
								setUndoStack((stack) => [
									...stack,
									[
										{ tool: "deleteObject", id },
										...originals.map((shape) => ({
											tool: "replaceShape" as const,
											shape: JSON.parse(JSON.stringify(shape)) as CanvasShape,
										})),
									],
								]);
								setSelectedId(id);
								setSelectedIds([id]);
							} catch (err) {
								console.log("fuseCanvasImages failed", err);
							}
						}
					}
				})();
			}
		},
		[
			selectedId,
			selectedIds,
			shapes,
			generateCanvasImage,
			editCanvasImage,
			fuseCanvasImages,
			setUndoStack,
		],
	);

	// Keyboard shortcuts (only when active)
	useEffect(() => {
		if (!isActive) return;

		const onKey = (e: KeyboardEvent) => {
			const isUndo = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z";
			if (isUndo) {
				e.preventDefault();
				const stack = getUndoStack();
				if (stack.length === 0) return;
				const next = stack.slice(0, -1);
				const inverse = stack[stack.length - 1];
				undoStackRef.current.set(design.id, next);
				onUndoStackChange?.(next.length > 0);
				setShapes((prev) => applyCommandsToState(prev, inverse, selectedId));
				return;
			}
			if (e.key === "Backspace" || e.key === "Delete") {
				if (selectedIds.length === 0 && !selectedId) return;
				e.preventDefault();
				const idsToDelete = selectedIds.length
					? selectedIds
					: selectedId
						? [selectedId]
						: [];
				const priors = shapes.filter((s) => idsToDelete.includes(s.id));
				if (priors.length) {
					setUndoStack((stack) => [
						...stack,
						priors.map((p) => ({
							tool: "replaceShape",
							shape: JSON.parse(JSON.stringify(p)),
						})),
					]);
				}
				setShapes((prev) => prev.filter((s) => !idsToDelete.includes(s.id)));
				setSelectedId(null);
				setSelectedIds([]);
			}
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [
		isActive,
		selectedId,
		selectedIds,
		shapes,
		getUndoStack,
		setUndoStack,
		design.id,
		undoStackRef,
		onUndoStackChange,
	]);

	const selectedShape = useMemo(() => {
		if (selectedIds.length === 1) {
			const onlyId = selectedIds[0];
			return shapes.find((s) => s.id === onlyId) ?? null;
		}
		return null;
	}, [shapes, selectedIds]);

	function rectsIntersect(
		a: { x: number; y: number; width: number; height: number },
		b: { x: number; y: number; width: number; height: number },
	): boolean {
		return (
			a.x <= b.x + b.width &&
			a.x + a.width >= b.x &&
			a.y <= b.y + b.height &&
			a.y + a.height >= b.y
		);
	}

	const setShapeById = useCallback(
		(id: string, updater: (s: CanvasShape) => CanvasShape) => {
			setShapes((prev) => prev.map((s) => (s.id === id ? updater(s) : s)));
		},
		[],
	);

	const removeShapeById = useCallback((id: string) => {
		setShapes((prev) => prev.filter((s) => s.id !== id));
	}, []);

	const svgPoint = (evt: React.PointerEvent): { x: number; y: number } => {
		const svg = svgRef.current;
		if (!svg) return { x: 0, y: 0 };
		return clientToSvg(svg, evt.clientX, evt.clientY);
	};

	const svgPointFromScreen = (
		clientX: number,
		clientY: number,
	): { x: number; y: number } => {
		const svg = svgRef.current;
		if (!svg) return { x: 0, y: 0 };
		return clientToSvg(svg, clientX, clientY);
	};

	const screenPointFromSvg = (
		x: number,
		y: number,
	): { left: number; top: number } => {
		const svg = svgRef.current;
		if (!svg) return { left: 0, top: 0 };
		return svgToClient(svg, x, y);
	};

	const handlePointerDown = (e: React.PointerEvent) => {
		if (e.button !== 0) return;
		onActivate();
		const { x, y } = svgPoint(e);
		setIsPointerDown(true);
		interactionOriginalRef.current = null;
		createdShapeIdRef.current = null;

		if (tool === "draw-rect") {
			const rect = createRect({ x, y, fill: "#94a3b833" });
			setShapes((prev) => [...prev, rect]);
			setDraftId(rect.id);
			setSelectedId(rect.id);
			setSelectedIds([rect.id]);
			createdShapeIdRef.current = rect.id;
			return;
		}
		if (tool === "draw-ellipse") {
			const ellipse = createEllipse({ x, y, fill: "#22c55e22" });
			setShapes((prev) => [...prev, ellipse]);
			setDraftId(ellipse.id);
			setSelectedId(ellipse.id);
			setSelectedIds([ellipse.id]);
			createdShapeIdRef.current = ellipse.id;
			return;
		}
		if (tool === "draw-line") {
			const line = createLine({ x, y });
			setShapes((prev) => [...prev, line]);
			setDraftId(line.id);
			setSelectedId(line.id);
			setSelectedIds([line.id]);
			createdShapeIdRef.current = line.id;
			return;
		}
		if (tool === "draw-text") {
			const text = createText({ x, y });
			setShapes((prev) => [...prev, text]);
			setSelectedId(text.id);
			setSelectedIds([text.id]);
			setEditingTextId(text.id);
			setTextEditorValue("");
			setTextEditorPos({ left: x, top: y, fontSize: 20 });
			onToolChange("select");
			requestAnimationFrame(() => {
				textEditorRef.current?.focus();
			});
			return;
		}

		if (tool === "select") {
			setSelectedId(null);
			setSelectedIds([]);
			setMarquee({ x, y, width: 0, height: 0 });
		}
	};

	const handleContextMenu = (e: React.MouseEvent) => {
		e.preventDefault();
		onActivate();
		setRcOpen(true);
		setRcBusy(false);
		setRcText("");
		setRcPlaceholder("what should we do?");
		setRcPos({ left: e.clientX, top: e.clientY });
	};

	const handlePointerMove = (e: React.PointerEvent) => {
		if (!isPointerDown) return;
		const { x, y } = svgPoint(e);

		if (isLassoing) {
			setLassoPoints((pts) =>
				pts.length === 0 ||
				Math.abs(pts[pts.length - 1].x - x) +
					Math.abs(pts[pts.length - 1].y - y) >
					1
					? [...pts, { x, y }]
					: pts,
			);
			return;
		}

		if (marquee) {
			setMarquee((m) =>
				m ? { x: m.x, y: m.y, width: x - m.x, height: y - m.y } : m,
			);
			return;
		}

		if (groupDragRef.current && tool === "select" && selectedIds.length >= 1) {
			const { startX, startY, originals } = groupDragRef.current;
			const dx = x - startX;
			const dy = y - startY;
			setShapes((prev) =>
				prev.map((s) => {
					if (!selectedIds.includes(s.id)) return s;
					const o = originals[s.id];
					if (!o) return s;
					if (o.type === "line") {
						return {
							...s,
							x: o.x + dx,
							y: o.y + dy,
							x2: (o as { x2: number }).x2 + dx,
							y2: (o as { y2: number }).y2 + dy,
						};
					}
					if ("x" in o && "y" in o) {
						return {
							...(s as CanvasShape),
							x: (o as { x: number }).x + dx,
							y: (o as { y: number }).y + dy,
						} as CanvasShape;
					}
					return s;
				}),
			);
			return;
		}

		if (draftId) {
			setShapeById(draftId, (s) => {
				if (s.type === "rect" || s.type === "ellipse") {
					const originX = s.x;
					const originY = s.y;
					const newX = Math.min(originX, x);
					const newY = Math.min(originY, y);
					const newW = Math.abs(x - originX);
					const newH = Math.abs(y - originY);
					return { ...s, x: newX, y: newY, width: newW, height: newH };
				}
				if (s.type === "line") {
					return { ...s, x2: x, y2: y };
				}
				return s;
			});
			return;
		}

		if (tool === "select" && selectedId && activeHandle) {
			setShapeById(selectedId, (s) => {
				if (
					s.type === "rect" ||
					s.type === "ellipse" ||
					s.type === "image" ||
					s.type === "svg"
				) {
					let x1 = s.x;
					let y1 = s.y;
					let x2 = s.x + s.width;
					let y2 = s.y + s.height;
					if (activeHandle.kind === "corner") {
						if (activeHandle.corner === "nw") {
							x1 = x;
							y1 = y;
						} else if (activeHandle.corner === "ne") {
							x2 = x;
							y1 = y;
						} else if (activeHandle.corner === "sw") {
							x1 = x;
							y2 = y;
						} else if (activeHandle.corner === "se") {
							x2 = x;
							y2 = y;
						}
					}
					const newX = Math.min(x1, x2);
					const newY = Math.min(y1, y2);
					return {
						...s,
						x: newX,
						y: newY,
						width: Math.abs(x2 - x1),
						height: Math.abs(y2 - y1),
					};
				}
				if (s.type === "line" && activeHandle.kind === "line-end") {
					if (activeHandle.end === 1) return { ...s, x, y };
					return { ...s, x2: x, y2: y };
				}
				return s;
			});
		}
	};

	const handlePointerUp = () => {
		setIsPointerDown(false);
		setActiveHandle(null);

		if (groupDragRef.current) {
			const originals = groupDragRef.current.originals;
			const cmds = Object.values(originals).map((shape) => ({
				tool: "replaceShape" as const,
				shape: JSON.parse(JSON.stringify(shape)) as CanvasShape,
			}));
			if (cmds.length)
				setUndoStack((stack) => [...stack, cmds as Array<AnyCommand>]);
			groupDragRef.current = null;
		}

		if (marquee) {
			const norm = {
				x: Math.min(marquee.x, marquee.x + marquee.width),
				y: Math.min(marquee.y, marquee.y + marquee.height),
				width: Math.abs(marquee.width),
				height: Math.abs(marquee.height),
			};
			const ids = shapes
				.filter((s) => rectsIntersect(getShapeBounds(s), norm))
				.map((s) => s.id);
			setSelectedIds(ids);
			setSelectedId(ids[ids.length - 1] ?? null);
			setMarquee(null);
		}

		if (isLassoing) {
			setIsLassoing(false);
			if (lassoImageId && lassoPoints.length > 2) {
				setLassoPending({ imageId: lassoImageId, points: lassoPoints });
				setRcText("");
				setRcPlaceholder("Describe edit for selected region…");
				const cx =
					lassoPoints.reduce((a, p) => a + p.x, 0) / lassoPoints.length;
				const cy =
					lassoPoints.reduce((a, p) => a + p.y, 0) / lassoPoints.length;
				const pos = screenPointFromSvg(cx, cy);
				setRcPos({ left: pos.left + 8, top: pos.top + 8 });
				setRcOpen(true);
			}
			setLassoImageId(null);
			setLassoPoints([]);
		}

		if (draftId) {
			const draft = shapes.find((s) => s.id === draftId);
			if (draft) {
				if (
					(draft.type === "rect" || draft.type === "ellipse") &&
					(draft.width < 2 || draft.height < 2)
				) {
					removeShapeById(draftId);
					setSelectedId(null);
					setSelectedIds([]);
				} else if (
					draft.type === "line" &&
					Math.hypot(draft.x2 - draft.x, draft.y2 - draft.y) < 2
				) {
					removeShapeById(draftId);
					setSelectedId(null);
					setSelectedIds([]);
				} else {
					const createdId = createdShapeIdRef.current;
					if (createdId) {
						setUndoStack((stack) => [
							...stack,
							[{ tool: "deleteObject", id: createdId }],
						]);
					}
				}
			}
			setDraftId(null);
			if (
				tool === "draw-rect" ||
				tool === "draw-ellipse" ||
				tool === "draw-line"
			) {
				onToolChange("select");
			}
		}

		if (!draftId && interactionOriginalRef.current) {
			const original = interactionOriginalRef.current;
			const current = shapes.find((s) => s.id === original.id);
			if (current) {
				const changed = JSON.stringify(original) !== JSON.stringify(current);
				if (changed) {
					setUndoStack((stack) => [
						...stack,
						[{ tool: "replaceShape", shape: original }],
					]);
				}
			}
		}
		interactionOriginalRef.current = null;
		createdShapeIdRef.current = null;
	};

	const runLassoEdit = useCallback(
		async (
			imageId: string,
			points: Array<{ x: number; y: number }>,
			prompt: string,
		) => {
			await externalRunLassoEdit(imageId, points, prompt, {
				shapes,
				setShapes,
				setUndoStack,
				editCanvasImage,
			});
		},
		[shapes, editCanvasImage, setUndoStack],
	);

	const onShapePointerDown = (
		e: React.PointerEvent,
		shape: CanvasShape,
		mode: "move" | { resize: "nw" | "ne" | "sw" | "se" } | { lineEnd: 1 | 2 },
	) => {
		e.stopPropagation();
		if (e.button !== 0) return;
		onActivate();
		setIsPointerDown(true);
		if (!selectedIds.includes(shape.id)) {
			setSelectedIds([shape.id]);
		}
		setSelectedId(shape.id);
		const { x, y } = svgPoint(e);
		interactionOriginalRef.current = JSON.parse(
			JSON.stringify(shape),
		) as CanvasShape;

		if (tool === "lasso" && shape.type === "image") {
			setIsLassoing(true);
			setLassoPoints([{ x, y }]);
			setLassoImageId(shape.id);
			return;
		}
		if (mode === "move") {
			if (tool === "select") {
				const currentSelection = selectedIds.includes(shape.id)
					? selectedIds
					: [shape.id];
				const originals: Record<string, CanvasShape> = {};
				for (const id of currentSelection) {
					const s = shapes.find((sh) => sh.id === id);
					if (s) originals[id] = JSON.parse(JSON.stringify(s)) as CanvasShape;
				}
				groupDragRef.current = { startX: x, startY: y, originals };
				return;
			}
		}
		if (typeof mode === "object" && "resize" in mode) {
			setActiveHandle({ kind: "corner", corner: mode.resize });
			return;
		}
		if (typeof mode === "object" && "lineEnd" in mode) {
			setActiveHandle({ kind: "line-end", end: mode.lineEnd });
			return;
		}
	};

	const commitTextEdit = useCallback(() => {
		if (!editingTextId) return;
		const value = textEditorValue.trim();
		if (value.length === 0) {
			removeShapeById(editingTextId);
			setSelectedId(null);
		} else {
			setShapeById(editingTextId, (s) =>
				s.type === "text" ? { ...s, text: value } : s,
			);
		}
		setEditingTextId(null);
		setTextEditorValue("");
	}, [editingTextId, removeShapeById, setShapeById, textEditorValue]);

	const cancelTextEdit = useCallback(() => {
		setEditingTextId(null);
		setTextEditorValue("");
	}, []);

	// Calculate scale to fit canvas in container
	const containerPadding = 40;
	const maxWidth = 800;
	const maxHeight = 600;
	const scale = Math.min(
		(maxWidth - containerPadding) / design.width,
		(maxHeight - containerPadding) / design.height,
		1,
	);
	const displayWidth = design.width * scale;
	const displayHeight = design.height * scale;

	return (
		<div className="flex-shrink-0">
			<div className="mb-2 flex items-center gap-2">
				<span className="text-sm font-medium text-slate-700 dark:text-slate-300">
					{design.name}
				</span>
				<span className="text-xs text-slate-500">
					{design.width} × {design.height}
				</span>
			</div>
			<div
				className={`relative bg-slate-200 dark:bg-slate-800 rounded-lg overflow-hidden ${
					isActive ? "ring-2 ring-violet-500" : "opacity-60"
				}`}
				style={{
					width: displayWidth + containerPadding,
					height: displayHeight + containerPadding,
				}}
				onClick={onActivate}
			>
				{isActive && (
					<div className="absolute right-2 top-2 z-20">
						<PropertiesPanel
							selectedShape={selectedShape}
							setShapeById={setShapeById}
							setUndoSnapshot={(shapeId: string) => {
								const prev = shapes.find((s) => s.id === shapeId);
								if (prev)
									setUndoStack((stack) => [
										...stack,
										[
											{
												tool: "replaceShape",
												shape: JSON.parse(JSON.stringify(prev)),
											},
										],
									]);
							}}
						/>
					</div>
				)}

				<svg
					ref={svgRef}
					width={displayWidth}
					height={displayHeight}
					viewBox={`0 0 ${design.width} ${design.height}`}
					className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 touch-none cursor-crosshair shadow-lg"
					style={{ background: "white" }}
					onPointerDown={handlePointerDown}
					onPointerMove={handlePointerMove}
					onPointerUp={handlePointerUp}
					onContextMenu={handleContextMenu}
					onDragOver={(e) => {
						e.preventDefault();
						e.dataTransfer.dropEffect = "copy";
					}}
					onDrop={(e) => {
						e.preventDefault();
						const files = Array.from(e.dataTransfer.files || []);
						if (files.length === 0) return;
						const { x, y } = svgPointFromScreen(e.clientX, e.clientY);
						for (const file of files) {
							if (!file.type.startsWith("image/")) continue;
							void (async () => {
								try {
									const {
										dataUrl,
										width: imgW,
										height: imgH,
									} = await readImageFile(file);
									const id = createShapeId("img");
									setShapes((prev) => [
										...prev,
										{
											id,
											type: "image",
											x,
											y,
											width: Math.min(imgW, 512),
											height: Math.min(imgH, 512),
											href: dataUrl,
										} as ImageShape,
									]);
									setUndoStack((stack) => [
										...stack,
										[{ tool: "deleteObject", id }],
									]);
									setSelectedId(id);
									setSelectedIds([id]);
								} catch {
									// ignore
								}
							})();
						}
					}}
				>
					<title>Canvas</title>
					<defs>
						<pattern
							id={`checker-${design.id}`}
							patternUnits="userSpaceOnUse"
							width="20"
							height="20"
						>
							<rect x="0" y="0" width="20" height="20" fill="#ffffff" />
							<path
								d="M20 0 H0 V20"
								fill="none"
								stroke="#f1f5f9"
								strokeWidth="1"
							/>
						</pattern>
					</defs>
					<rect
						x={0}
						y={0}
						width={design.width}
						height={design.height}
						fill={`url(#checker-${design.id})`}
					/>

					{shapes.map((s) => (
						<ShapeView
							key={s.id}
							shape={s}
							selected={selectedIds.includes(s.id)}
							onPointerDown={onShapePointerDown}
							tool={tool}
						/>
					))}

					{isLassoing && lassoPoints.length > 1 && (
						<polyline
							points={lassoPoints.map((p) => `${p.x},${p.y}`).join(" ")}
							fill="none"
							stroke="#0ea5e9"
							strokeWidth={1.5}
						/>
					)}

					{marquee && (
						<rect
							x={Math.min(marquee.x, marquee.x + marquee.width)}
							y={Math.min(marquee.y, marquee.y + marquee.height)}
							width={Math.abs(marquee.width)}
							height={Math.abs(marquee.height)}
							fill="#60a5fa22"
							stroke="#3b82f6"
							strokeDasharray="4 2"
							strokeWidth={1}
						/>
					)}
				</svg>

				{editingTextId && (
					<textarea
						ref={textEditorRef}
						style={{
							position: "absolute",
							left: textEditorPos.left * scale + containerPadding / 2,
							top: textEditorPos.top * scale + containerPadding / 2,
							fontSize: textEditorPos.fontSize * scale,
							lineHeight: `${textEditorPos.fontSize * 1.2 * scale}px`,
							background: "transparent",
							color: "#0f172a",
							outline: "none",
							border: "1px dashed #94a3b8",
							padding: 2,
							whiteSpace: "pre",
						}}
						value={textEditorValue}
						onChange={(e) => setTextEditorValue(e.target.value)}
						onBlur={commitTextEdit}
						onKeyDown={(e) => {
							if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
								e.preventDefault();
								commitTextEdit();
							} else if (e.key === "Escape") {
								e.preventDefault();
								cancelTextEdit();
							}
						}}
					/>
				)}
			</div>

			{/* Right-click command prompt */}
			{rcOpen &&
				createPortal(
					<div
						style={{
							position: "fixed",
							left: rcPos.left + 8,
							top: rcPos.top + 8,
							zIndex: 1000,
						}}
						className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md p-2 shadow-lg w-72"
					>
						<div className="text-xs opacity-70 mb-1">Chat instruct</div>
						<Input
							placeholder={rcPlaceholder}
							value={rcText}
							onChange={(e) => setRcText(e.target.value)}
							autoFocus
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									e.preventDefault();
									if (!rcText.trim() || rcBusy) return;
									setRcBusy(true);
									void (async () => {
										if (lassoPending) {
											await runLassoEdit(
												lassoPending.imageId,
												lassoPending.points,
												rcText.trim(),
											);
											setLassoPending(null);
											setRcOpen(false);
											return;
										}
										const res = await interpret({ input: rcText.trim() });
										applyCommandGroup(res.commands, { recordUndo: true });
										setRcOpen(false);
									})()
										.catch(() => {})
										.finally(() => setRcBusy(false));
								}
								if (e.key === "Escape") {
									setRcOpen(false);
								}
							}}
						/>
						<div className="mt-2 flex justify-end gap-2">
							<Button
								variant="ghost"
								size="sm"
								onClick={() => setRcOpen(false)}
							>
								Cancel
							</Button>
							<Button
								disabled={rcBusy || !rcText.trim()}
								size="sm"
								onClick={() => {
									if (!rcText.trim() || rcBusy) return;
									setRcBusy(true);
									void (async () => {
										if (lassoPending) {
											await runLassoEdit(
												lassoPending.imageId,
												lassoPending.points,
												rcText.trim(),
											);
											setLassoPending(null);
											setRcOpen(false);
											return;
										}
										const res = await interpret({ input: rcText.trim() });
										applyCommandGroup(res.commands, { recordUndo: true });
										setRcOpen(false);
									})()
										.catch(() => {})
										.finally(() => setRcBusy(false));
								}}
							>
								{rcBusy ? "Working…" : "Run"}
							</Button>
						</div>
					</div>,
					document.body,
				)}
		</div>
	);
}

export const DesignCanvas = forwardRef<DesignCanvasRef, DesignCanvasProps>(
	function DesignCanvas(
		{
			designs,
			activeDesignId,
			onActivate,
			onShapesChange,
			tool,
			onToolChange,
			onUndoStackChange,
		},
		ref,
	) {
		// Store shapes per design for retrieval
		const shapesMapRef = useRef<Map<string, CanvasShape[]>>(new Map());
		// Store undo stacks per design
		const undoStackRef = useRef<Map<string, Array<Array<AnyCommand>>>>(
			new Map(),
		);
		// Track which design can undo
		const [canUndoMap, setCanUndoMap] = useState<Map<string, boolean>>(
			new Map(),
		);

		// Expose ref methods
		useImperativeHandle(ref, () => ({
			getShapes: (designId: string) => {
				return shapesMapRef.current.get(designId) ?? [];
			},
			undo: () => {
				if (!activeDesignId) return;
				const stack = undoStackRef.current.get(activeDesignId) ?? [];
				if (stack.length === 0) return;
				// Undo is handled by keyboard shortcut in SingleDesignCanvas
				// This is a fallback - dispatch a keyboard event
				const event = new KeyboardEvent("keydown", {
					key: "z",
					ctrlKey: true,
					bubbles: true,
				});
				window.dispatchEvent(event);
			},
			resetView: () => {
				// Reset view clears selection - handled by parent if needed
			},
			canUndo: () => {
				if (!activeDesignId) return false;
				return canUndoMap.get(activeDesignId) ?? false;
			},
		}));

		const handleShapesChange = useCallback(
			(designId: string, shapes: CanvasShape[]) => {
				shapesMapRef.current.set(designId, shapes);
				onShapesChange?.(designId, shapes);
			},
			[onShapesChange],
		);

		const handleUndoStackChange = useCallback(
			(designId: string, canUndo: boolean) => {
				setCanUndoMap((prev) => {
					const next = new Map(prev);
					next.set(designId, canUndo);
					return next;
				});
				onUndoStackChange?.(designId, canUndo);
			},
			[onUndoStackChange],
		);

		return (
			<div className="flex-1 overflow-x-auto overflow-y-hidden p-6">
				<div className="flex gap-6 min-w-min">
					{designs.map((design) => (
						<SingleDesignCanvas
							key={design.id}
							design={design}
							isActive={activeDesignId === design.id}
							onActivate={() => onActivate(design.id)}
							tool={tool}
							onToolChange={onToolChange}
							onShapesChange={(shapes) => handleShapesChange(design.id, shapes)}
							undoStackRef={undoStackRef}
							onUndoStackChange={(canUndo) =>
								handleUndoStackChange(design.id, canUndo)
							}
						/>
					))}
				</div>
			</div>
		);
	},
);
