import { App, TFile, loadMermaid, normalizePath } from "obsidian";
import type { BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { ClaudeClient, ConversionError, Progress } from "./claude";
import { InputImage, PreparedImage, extensionFor, prepareImage } from "./image";
import { repairInstruction, systemPrompt, userInstruction } from "./prompts";
import { API_KEY_SECRET_ID, DiagramFormat, InkMagixSettings, attachmentsFolderOf } from "./settings";
import {
	estimateCost,
	extractDrawioXml,
	extractMermaidBlocks,
	parseResponse,
	sanitizeFileName,
	uniquePath,
	validateDrawioXml,
} from "./util";

export interface ConvertOptions {
	format: DiagramFormat;
	extraInstructions: string;
	title: string;
}

export interface ConvertResult {
	file: TFile;
	summary: string;
}

/** Request payload limit is 32 MB; keep total image data well under it. */
const MAX_TOTAL_BASE64 = 28_000_000;
export const MAX_IMAGES = 10;

export async function convertImages(
	app: App,
	settings: InkMagixSettings,
	images: InputImage[],
	opts: ConvertOptions,
	signal: AbortSignal,
	status: (msg: string) => void,
): Promise<ConvertResult> {
	if (images.length === 0) throw new ConversionError("Add at least one image.");
	if (images.length > MAX_IMAGES) throw new ConversionError(`At most ${MAX_IMAGES} images per conversion.`);
	const apiKey = app.secretStorage.getSecret(API_KEY_SECRET_ID)?.trim();
	if (!apiKey) throw new ConversionError("Set your Anthropic API key in InkMagix settings first.");
	const client = new ClaudeClient(settings, apiKey);

	// 1. Prepare images.
	const prepared: PreparedImage[] = [];
	for (const [i, img] of images.entries()) {
		status(`Preparing image ${i + 1}/${images.length}…`);
		prepared.push(await prepareImage(img, settings.maxImageEdge));
		if (signal.aborted) throw new ConversionError("Cancelled.");
	}
	const total = prepared.reduce((n, p) => n + p.base64.length, 0);
	if (total > MAX_TOTAL_BASE64)
		throw new ConversionError("The images are too large to send together. Use fewer images or a smaller max image size.");

	// 2. Call Claude (+ one repair round if validation fails).
	const system = systemPrompt(opts.format, settings.defaultInstructions);
	const messages: BetaMessageParam[] = [
		ClaudeClient.firstMessage(prepared, userInstruction(opts.format, images.length, opts.extraInstructions, opts.title)),
	];
	// Run a Claude call while re-rendering the status every second, so long thinking never looks frozen.
	const callWithStatus = async (label: string) => {
		const start = Date.now();
		let last: Progress = { phase: "waiting", thinkingChars: 0, textChars: 0 };
		const render = () => status(formatProgress(label, last, Date.now() - start));
		render();
		const timer = window.setInterval(render, 1000);
		try {
			return await client.call(system, messages, signal, (p) => {
				last = { ...p };
				render();
			});
		} finally {
			window.clearInterval(timer);
		}
	};

	let inTok = 0;
	let outTok = 0;
	let res = await callWithStatus("");
	inTok += res.message.usage.input_tokens;
	outTok += res.message.usage.output_tokens;
	let parsed = parseResponse(res.text);
	let content = await buildContent(opts.format, parsed.body);

	if (content.errors.length > 0) {
		messages.push({ role: "assistant", content: res.message.content });
		messages.push({ role: "user", content: repairInstruction(opts.format, content.errors) });
		try {
			res = await callWithStatus("Fixing diagram syntax · ");
			inTok += res.message.usage.input_tokens;
			outTok += res.message.usage.output_tokens;
			const p2 = parseResponse(res.text);
			const c2 = await buildContent(opts.format, p2.body);
			// Keep the repaired version if it is at least as good.
			if (c2.errors.length <= content.errors.length && c2.text) {
				parsed = p2;
				content = c2;
			}
		} catch (e) {
			if (signal.aborted) throw e;
			// Repair failed: fall through and save the first version.
		}
	}
	if (opts.format === "drawio" && !content.text)
		throw new ConversionError("Claude's reply did not contain a draw.io diagram.");

	// 3. Write files.
	status("Saving…");
	const title = sanitizeFileName(opts.title || parsed.title || "Converted image");
	const folder = normalizePath(settings.noteFolder || "/");
	await ensureFolder(app, folder);

	const originals: TFile[] = [];
	if (settings.keepOriginal) {
		const attFolder = normalizePath(attachmentsFolderOf(settings));
		await ensureFolder(app, attFolder);
		for (const [i, img] of images.entries()) {
			const base = images.length > 1 ? `${title} ${i + 1}` : title;
			const path = uniquePath(attFolder, base, extensionFor(img), (p) => !!app.vault.getAbstractFileByPath(p));
			originals.push(await app.vault.createBinary(path, await img.blob.arrayBuffer()));
		}
	}

	let file: TFile;
	if (opts.format === "drawio") {
		const path = uniquePath(folder, title, "drawio", (p) => !!app.vault.getAbstractFileByPath(p));
		file = await app.vault.create(path, content.text);
	} else {
		const fm = settings.addProperties
			? [
					"---",
					`created: ${new Date().toISOString()}`,
					"source: inkmagix",
					`model: ${settings.model}`,
					...(originals.length ? ["images:", ...originals.map((f) => `  - "[[${f.path}]]"`)] : []),
					"---",
					"",
				].join("\n")
			: "";
		let body = content.text;
		if (originals.length) {
			body += `\n\n> [!note]- Original${originals.length > 1 ? "s" : ""}\n${originals.map((f) => `> ![[${f.path}]]`).join("\n")}\n`;
		}
		const path = uniquePath(folder, title, "md", (p) => !!app.vault.getAbstractFileByPath(p));
		file = await app.vault.create(path, fm + body.trim() + "\n");
	}

	const cost = estimateCost(settings.model, inTok, outTok);
	const warn = content.errors.length ? ` ⚠ ${content.errors.length} diagram issue(s) remain.` : "";
	const summary = `Created ${file.name} — ${inTok.toLocaleString()} in / ${outTok.toLocaleString()} out tokens${
		cost !== null ? ` (~$${cost.toFixed(3)})` : ""
	}.${warn}`;
	return { file, summary };
}

function formatElapsed(ms: number): string {
	const s = Math.floor(ms / 1000);
	return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

function formatProgress(label: string, p: Progress, elapsedMs: number): string {
	const t = `[${formatElapsed(elapsedMs)}] `;
	switch (p.phase) {
		case "waiting":
			return `${t}${label}Sending to Claude…`;
		case "thinking":
			return `${t}${label}Thinking…${p.lastThought ? ` “${p.lastThought}”` : ""}`;
		case "writing":
			return `${t}${label}Writing… ${p.textChars.toLocaleString()} characters`;
	}
}

/** Turn the reply body into file content and collect validation errors. */
async function buildContent(format: DiagramFormat, body: string): Promise<{ text: string; errors: string[] }> {
	if (format === "drawio") {
		const xml = extractDrawioXml(body);
		if (!xml) return { text: "", errors: ["No <mxfile> XML document found in the reply."] };
		return { text: xml, errors: validateDrawioXml(xml) };
	}
	return { text: body, errors: await validateMermaid(body) };
}

async function validateMermaid(md: string): Promise<string[]> {
	const blocks = extractMermaidBlocks(md);
	if (blocks.length === 0) return [];
	let mermaid: { parse: (code: string) => unknown };
	try {
		mermaid = await loadMermaid();
	} catch {
		return []; // Can't validate; don't block the user.
	}
	const errors: string[] = [];
	for (const [i, code] of blocks.entries()) {
		try {
			await mermaid.parse(code);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			errors.push(`Mermaid block ${i + 1}: ${msg.split("\n").slice(0, 4).join(" ").slice(0, 400)}`);
		}
	}
	return errors;
}

async function ensureFolder(app: App, folder: string): Promise<void> {
	if (!folder || folder === "/") return;
	let cur = "";
	for (const part of folder.split("/")) {
		cur = cur ? `${cur}/${part}` : part;
		if (!app.vault.getAbstractFileByPath(cur)) {
			try {
				await app.vault.createFolder(cur);
			} catch {
				// Created concurrently or exists on disk but not yet indexed.
			}
		}
	}
}

/** Save a cut-off reply as-is so the user doesn't lose a long, paid-for response. */
export async function savePartial(app: App, settings: InkMagixSettings, format: DiagramFormat, text: string): Promise<TFile> {
	const parsed = parseResponse(text);
	const folder = normalizePath(settings.noteFolder || "/");
	await ensureFolder(app, folder);
	const title = sanitizeFileName(`${parsed.title ?? "Converted image"} (partial)`);
	const ext = format === "drawio" ? "drawio.txt" : "md";
	const path = uniquePath(folder, title, ext, (p) => !!app.vault.getAbstractFileByPath(p));
	return app.vault.create(path, parsed.body);
}
