import { vi } from "vitest";
import { TFile } from "./mocks/obsidian";

/** In-memory vault + secret storage, shaped like the parts of Obsidian's App the plugin uses. */
export function fakeApp(apiKey: string | null = "sk-test") {
	const files = new Map<string, string | ArrayBuffer>();
	const folders = new Set<string>();
	const vault = {
		files,
		folders,
		getAbstractFileByPath: vi.fn((p: string) => (files.has(p) ? new TFile(p) : folders.has(p) ? { path: p } : null)),
		create: vi.fn(async (p: string, data: string) => {
			files.set(p, data);
			return new TFile(p);
		}),
		createBinary: vi.fn(async (p: string, data: ArrayBuffer) => {
			files.set(p, data);
			return new TFile(p);
		}),
		createFolder: vi.fn(async (p: string) => {
			folders.add(p);
		}),
	};
	const secretStorage = { getSecret: vi.fn(() => apiKey), setSecret: vi.fn() };
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return { vault, secretStorage } as any;
}
