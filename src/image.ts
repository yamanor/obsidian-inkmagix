import { arrayBufferToBase64 } from "obsidian";
import { fitSize } from "./util";

/** An image the user added (picked file or camera capture). */
export interface InputImage {
	name: string;
	blob: Blob;
}

export interface PreparedImage {
	base64: string;
	mediaType: "image/jpeg";
	width: number;
	height: number;
	bytes: number;
}

/** Base64 must stay under the API's 5 MB/image limit; leave headroom. */
const MAX_BASE64_BYTES = 4_800_000;

function loadImage(blob: Blob): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const url = URL.createObjectURL(blob);
		const img = new Image();
		img.onload = () => {
			URL.revokeObjectURL(url);
			resolve(img);
		};
		img.onerror = () => {
			URL.revokeObjectURL(url);
			reject(new Error("decode"));
		};
		img.src = url;
	});
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
	return new Promise((resolve, reject) =>
		canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode image."))), "image/jpeg", quality),
	);
}

/**
 * Decode → apply EXIF orientation → downscale (long edge ≤ maxEdge, ≤ ~3.75 MP) → JPEG → base64.
 * <img> elements honor EXIF orientation by default (CSS image-orientation: from-image) in Chromium and WebKit,
 * and drawImage() of an <img> keeps that orientation.
 */
export async function prepareImage(input: InputImage, maxEdge: number): Promise<PreparedImage> {
	let img: HTMLImageElement;
	try {
		img = await loadImage(input.blob);
	} catch {
		const heic = /\.(heic|heif)$/i.test(input.name) || /hei[cf]/i.test(input.blob.type);
		throw new Error(
			heic
				? `"${input.name}" is HEIC, which this device can't decode. Export it as JPEG/PNG first.`
				: `Could not read "${input.name}" as an image.`,
		);
	}

	const { width, height } = fitSize(img.naturalWidth, img.naturalHeight, maxEdge);
	const canvas = createEl("canvas");
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Canvas not available.");
	// White background so transparent PNGs don't turn black in JPEG.
	ctx.fillStyle = "#ffffff";
	ctx.fillRect(0, 0, width, height);
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = "high";
	ctx.drawImage(img, 0, 0, width, height);

	let base64 = "";
	let bytes = 0;
	for (const q of [0.85, 0.75, 0.6, 0.45]) {
		const blob = await canvasToBlob(canvas, q);
		base64 = arrayBufferToBase64(await blob.arrayBuffer());
		bytes = blob.size;
		if (base64.length <= MAX_BASE64_BYTES) break;
	}
	// Release canvas memory early (matters on mobile).
	canvas.width = canvas.height = 0;
	if (base64.length > MAX_BASE64_BYTES) throw new Error(`"${input.name}" is too large even after compression.`);
	return { base64, mediaType: "image/jpeg", width, height, bytes };
}

/** File extension for saving the original bytes. */
export function extensionFor(input: InputImage): string {
	const fromName = input.name.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
	if (fromName) return fromName === "jpeg" ? "jpg" : fromName;
	const map: Record<string, string> = {
		"image/jpeg": "jpg",
		"image/png": "png",
		"image/webp": "webp",
		"image/gif": "gif",
		"image/bmp": "bmp",
		"image/heic": "heic",
	};
	return map[input.blob.type] ?? "jpg";
}
