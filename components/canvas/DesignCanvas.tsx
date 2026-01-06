"use client";

import { useAction, useMutation, useQuery } from "convex/react";
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
import { runLassoEdit as externalRunLassoEdit } from "@/components/canvas/imageLasso";
import {
	applyOperations,
	type CanvasOperation,
	createAddShapeOp,
	createDeleteShapeOp,
	createUpdateShapeOp,
	getShapeChanges,
	invertOperation,
	safeDeserializeOperation,
	serializeOperation,
} from "@/components/canvas/operations";
import { PropertiesPanel } from "@/components/canvas/PropertiesPanel";
import { renderCanvasContext } from "@/components/canvas/renderContext";
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
	PathShape,
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
import type { Id } from "../../convex/_generated/dataModel";

// Type definitions for the designOperations API
// These match the actual mutations/queries in convex/designOperations.ts
interface ApplyOperationsResult {
	success: boolean;
	lastCreationTime: number;
	appliedCount: number;
}

interface RemoteOperation {
	operationId: string;
	operation: string;
	clientId: string;
	clientTimestamp: number;
	creationTime: number;
}

// Access the designOperations API (types are manually defined until regenerated)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const designOpsApi = (api as any).designOperations as {
	applyOperations: (args: {
		designId: Id<"designs">;
		clientId: string;
		operations: Array<{
			operationId: string;
			operation: string;
			timestamp: number;
		}>;
	}) => Promise<ApplyOperationsResult>;
	getOperationsSince: (args: {
		designId: Id<"designs">;
		sinceCreationTime: number;
		excludeClientId?: string;
	}) => RemoteOperation[];
};

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
	if (s.type === "path") {
		if (s.points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
		const xs = s.points.map((p) => p.x);
		const ys = s.points.map((p) => p.y);
		const minX = Math.min(...xs);
		const minY = Math.min(...ys);
		const maxX = Math.max(...xs);
		const maxY = Math.max(...ys);
		return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
	}
	return {
		x: (s as { x?: number }).x ?? 0,
		y: (s as { y?: number }).y ?? 0,
		width: 0,
		height: 0,
	};
}

// Generate a unique client ID for this session
function generateClientId(): string {
	return `client_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// Internal component for a single design canvas
interface SingleDesignCanvasProps {
	design: DesignData;
	isActive: boolean;
	onActivate: (designId: string) => void;
	tool: Tool;
	onToolChange: (tool: Tool) => void;
	clientId: string;
	onCanUndoChange?: (designId: string, canUndo: boolean) => void;
	registerUndo?: (designId: string, undoFn: () => boolean) => void;
}

function SingleDesignCanvas({
	design,
	isActive,
	onActivate,
	tool,
	onToolChange,
	clientId,
	onCanUndoChange,
	registerUndo,
}: SingleDesignCanvasProps) {
	// Local shapes state for immediate UI feedback
	const [shapes, setShapes] = useState<CanvasShape[]>(design.initialShapes);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [selectedIds, setSelectedIds] = useState<Array<string>>([]);
	const [isPointerDown, setIsPointerDown] = useState(false);
	const [draftId, setDraftId] = useState<string | null>(null);
	const [pencilDraftId, setPencilDraftId] = useState<string | null>(null);
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

	// Track interaction state for operation creation
	const interactionOriginalRef = useRef<CanvasShape | null>(null);
	const createdShapeIdRef = useRef<string | null>(null);

	// Operation-based undo stack
	const [undoStack, setUndoStack] = useState<CanvasOperation[]>([]);

	// Track which design we've initialized
	const initializedForDesignRef = useRef<string | null>(null);

	// Pending operations to send to server
	const pendingOpsRef = useRef<CanvasOperation[]>([]);
	const flushTimeoutRef = useRef<number | null>(null);
	// Track last seen _creationTime for sync (following Convex+Automerge pattern)
	// Using state (not ref) so useQuery re-runs when this changes
	const [lastCreationTime, setLastCreationTime] = useState<number>(0);

	// Convex mutations - using type assertion until types are regenerated
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const applyOpsMutation = useMutation(designOpsApi.applyOperations as any);

	// Subscribe to remote operations (from other clients)
	// Using _creationTime for ordering as recommended by:
	// https://stack.convex.dev/automerge-and-convex
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const remoteOps = useQuery(
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		designOpsApi.getOperationsSince as any,
		design.id
			? {
					designId: design.id as Id<"designs">,
					sinceCreationTime: lastCreationTime,
					excludeClientId: clientId,
				}
			: "skip",
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
		imageId: string | null; // null means general context, string means image-specific edit
		points: Array<{ x: number; y: number }>;
	}>(null);

	// Marquee selection
	const [marquee, setMarquee] = useState<null | {
		x: number;
		y: number;
		width: number;
		height: number;
	}>(null);

	// Track applied operation IDs to prevent duplicate application
	const appliedOpIdsRef = useRef<Set<string>>(new Set());

	// Initialize shapes when design changes
	useEffect(() => {
		if (initializedForDesignRef.current !== design.id) {
			setShapes(design.initialShapes);
			setUndoStack([]);
			setLastCreationTime(0);
			appliedOpIdsRef.current.clear();
			initializedForDesignRef.current = design.id;
		}
	}, [design.id, design.initialShapes]);

	// Apply remote operations when they arrive
	// Following the sync pattern from: https://stack.convex.dev/automerge-and-convex
	useEffect(() => {
		if (!remoteOps || remoteOps.length === 0) return;

		// Filter out operations we've already applied (deduplication)
		// and validate incoming operations
		const newOps: CanvasOperation[] = [];
		let maxCreationTime = lastCreationTime;

		for (const op of remoteOps as Array<{
			operationId: string;
			operation: string;
			creationTime: number;
		}>) {
			if (!appliedOpIdsRef.current.has(op.operationId)) {
				// Use safe deserialization to gracefully handle corrupted data
				const deserializedOp = safeDeserializeOperation(op.operation);
				if (deserializedOp) {
					newOps.push(deserializedOp);
					appliedOpIdsRef.current.add(op.operationId);
				}
				// If null, the operation was invalid - skip it but still track the ID
				// to avoid re-processing
				else {
					appliedOpIdsRef.current.add(op.operationId);
				}
			}
			maxCreationTime = Math.max(maxCreationTime, op.creationTime);
		}

		if (newOps.length > 0) {
			setShapes((prev) => applyOperations(prev, newOps));
		}

		// Update the last seen _creationTime
		if (maxCreationTime > lastCreationTime) {
			setLastCreationTime(maxCreationTime);
		}
	}, [remoteOps, lastCreationTime]);

	// Notify parent of undo stack changes
	useEffect(() => {
		onCanUndoChange?.(design.id, undoStack.length > 0);
	}, [design.id, undoStack.length, onCanUndoChange]);

	// Flush pending operations to server
	// Following the sync pattern from: https://stack.convex.dev/automerge-and-convex
	const flushPendingOps = useCallback(async () => {
		if (!design.id || pendingOpsRef.current.length === 0) return;

		const opsToSend = pendingOpsRef.current;
		pendingOpsRef.current = [];

		// Mark these operation IDs as applied so we don't re-apply from subscription
		for (const op of opsToSend) {
			appliedOpIdsRef.current.add(op.id);
		}

		try {
			const result = await applyOpsMutation({
				designId: design.id as Id<"designs">,
				clientId,
				operations: opsToSend.map((op) => ({
					operationId: op.id,
					operation: serializeOperation(op),
					timestamp: op.timestamp,
				})),
			});

			// Update our _creationTime cursor to avoid reprocessing our own ops
			// The server returns the lastCreationTime from the inserted documents
			setLastCreationTime((prev) =>
				Math.max(prev, result.lastCreationTime ?? 0),
			);
		} catch (error) {
			console.error("Failed to apply operations:", error);
			// Re-queue the operations for retry (idempotency ensures safety)
			pendingOpsRef.current = [...opsToSend, ...pendingOpsRef.current];
		}
	}, [design.id, clientId, applyOpsMutation]);

	// Schedule a flush of pending operations
	const scheduleFlush = useCallback(() => {
		if (flushTimeoutRef.current) {
			clearTimeout(flushTimeoutRef.current);
		}
		// Debounce: wait 50ms before flushing (fast enough to feel instant)
		flushTimeoutRef.current = window.setTimeout(() => {
			void flushPendingOps();
			flushTimeoutRef.current = null;
		}, 50);
	}, [flushPendingOps]);

	// Apply an operation locally and queue for server
	const applyOperation = useCallback(
		(op: CanvasOperation, pushToUndo = true) => {
			// Apply locally (instant)
			setShapes((prev) => applyOperations(prev, [op]));

			// Add inverse to undo stack
			if (pushToUndo) {
				const inverse = invertOperation(clientId, op);
				setUndoStack((prev) => [...prev, inverse]);
			}

			// Queue for server
			pendingOpsRef.current.push(op);
			scheduleFlush();
		},
		[clientId, scheduleFlush],
	);

	// Operation-based shape manipulation methods
	const addShapeOp = useCallback(
		(shape: CanvasShape) => {
			const op = createAddShapeOp(clientId, shape);
			applyOperation(op);
		},
		[clientId, applyOperation],
	);

	const updateShapeOp = useCallback(
		(
			shapeId: string,
			currentShape: CanvasShape,
			updates: Partial<CanvasShape>,
		) => {
			const { updates: actualUpdates, previousValues } = getShapeChanges(
				currentShape,
				{ ...currentShape, ...updates } as CanvasShape,
			);
			if (Object.keys(actualUpdates).length === 0) return;

			const op = createUpdateShapeOp(
				clientId,
				shapeId,
				actualUpdates,
				previousValues,
			);
			applyOperation(op);
		},
		[clientId, applyOperation],
	);

	const deleteShapeOp = useCallback(
		(shape: CanvasShape) => {
			const op = createDeleteShapeOp(clientId, shape);
			applyOperation(op);
		},
		[clientId, applyOperation],
	);

	// Undo the last operation
	const undo = useCallback((): boolean => {
		if (undoStack.length === 0) return false;

		const inverseOp = undoStack[undoStack.length - 1];
		setUndoStack((prev) => prev.slice(0, -1));

		// Apply the inverse operation (don't push to undo stack)
		setShapes((prev) => applyOperations(prev, [inverseOp]));

		// Queue for server
		pendingOpsRef.current.push(inverseOp);
		scheduleFlush();

		return true;
	}, [undoStack, scheduleFlush]);

	// For AI commands that need the old command system
	const applyCommandGroup = useCallback(
		(commands: Array<AnyCommand>, _opts?: { recordUndo?: boolean }) => {
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
				// Convert commands to operations where possible
				for (const cmd of restCommands) {
					if (cmd.tool === "deleteObject" && "id" in cmd && cmd.id) {
						const shape = shapes.find((s) => s.id === cmd.id);
						if (shape) deleteShapeOp(shape);
					} else if (cmd.tool === "replaceShape" && "shape" in cmd) {
						const existingShape = shapes.find((s) => s.id === cmd.shape.id);
						if (existingShape) {
							updateShapeOp(cmd.shape.id, existingShape, cmd.shape);
						} else {
							addShapeOp(cmd.shape);
						}
					} else if (cmd.tool === "changeColor") {
						// Handle color changes from AI
						const targetId = cmd.id || cmd.target || selectedId;
						if (!targetId) continue;
						const shape = shapes.find((s) => s.id === targetId);
						if (!shape) continue;
						const updates: Partial<CanvasShape> = {};
						if (cmd.fill !== undefined) updates.fill = cmd.fill;
						if (cmd.stroke !== undefined) updates.stroke = cmd.stroke;
						if (Object.keys(updates).length > 0) {
							updateShapeOp(targetId, shape, updates);
						}
					} else if (cmd.tool === "moveObject") {
						// Handle move from AI
						const targetId = cmd.id || cmd.target || selectedId;
						if (!targetId) continue;
						const shape = shapes.find((s) => s.id === targetId);
						if (!shape) continue;
						const dx = cmd.dx ?? 0;
						const dy = cmd.dy ?? 0;
						if (shape.type === "line") {
							updateShapeOp(targetId, shape, {
								x: shape.x + dx,
								y: shape.y + dy,
								x2: shape.x2 + dx,
								y2: shape.y2 + dy,
							} as Partial<CanvasShape>);
						} else {
							updateShapeOp(targetId, shape, {
								x: shape.x + dx,
								y: shape.y + dy,
							});
						}
					} else if (cmd.tool === "resize") {
						// Handle resize from AI
						const targetId = cmd.id || cmd.target || selectedId;
						if (!targetId) continue;
						const shape = shapes.find((s) => s.id === targetId);
						if (!shape) continue;
						if (
							shape.type === "rect" ||
							shape.type === "ellipse" ||
							shape.type === "image" ||
							shape.type === "svg"
						) {
							const updates: { width?: number; height?: number } = {};
							if (cmd.scale !== undefined) {
								updates.width = shape.width * cmd.scale;
								updates.height = shape.height * cmd.scale;
							} else {
								if (cmd.width !== undefined) updates.width = cmd.width;
								if (cmd.height !== undefined) updates.height = cmd.height;
							}
							if (Object.keys(updates).length > 0) {
								updateShapeOp(targetId, shape, updates as Partial<CanvasShape>);
							}
						}
					} else if (cmd.tool === "generateSvg" && "svg" in cmd && cmd.svg) {
						// Handle SVG generation from AI
						const id = cmd.id || createShapeId("svg");
						const newShape: CanvasShape = {
							id,
							type: "svg",
							x: cmd.x ?? 40,
							y: cmd.y ?? 40,
							width: cmd.width ?? 100,
							height: cmd.height ?? 100,
							svg: cmd.svg,
						};
						addShapeOp(newShape);
					}
				}
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
							const newShape: ImageShape = {
								id,
								type: "image",
								x: cmd.x ?? 40,
								y: cmd.y ?? 40,
								width: res.width,
								height: res.height,
								href: res.dataUrl,
							};
							addShapeOp(newShape);
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
							updateShapeOp(before.id, before, { href: res.dataUrl });
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
								// Delete originals and add combined
								for (const orig of originals) {
									deleteShapeOp(orig);
								}
								addShapeOp(combined);
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
			addShapeOp,
			updateShapeOp,
			deleteShapeOp,
		],
	);

	// Keyboard shortcuts (only when active)
	useEffect(() => {
		if (!isActive) return;

		const onKey = (e: KeyboardEvent) => {
			const isUndo = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z";
			if (isUndo) {
				e.preventDefault();
				undo();
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
				for (const id of idsToDelete) {
					const shape = shapes.find((s) => s.id === id);
					if (shape) deleteShapeOp(shape);
				}
				setSelectedId(null);
				setSelectedIds([]);
			}
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [isActive, selectedId, selectedIds, shapes, undo, deleteShapeOp]);

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

	// Local shape manipulation (for immediate UI feedback during gestures)
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
		onActivate(design.id);
		const { x, y } = svgPoint(e);
		setIsPointerDown(true);
		interactionOriginalRef.current = null;
		createdShapeIdRef.current = null;

		if (tool === "draw-rect") {
			const rect = createRect({ x, y, fill: "#94a3b833" });
			// Add locally for immediate feedback (draft)
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
			createdShapeIdRef.current = text.id;
			requestAnimationFrame(() => {
				textEditorRef.current?.focus();
			});
			return;
		}
		if (tool === "draw-pencil") {
			const id = createShapeId("path");
			const path: PathShape = {
				id,
				type: "path",
				x: 0,
				y: 0,
				points: [{ x, y }],
				stroke: "#0f172a",
				strokeWidth: 4,
			};
			setShapes((prev) => [...prev, path]);
			setPencilDraftId(id);
			// Don't select until drawing is complete (avoids selection box while drawing)
			createdShapeIdRef.current = id;
			return;
		}

		if (tool === "select") {
			setSelectedId(null);
			setSelectedIds([]);
			setMarquee({ x, y, width: 0, height: 0 });
		}

		if (tool === "lasso") {
			// Start lasso on empty canvas (for general context selection)
			setIsLassoing(true);
			setLassoPoints([{ x, y }]);
			setLassoImageId(null); // No specific image target
		}
	};

	const handleContextMenu = (e: React.MouseEvent) => {
		e.preventDefault();
		onActivate(design.id);
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

		if (pencilDraftId) {
			setShapeById(pencilDraftId, (s) => {
				if (s.type !== "path") return s;
				const lastPt = s.points[s.points.length - 1];
				// Only add point if moved enough (reduces point count)
				if (lastPt && Math.hypot(x - lastPt.x, y - lastPt.y) < 2) return s;
				return { ...s, points: [...s.points, { x, y }] };
			});
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
					if (o.type === "path") {
						const origPath = o as PathShape;
						return {
							...s,
							points: origPath.points.map((p) => ({
								x: p.x + dx,
								y: p.y + dy,
							})),
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
			const shiftKey = e.shiftKey;
			setShapeById(selectedId, (s) => {
				if (
					s.type === "rect" ||
					s.type === "ellipse" ||
					s.type === "image" ||
					s.type === "svg"
				) {
					const orig = interactionOriginalRef.current;
					const origWidth = orig && "width" in orig ? orig.width : s.width;
					const origHeight = orig && "height" in orig ? orig.height : s.height;
					const origX = orig ? orig.x : s.x;
					const origY = orig ? orig.y : s.y;
					const aspectRatio = origWidth / (origHeight || 1);

					let x1 = origX;
					let y1 = origY;
					let x2 = origX + origWidth;
					let y2 = origY + origHeight;

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

						// Preserve aspect ratio unless Shift is pressed
						if (!shiftKey) {
							const newWidth = Math.abs(x2 - x1);
							const newHeight = Math.abs(y2 - y1);
							const widthFromHeight = newHeight * aspectRatio;
							const heightFromWidth = newWidth / aspectRatio;

							// Use the larger dimension to determine size
							if (widthFromHeight > newWidth) {
								// Height is the constraining dimension
								const adjustedWidth = widthFromHeight;
								if (activeHandle.corner === "nw" || activeHandle.corner === "sw") {
									x1 = x2 - (x1 < x2 ? adjustedWidth : -adjustedWidth);
								} else {
									x2 = x1 + (x2 > x1 ? adjustedWidth : -adjustedWidth);
								}
							} else {
								// Width is the constraining dimension
								const adjustedHeight = heightFromWidth;
								if (activeHandle.corner === "nw" || activeHandle.corner === "ne") {
									y1 = y2 - (y1 < y2 ? adjustedHeight : -adjustedHeight);
								} else {
									y2 = y1 + (y2 > y1 ? adjustedHeight : -adjustedHeight);
								}
							}
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
				if (s.type === "path" && activeHandle.kind === "corner") {
					// Get original bounding box from interactionOriginalRef
					const orig = interactionOriginalRef.current;
					if (!orig || orig.type !== "path") return s;
					const origPoints = orig.points;
					if (origPoints.length === 0) return s;

					const oxs = origPoints.map((p) => p.x);
					const oys = origPoints.map((p) => p.y);
					const oldMinX = Math.min(...oxs);
					const oldMinY = Math.min(...oys);
					const oldMaxX = Math.max(...oxs);
					const oldMaxY = Math.max(...oys);
					const oldWidth = oldMaxX - oldMinX || 1;
					const oldHeight = oldMaxY - oldMinY || 1;
					const aspectRatio = oldWidth / oldHeight;

					// Calculate new bounding box based on corner being dragged
					let x1 = oldMinX;
					let y1 = oldMinY;
					let x2 = oldMaxX;
					let y2 = oldMaxY;
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

					// Preserve aspect ratio unless Shift is pressed
					if (!shiftKey) {
						const newWidth = Math.abs(x2 - x1);
						const newHeight = Math.abs(y2 - y1);
						const widthFromHeight = newHeight * aspectRatio;
						const heightFromWidth = newWidth / aspectRatio;

						if (widthFromHeight > newWidth) {
							const adjustedWidth = widthFromHeight;
							if (activeHandle.corner === "nw" || activeHandle.corner === "sw") {
								x1 = x2 - (x1 < x2 ? adjustedWidth : -adjustedWidth);
							} else {
								x2 = x1 + (x2 > x1 ? adjustedWidth : -adjustedWidth);
							}
						} else {
							const adjustedHeight = heightFromWidth;
							if (activeHandle.corner === "nw" || activeHandle.corner === "ne") {
								y1 = y2 - (y1 < y2 ? adjustedHeight : -adjustedHeight);
							} else {
								y2 = y1 + (y2 > y1 ? adjustedHeight : -adjustedHeight);
							}
						}
					}

					const newMinX = Math.min(x1, x2);
					const newMinY = Math.min(y1, y2);
					const newWidth = Math.abs(x2 - x1) || 1;
					const newHeight = Math.abs(y2 - y1) || 1;

					// Scale all points from old bbox to new bbox
					const newPoints = origPoints.map((p) => ({
						x: newMinX + ((p.x - oldMinX) / oldWidth) * newWidth,
						y: newMinY + ((p.y - oldMinY) / oldHeight) * newHeight,
					}));

					return { ...s, points: newPoints };
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

		// Commit group drag as operations
		// Note: Shapes are already in final position from handlePointerMove
		// We only need to create operations for persistence and undo
		if (groupDragRef.current) {
			const originals = groupDragRef.current.originals;
			for (const [id, originalShape] of Object.entries(originals)) {
				const currentShape = shapes.find((s) => s.id === id);
				if (currentShape && originalShape) {
					const { updates, previousValues } = getShapeChanges(
						originalShape,
						currentShape,
					);
					if (Object.keys(updates).length > 0) {
						const op = createUpdateShapeOp(
							clientId,
							id,
							updates,
							previousValues,
						);
						// Don't apply locally - shapes are already positioned
						// Just add to undo stack and queue for server
						setUndoStack((prev) => [...prev, invertOperation(clientId, op)]);
						pendingOpsRef.current.push(op);
					}
				}
			}
			scheduleFlush();
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
			if (lassoPoints.length > 2) {
				// Store lasso state - imageId is null for general context, string for image edit
				setLassoPending({ imageId: lassoImageId, points: lassoPoints });
				setRcText("");
				setRcPlaceholder(
					lassoImageId
						? "Describe edit for selected region…"
						: "Describe what to do with this area…",
				);
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

		// Commit pencil path as operation
		if (pencilDraftId) {
			const draft = shapes.find((s) => s.id === pencilDraftId);
			if (draft && draft.type === "path") {
				if (draft.points.length < 2) {
					// Too few points, remove without committing
					removeShapeById(pencilDraftId);
					setSelectedId(null);
					setSelectedIds([]);
				} else {
					// Valid path - commit as operation
					const op = createAddShapeOp(clientId, draft);
					setUndoStack((prev) => [...prev, invertOperation(clientId, op)]);
					pendingOpsRef.current.push(op);
					scheduleFlush();
					// Now select the completed path
					setSelectedId(pencilDraftId);
					setSelectedIds([pencilDraftId]);
				}
			}
			setPencilDraftId(null);
			if (tool === "draw-pencil") {
				onToolChange("select");
			}
		}

		// Commit draft shape as operation
		if (draftId) {
			const draft = shapes.find((s) => s.id === draftId);
			if (draft) {
				if (
					(draft.type === "rect" || draft.type === "ellipse") &&
					(draft.width < 2 || draft.height < 2)
				) {
					// Too small, remove without committing
					removeShapeById(draftId);
					setSelectedId(null);
					setSelectedIds([]);
				} else if (
					draft.type === "line" &&
					Math.hypot(draft.x2 - draft.x, draft.y2 - draft.y) < 2
				) {
					// Too small, remove without committing
					removeShapeById(draftId);
					setSelectedId(null);
					setSelectedIds([]);
				} else {
					// Valid shape - commit as operation
					// The shape is already in local state, so we just need to send the operation
					// and add to undo stack
					const op = createAddShapeOp(clientId, draft);
					setUndoStack((prev) => [...prev, invertOperation(clientId, op)]);
					pendingOpsRef.current.push(op);
					scheduleFlush();
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

		// Commit resize as operation
		if (!draftId && interactionOriginalRef.current) {
			const original = interactionOriginalRef.current;
			const current = shapes.find((s) => s.id === original.id);
			if (current) {
				const { updates, previousValues } = getShapeChanges(original, current);
				if (Object.keys(updates).length > 0) {
					const op = createUpdateShapeOp(
						clientId,
						original.id,
						updates,
						previousValues,
					);
					setUndoStack((prev) => [...prev, invertOperation(clientId, op)]);
					pendingOpsRef.current.push(op);
					scheduleFlush();
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
				setUndoStack: () => {}, // Undo handled differently now
				editCanvasImage,
			});
		},
		[shapes, editCanvasImage],
	);

	const onShapePointerDown = (
		e: React.PointerEvent,
		shape: CanvasShape,
		mode: "move" | { resize: "nw" | "ne" | "sw" | "se" } | { lineEnd: 1 | 2 },
	) => {
		e.stopPropagation();
		if (e.button !== 0) return;
		onActivate(design.id);
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
		const currentShape = shapes.find((s) => s.id === editingTextId);

		if (value.length === 0) {
			// Empty text - don't commit, just remove locally
			removeShapeById(editingTextId);
			setSelectedId(null);
		} else if (currentShape) {
			// Update text and commit as operation
			const updatedShape = { ...currentShape, text: value } as CanvasShape;
			setShapeById(editingTextId, () => updatedShape);

			// If this was a new shape, commit as add
			if (createdShapeIdRef.current === editingTextId) {
				const op = createAddShapeOp(clientId, updatedShape);
				setUndoStack((prev) => [...prev, invertOperation(clientId, op)]);
				pendingOpsRef.current.push(op);
				scheduleFlush();
				createdShapeIdRef.current = null;
			} else {
				// Existing shape, commit as update
				updateShapeOp(editingTextId, currentShape, {
					text: value,
				} as Partial<CanvasShape>);
			}
		}
		setEditingTextId(null);
		setTextEditorValue("");
	}, [
		editingTextId,
		textEditorValue,
		shapes,
		removeShapeById,
		setShapeById,
		clientId,
		scheduleFlush,
		updateShapeOp,
	]);

	const cancelTextEdit = useCallback(() => {
		if (editingTextId && createdShapeIdRef.current === editingTextId) {
			// Was a new shape, remove it
			removeShapeById(editingTextId);
			setSelectedId(null);
			createdShapeIdRef.current = null;
		}
		setEditingTextId(null);
		setTextEditorValue("");
	}, [editingTextId, removeShapeById]);

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

	// Cleanup on unmount - flush any pending operations
	useEffect(() => {
		return () => {
			if (flushTimeoutRef.current) {
				clearTimeout(flushTimeoutRef.current);
			}
			// Synchronously flush pending operations before unmount
			// This ensures no operations are lost when navigating away
			if (pendingOpsRef.current.length > 0) {
				void flushPendingOps();
			}
		};
	}, [flushPendingOps]);

	// Register undo method with parent
	useEffect(() => {
		registerUndo?.(design.id, undo);
	}, [design.id, undo, registerUndo]);

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
			<button
				type="button"
				className={`relative bg-slate-200 dark:bg-slate-800 rounded-lg overflow-hidden block text-left ${
					isActive ? "ring-2 ring-violet-500" : "opacity-60"
				}`}
				style={{
					width: displayWidth + containerPadding,
					height: displayHeight + containerPadding,
				}}
				onClick={() => onActivate(design.id)}
			>
				{isActive && (
					<div className="absolute right-2 top-2 z-20">
						<PropertiesPanel
							selectedShape={selectedShape}
							setShapeById={(id, updater) => {
								const currentShape = shapes.find((s) => s.id === id);
								if (!currentShape) return;
								const updatedShape = updater(currentShape);
								// Create update operation
								const { updates, previousValues } = getShapeChanges(
									currentShape,
									updatedShape,
								);
								if (Object.keys(updates).length > 0) {
									setShapeById(id, () => updatedShape);
									const op = createUpdateShapeOp(
										clientId,
										id,
										updates,
										previousValues,
									);
									setUndoStack((prev) => [
										...prev,
										invertOperation(clientId, op),
									]);
									pendingOpsRef.current.push(op);
									scheduleFlush();
								}
							}}
							setUndoSnapshot={() => {
								// No longer needed - undo handled by operations
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
									const newShape: ImageShape = {
										id,
										type: "image",
										x,
										y,
										width: Math.min(imgW, 512),
										height: Math.min(imgH, 512),
										href: dataUrl,
									};
									addShapeOp(newShape);
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
			</button>

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
										if (lassoPending?.imageId) {
											// Image-specific lasso edit
											await runLassoEdit(
												lassoPending.imageId,
												lassoPending.points,
												rcText.trim(),
											);
											setLassoPending(null);
											setRcOpen(false);
											return;
										}

										// Render visual context for AI
										// Use lasso points for context if available, otherwise selection
										const context = await renderCanvasContext({
											shapes,
											canvasWidth: design.width,
											canvasHeight: design.height,
											selectedIds:
												!lassoPending && selectedIds.length > 0
													? selectedIds
													: !lassoPending && selectedId
														? [selectedId]
														: undefined,
											lassoPoints: lassoPending?.points,
										});

										const res = await interpret({
											input: rcText.trim(),
											imageContext: context.dataUrl,
											contextDescription: context.description,
										});
										applyCommandGroup(res.commands, { recordUndo: true });
										setLassoPending(null);
										setRcOpen(false);
									})()
										.catch(() => {})
										.finally(() => setRcBusy(false));
								}
								if (e.key === "Escape") {
									setLassoPending(null);
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
										if (lassoPending?.imageId) {
											// Image-specific lasso edit
											await runLassoEdit(
												lassoPending.imageId,
												lassoPending.points,
												rcText.trim(),
											);
											setLassoPending(null);
											setRcOpen(false);
											return;
										}

										// Render visual context for AI
										// Use lasso points for context if available, otherwise selection
										const context = await renderCanvasContext({
											shapes,
											canvasWidth: design.width,
											canvasHeight: design.height,
											selectedIds:
												!lassoPending && selectedIds.length > 0
													? selectedIds
													: !lassoPending && selectedId
														? [selectedId]
														: undefined,
											lassoPoints: lassoPending?.points,
										});

										const res = await interpret({
											input: rcText.trim(),
											imageContext: context.dataUrl,
											contextDescription: context.description,
										});
										applyCommandGroup(res.commands, { recordUndo: true });
										setLassoPending(null);
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
			tool,
			onToolChange,
			onUndoStackChange,
		},
		ref,
	) {
		// Shared client ID for all canvases
		const clientIdRef = useRef<string>(generateClientId());

		// Store shapes per design for retrieval
		const shapesMapRef = useRef<Map<string, CanvasShape[]>>(new Map());

		// Store undo functions per design
		const undoFunctionsRef = useRef<Map<string, () => boolean>>(new Map());

		// Track which design can undo - using ref for synchronous comparison to prevent infinite loops
		const canUndoMapRef = useRef<Map<string, boolean>>(new Map());
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
				const undoFn = undoFunctionsRef.current.get(activeDesignId);
				if (undoFn) undoFn();
			},
			resetView: () => {
				// Reset view - could clear selection
			},
			canUndo: () => {
				if (!activeDesignId) return false;
				return canUndoMap.get(activeDesignId) ?? false;
			},
		}));

		const handleCanUndoChange = useCallback(
			(designId: string, canUndo: boolean) => {
				// Use ref for synchronous comparison to prevent infinite loops
				// The ref is checked BEFORE any state updates or parent callbacks
				if (canUndoMapRef.current.get(designId) === canUndo) {
					return; // No change - skip state update and parent callback entirely
				}

				// Update ref synchronously
				canUndoMapRef.current.set(designId, canUndo);

				// Update state for React rendering
				setCanUndoMap(new Map(canUndoMapRef.current));

				// Notify parent - only called when value actually changed
				onUndoStackChange?.(designId, canUndo);
			},
			[onUndoStackChange],
		);

		// Stable callback for registering undo functions
		const handleRegisterUndo = useCallback(
			(designId: string, undoFn: () => boolean) => {
				undoFunctionsRef.current.set(designId, undoFn);
			},
			[],
		);

		return (
			<div className="flex-1 overflow-x-auto overflow-y-hidden p-6">
				<div className="flex gap-6 min-w-min">
					{designs.map((design) => (
						<SingleDesignCanvas
							key={design.id}
							design={design}
							isActive={activeDesignId === design.id}
							onActivate={onActivate}
							tool={tool}
							onToolChange={onToolChange}
							clientId={clientIdRef.current}
							onCanUndoChange={handleCanUndoChange}
							registerUndo={handleRegisterUndo}
						/>
					))}
				</div>
			</div>
		);
	},
);
