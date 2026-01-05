export function createShapeId(prefix: string = "shape"): string {
	return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function clientToSvg(
	svg: SVGSVGElement,
	clientX: number,
	clientY: number,
): { x: number; y: number } {
	const pt = svg.createSVGPoint();
	pt.x = clientX;
	pt.y = clientY;
	const screenToSvg = pt.matrixTransform(
		svg.getScreenCTM()?.inverse() || undefined,
	);
	return { x: screenToSvg.x, y: screenToSvg.y };
}

export function svgToClient(
	svg: SVGSVGElement,
	x: number,
	y: number,
): { left: number; top: number } {
	const pt = svg.createSVGPoint();
	pt.x = x;
	pt.y = y;
	const screen = pt.matrixTransform(svg.getScreenCTM() || undefined);
	return { left: screen.x, top: screen.y };
}

export async function readImageFile(file: File): Promise<{
	dataUrl: string;
	width: number;
	height: number;
}> {
	const dataUrl: string = await new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(file);
	});
	const { width, height } = await new Promise<{
		width: number;
		height: number;
	}>((resolve, reject) => {
		const img = new Image();
		img.onload = () =>
			resolve({
				width: img.naturalWidth || img.width,
				height: img.naturalHeight || img.height,
			});
		img.onerror = (e) => reject(e);
		img.src = dataUrl;
	});
	return { dataUrl, width, height };
}
