import type { AnyCommand, CanvasShape, ImageShape } from "./types";

export async function runLassoEdit(
	imageId: string,
	points: Array<{ x: number; y: number }>,
	prompt: string,
	deps: {
		shapes: Array<CanvasShape>;
		setShapes: (fn: (prev: Array<CanvasShape>) => Array<CanvasShape>) => void;
		setUndoStack: (
			fn: (stack: Array<Array<AnyCommand>>) => Array<Array<AnyCommand>>,
		) => void;
		editCanvasImage: (args: {
			dataUrl: string;
			prompt: string;
		}) => Promise<{ storageUrl: string; mimeType: string }>;
	},
): Promise<void> {
	const { shapes, setShapes, setUndoStack, editCanvasImage } = deps;
	const img = shapes.find(
		(s): s is ImageShape => s.id === imageId && s.type === "image",
	);
	if (!img) return;
	// Optional: create a mask for future masked API support
	const maskCanvas = document.createElement("canvas");
	maskCanvas.width = Math.max(1, Math.round(img.width));
	maskCanvas.height = Math.max(1, Math.round(img.height));
	const ctx2d = maskCanvas.getContext("2d");
	if (ctx2d) {
		ctx2d.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
		ctx2d.fillStyle = "rgba(255,255,255,1)";
		ctx2d.beginPath();
		for (let i = 0; i < points.length; i++) {
			const px = points[i].x - img.x;
			const py = points[i].y - img.y;
			if (i === 0) ctx2d.moveTo(px, py);
			else ctx2d.lineTo(px, py);
		}
		ctx2d.closePath();
		ctx2d.fill();
	}
	const before = JSON.parse(JSON.stringify(img)) as ImageShape;
	setUndoStack((stack) => [
		...stack,
		[{ tool: "replaceShape", shape: before }],
	]);
	const res = await editCanvasImage({
		dataUrl: img.href,
		prompt: `${prompt} (apply only inside lassoed region)`,
	});
	// Use storage URL instead of base64
	setShapes((prev) =>
		prev.map((s) => (s.id === img.id ? { ...img, href: res.storageUrl } : s)),
	);
}
