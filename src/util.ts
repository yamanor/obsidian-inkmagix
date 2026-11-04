// Pure helpers (no Obsidian imports) so they can be unit-tested.

/** Max pixel count Claude's high-res vision tier uses (~3.75 MP). */
export const MAX_PIXELS = 3_750_000;

/** Target size for an image: fit long edge to maxEdge and total pixels to MAX_PIXELS; never upscale. */
export function fitSize(width: number, height: number, maxEdge: number, maxPixels = MAX_PIXELS): { width: number; height: number } {
	let scale = Math.min(1, maxEdge / Math.max(width, height));
	const px = width * scale * height * scale;
	if (px > maxPixels) scale *= Math.sqrt(maxPixels / px);
	return {
		width: Math.max(1, Math.floor(width * scale)),
		height: Math.max(1, Math.floor(height * scale)),
	};
}

/** Make a string safe as an Obsidian file name. */
export function sanitizeFileName(name: string, fallback = "Untitled"): string {
	const cleaned = name
		.replace(/[\\/:*?"<>|#^[\]]/g, " ")
		.split("")
		.filter((c) => c.charCodeAt(0) >= 0x20) // drop C0 control characters
		.join("")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^\.+/, "")
		.slice(0, 120)
		.trim();
	return cleaned || fallback;
}

/** First path `<base>.<ext>`, `<base> (2).<ext>`, ... for which exists() is false. */
export function uniquePath(folder: string, base: string, ext: string, exists: (p: string) => boolean): string {
	const dir = folder.replace(/^\/+|\/+$/g, "");
	const join = (n: string) => (dir ? `${dir}/${n}` : n);
	let p = join(`${base}.${ext}`);
	for (let i = 2; exists(p); i++) p = join(`${base} (${i}).${ext}`);
	return p;
}

export interface ParsedResponse {
	title: string | null;
	body: string;
}

/** Split `<title>…</title>` from the rest of Claude's reply and strip a stray outer code fence. */
export function parseResponse(text: string): ParsedResponse {
	let title: string | null = null;
	let body = text;
	const m = body.match(/<title>([\s\S]*?)<\/title>/i);
	if (m) {
		title = m[1].trim() || null;
		body = body.slice(0, m.index) + body.slice((m.index ?? 0) + m[0].length);
	}
	body = body.trim();
	// Some replies wrap the whole document in ```markdown / ```xml — unwrap it.
	const fence = body.match(/^```(?:markdown|md|xml)?\s*\n([\s\S]*?)\n```$/i);
	if (fence) body = fence[1].trim();
	return { title, body };
}

/** Extract the <mxfile>…</mxfile> (or bare <mxGraphModel>) document from a reply. */
export function extractDrawioXml(body: string): string | null {
	const mx = body.match(/<mxfile[\s\S]*<\/mxfile>/);
	if (mx) return mx[0];
	const gm = body.match(/<mxGraphModel[\s\S]*<\/mxGraphModel>/);
	if (gm) return `<mxfile host="InkMagix"><diagram name="Page-1">${gm[0]}</diagram></mxfile>`;
	return null;
}

/** Validate draw.io XML. Returns a list of problems (empty = OK). Needs a DOMParser. */
export function validateDrawioXml(xml: string, parser: DOMParser = new DOMParser()): string[] {
	const errors: string[] = [];
	const doc = parser.parseFromString(xml, "application/xml");
	const pe = doc.getElementsByTagName("parsererror")[0];
	if (pe) {
		errors.push(`XML parse error: ${(pe.textContent ?? "").trim().slice(0, 300)}`);
		return errors;
	}
	const root = doc.documentElement?.nodeName;
	if (root !== "mxfile") errors.push(`Root element must be <mxfile>, got <${root}>.`);
	const diagrams = doc.getElementsByTagName("diagram");
	if (diagrams.length === 0) errors.push("No <diagram> element.");
	if (doc.getElementsByTagName("mxGraphModel").length === 0)
		errors.push("No uncompressed <mxGraphModel> found (do not compress diagram content).");
	const cells = Array.from(doc.getElementsByTagName("mxCell"));
	if (cells.length < 2) errors.push("Diagram has no cells.");
	const ids = new Set<string>();
	for (const c of cells) {
		const id = c.getAttribute("id");
		if (!id) errors.push("An <mxCell> is missing an id.");
		else if (ids.has(id)) errors.push(`Duplicate mxCell id "${id}".`);
		else ids.add(id);
	}
	for (const c of cells) {
		for (const attr of ["parent", "source", "target"]) {
			const ref = c.getAttribute(attr);
			if (ref && !ids.has(ref)) errors.push(`mxCell "${c.getAttribute("id")}" references unknown ${attr} "${ref}".`);
		}
	}
	return Array.from(new Set(errors)).slice(0, 20);
}

/** All ```mermaid code blocks in a Markdown string. */
export function extractMermaidBlocks(md: string): string[] {
	const out: string[] = [];
	const re = /^```mermaid[^\n]*\n([\s\S]*?)^```/gm;
	let m: RegExpExecArray | null;
	while ((m = re.exec(md))) out.push(m[1]);
	return out;
}

/** Rough USD cost from token usage, for display only. Unknown models → null. */
const PRICES: Record<string, [number, number]> = {
	"claude-fable-5-1": [10, 50],
	"claude-fable-5": [10, 50],
	"claude-opus-5-5": [4, 20],
	"claude-opus-5": [5, 25],
	"claude-sonnet-5-5": [2, 10],
	"claude-sonnet-5": [2, 10],
	"claude-haiku-5-5": [0.1, 0.5],
};
export function estimateCost(model: string, inputTokens: number, outputTokens: number): number | null {
	const p = PRICES[model];
	if (!p) return null;
	return (inputTokens * p[0] + outputTokens * p[1]) / 1_000_000;
}
