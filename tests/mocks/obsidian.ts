// Minimal runtime stand-in for the "obsidian" package, which ships types only.
// Aliased in vitest.config.ts; never bundled into the plugin.

export function normalizePath(p: string): string {
	const out = p.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "");
	return out || "/";
}

export function arrayBufferToBase64(buf: ArrayBuffer): string {
	return Buffer.from(buf).toString("base64");
}

/** Tests replace `mermaidStub.parse` to simulate syntax errors. */
export const mermaidStub: { parse: (code: string) => unknown } = { parse: () => true };
export async function loadMermaid() {
	return mermaidStub;
}

export class TFile {
	constructor(public path: string) {}
	get name(): string {
		return this.path.split("/").pop() ?? this.path;
	}
}

export class App {}
export class Plugin {
	constructor(
		public app?: unknown,
		public manifest?: unknown,
	) {}
}
export class PluginSettingTab {}
export class Setting {}
export class Modal {}
export class Notice {}
export const Platform = { isMobile: false, isDesktop: true };
