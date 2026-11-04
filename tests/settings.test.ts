import { describe, expect, it, vi } from "vitest";
import { extensionFor } from "../src/image";
import InkMagixPlugin from "../src/main";
import { DEFAULT_SETTINGS, MODEL_OPTIONS, attachmentsFolderOf } from "../src/settings";
import { estimateCost } from "../src/util";

const blob = (type: string) => ({ type }) as Blob;

describe("extensionFor", () => {
	it("uses the file name's extension, normalising jpeg", () => {
		expect(extensionFor({ name: "IMG.JPEG", blob: blob("image/jpeg") })).toBe("jpg");
		expect(extensionFor({ name: "scan.PNG", blob: blob("") })).toBe("png");
	});
	it("falls back to the MIME type", () => {
		expect(extensionFor({ name: "camera", blob: blob("image/webp") })).toBe("webp");
		expect(extensionFor({ name: "camera", blob: blob("image/heic") })).toBe("heic");
	});
	it("defaults to jpg", () => {
		expect(extensionFor({ name: "camera", blob: blob("application/octet-stream") })).toBe("jpg");
	});
});

describe("attachmentsFolderOf", () => {
	const s = (attachmentsFolder: string, noteFolder: string) => ({ ...DEFAULT_SETTINGS, attachmentsFolder, noteFolder });
	it("uses the explicit folder", () => {
		expect(attachmentsFolderOf(s("  Files ", "Notes"))).toBe("Files");
	});
	it("falls back to <noteFolder>/attachments", () => {
		expect(attachmentsFolderOf(s("", "Notes"))).toBe("Notes/attachments");
	});
	it("gives a path that normalises to attachments/ when the note folder is empty", () => {
		// "//attachments" — normalizePath() in convert.ts turns it into "attachments".
		expect(attachmentsFolderOf(s("", ""))).toBe("//attachments");
	});
});

describe("model prices", () => {
	it("has a price for every model offered in settings", () => {
		for (const id of Object.keys(MODEL_OPTIONS)) expect(estimateCost(id, 1, 1), id).not.toBeNull();
	});
	it("defaults to an offered model", () => {
		expect(MODEL_OPTIONS).toHaveProperty(DEFAULT_SETTINGS.model);
	});
});

describe("InkMagixPlugin.loadSettings", () => {
	function plugin(data: unknown) {
		const p = new InkMagixPlugin({} as never, {} as never);
		const saved: unknown[] = [];
		Object.assign(p, {
			loadData: vi.fn(async () => data),
			saveData: vi.fn(async (d: unknown) => void saved.push(structuredClone(d))),
		});
		return { p, saved };
	}
	it("uses defaults when there is no data", async () => {
		const { p, saved } = plugin(null);
		await p.loadSettings();
		expect(p.settings).toEqual(DEFAULT_SETTINGS);
		expect(saved).toHaveLength(0);
	});
	it("merges saved values over defaults", async () => {
		const { p } = plugin({ model: "claude-haiku-5-5" });
		await p.loadSettings();
		expect(p.settings.model).toBe("claude-haiku-5-5");
		expect(p.settings.noteFolder).toBe(DEFAULT_SETTINGS.noteFolder);
	});
	it("removes an old plain-text API key and saves once", async () => {
		const { p, saved } = plugin({ apiKey: "sk-old", apiKeySecret: "x", noteFolder: "N" });
		await p.loadSettings();
		expect(saved).toHaveLength(1);
		expect(saved[0]).not.toHaveProperty("apiKey");
		expect(saved[0]).not.toHaveProperty("apiKeySecret");
		expect(saved[0]).toMatchObject({ noteFolder: "N" });
	});
});
