// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversionError } from "../src/claude";
import { MAX_IMAGES, convertImages, formatElapsed, formatProgress, savePartial } from "../src/convert";
import type { InputImage } from "../src/image";
import { DEFAULT_SETTINGS, InkMagixSettings } from "../src/settings";
import { fakeApp } from "./helpers";
import { mermaidStub } from "./mocks/obsidian";

const { callMock, prepareMock } = vi.hoisted(() => ({ callMock: vi.fn(), prepareMock: vi.fn() }));

vi.mock("../src/claude", async (orig) => {
	const actual = await orig<typeof import("../src/claude")>();
	class FakeClient {
		static firstMessage = actual.ClaudeClient.firstMessage;
		call = callMock;
	}
	return { ...actual, ClaudeClient: FakeClient };
});
vi.mock("../src/image", async (orig) => ({ ...(await orig<typeof import("../src/image")>()), prepareImage: prepareMock }));

function img(name = "photo.png"): InputImage {
	return { name, blob: { type: "image/png", arrayBuffer: async () => new ArrayBuffer(4) } as unknown as Blob };
}
function reply(text: string, inTok = 1000, outTok = 500) {
	return { text, message: { content: [{ type: "text", text }], usage: { input_tokens: inTok, output_tokens: outTok } } };
}
const settings = (over: Partial<InkMagixSettings> = {}): InkMagixSettings => ({ ...DEFAULT_SETTINGS, ...over });
const opts = (over = {}) => ({ format: "mermaid" as const, extraInstructions: "", title: "", ...over });
const run = (app = fakeApp(), s = settings(), images = [img()], o = opts(), signal = new AbortController().signal) =>
	convertImages(app, s, images, o, signal, () => {});

const DRAWIO = `<mxfile host="InkMagix"><diagram name="P"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>`;

beforeEach(() => {
	callMock.mockReset();
	prepareMock.mockReset().mockResolvedValue({ base64: "QUJD", mediaType: "image/jpeg", width: 1, height: 1, bytes: 3 });
	mermaidStub.parse = (code: string) => {
		if (code.includes("BAD")) throw new Error("Parse error on line 1:\nBAD");
		return true;
	};
});
afterEach(() => vi.useRealTimers());

describe("convertImages: input checks", () => {
	it("requires at least one image", async () => {
		await expect(run(undefined, undefined, [])).rejects.toThrow("Add at least one image.");
	});
	it(`allows at most ${MAX_IMAGES} images`, async () => {
		await expect(run(undefined, undefined, Array.from({ length: MAX_IMAGES + 1 }, () => img()))).rejects.toThrow(
			`At most ${MAX_IMAGES}`,
		);
	});
	it("requires an API key", async () => {
		await expect(run(fakeApp(null))).rejects.toThrow(/API key/);
		await expect(run(fakeApp("   "))).rejects.toThrow(/API key/);
	});
	it("rejects images that are too large together", async () => {
		prepareMock.mockResolvedValue({ base64: "x".repeat(15_000_000), mediaType: "image/jpeg", width: 1, height: 1, bytes: 1 });
		await expect(run(undefined, undefined, [img(), img()])).rejects.toThrow(/too large/);
		expect(callMock).not.toHaveBeenCalled();
	});
	it("stops when cancelled during preparation", async () => {
		const ac = new AbortController();
		prepareMock.mockImplementation(async () => {
			ac.abort();
			return { base64: "QUJD", mediaType: "image/jpeg", width: 1, height: 1, bytes: 3 };
		});
		await expect(run(undefined, undefined, undefined, undefined, ac.signal)).rejects.toThrow("Cancelled.");
		expect(callMock).not.toHaveBeenCalled();
	});
});

describe("convertImages: note output", () => {
	it("saves a note using Claude's title and reports the cost", async () => {
		callMock.mockResolvedValue(reply("<title>My Notes</title>\n# Hello", 1_000_000, 100_000));
		const app = fakeApp();
		const { file, summary } = await run(app);
		expect(file.path).toBe("InkMagix/My Notes.md");
		expect(app.vault.files.get("InkMagix/My Notes.md")).toBe("# Hello\n");
		expect(app.vault.createFolder).toHaveBeenCalledWith("InkMagix");
		expect(summary).toContain("Created My Notes.md");
		expect(summary).toContain("(~$6.000)");
		expect(summary).not.toContain("⚠");
	});
	it("prefers the user's title and avoids name clashes", async () => {
		callMock.mockResolvedValue(reply("<title>Ignored</title>\nbody"));
		const app = fakeApp();
		app.vault.files.set("InkMagix/Mine.md", "existing");
		const { file } = await run(app, undefined, undefined, opts({ title: "Mine" }));
		expect(file.path).toBe("InkMagix/Mine (2).md");
	});
	it("falls back to a default title and the vault root", async () => {
		callMock.mockResolvedValue(reply("body only"));
		const { file } = await run(undefined, settings({ noteFolder: "" }));
		expect(file.path).toBe("Converted image.md");
	});
	it("omits the cost for unknown models", async () => {
		callMock.mockResolvedValue(reply("x"));
		const { summary } = await run(undefined, settings({ model: "custom-model" }));
		expect(summary).not.toContain("$");
	});
	it("adds properties when enabled", async () => {
		callMock.mockResolvedValue(reply("<title>T</title>\nbody"));
		const app = fakeApp();
		await run(app, settings({ addProperties: true }));
		const text = app.vault.files.get("InkMagix/T.md") as string;
		expect(text).toMatch(/^---\ncreated: \S+\nsource: inkmagix\nmodel: claude-opus-5-5\n---\nbody\n$/);
	});
	it("keeps originals with numbered names, an images list and a callout", async () => {
		callMock.mockResolvedValue(reply("<title>T</title>\nbody"));
		const app = fakeApp();
		await run(app, settings({ keepOriginal: true, addProperties: true }), [img("a.jpeg"), img("b.png")]);
		expect(app.vault.files.has("InkMagix/attachments/T 1.jpg")).toBe(true);
		expect(app.vault.files.has("InkMagix/attachments/T 2.png")).toBe(true);
		const text = app.vault.files.get("InkMagix/T.md") as string;
		expect(text).toContain('images:\n  - "[[InkMagix/attachments/T 1.jpg]]"\n  - "[[InkMagix/attachments/T 2.png]]"');
		expect(text).toContain("> [!note]- Originals\n> ![[InkMagix/attachments/T 1.jpg]]\n> ![[InkMagix/attachments/T 2.png]]");
	});
	it("uses the singular callout and the bare title for one original", async () => {
		callMock.mockResolvedValue(reply("<title>T</title>\nbody"));
		const app = fakeApp();
		await run(app, settings({ keepOriginal: true, attachmentsFolder: "Att" }));
		expect(app.vault.files.has("Att/T.png")).toBe(true);
		expect(app.vault.files.get("InkMagix/T.md")).toContain("> [!note]- Original\n");
	});
});

describe("convertImages: repair round", () => {
	const bad = "<title>T</title>\n```mermaid\nBAD\n```";
	const good = "<title>T</title>\n```mermaid\nflowchart LR\nA-->B\n```";

	it("sends a repair request and keeps the fixed reply", async () => {
		callMock.mockResolvedValueOnce(reply(bad, 100, 10)).mockResolvedValueOnce(reply(good, 200, 20));
		const app = fakeApp();
		const { summary } = await run(app);
		expect(callMock).toHaveBeenCalledTimes(2);
		const messages = callMock.mock.calls[1][1];
		expect(messages).toHaveLength(3);
		expect(messages[1].role).toBe("assistant");
		expect(messages[2].content).toContain("Mermaid block 1: Parse error on line 1: BAD");
		expect(app.vault.files.get("InkMagix/T.md")).toContain("A-->B");
		expect(summary).toContain("300 in / 30 out");
		expect(summary).not.toContain("⚠");
	});
	it("keeps the first reply when the repair is worse", async () => {
		callMock
			.mockResolvedValueOnce(reply(bad))
			.mockResolvedValueOnce(reply("<title>T</title>\n```mermaid\nBAD1\n```\n```mermaid\nBAD2\n```"));
		const app = fakeApp();
		const { summary } = await run(app);
		expect(app.vault.files.get("InkMagix/T.md")).toBe("```mermaid\nBAD\n```\n");
		expect(summary).toContain("⚠ 1 diagram issue(s) remain.");
	});
	it("saves the first reply when the repair call fails", async () => {
		callMock.mockResolvedValueOnce(reply(bad)).mockRejectedValueOnce(new ConversionError("Rate limited"));
		const app = fakeApp();
		const { summary } = await run(app);
		expect(app.vault.files.get("InkMagix/T.md")).toContain("BAD");
		expect(summary).toContain("⚠ 1");
	});
	it("re-throws when the repair call fails after cancellation", async () => {
		const ac = new AbortController();
		callMock.mockResolvedValueOnce(reply(bad)).mockImplementationOnce(async () => {
			ac.abort();
			throw new ConversionError("Cancelled.");
		});
		await expect(run(undefined, undefined, undefined, undefined, ac.signal)).rejects.toThrow("Cancelled.");
	});
	it("makes no repair call when the note has no diagrams", async () => {
		callMock.mockResolvedValue(reply("<title>T</title>\nplain text"));
		await run();
		expect(callMock).toHaveBeenCalledTimes(1);
	});
});

describe("convertImages: draw.io output", () => {
	it("saves the extracted XML", async () => {
		callMock.mockResolvedValue(reply(`<title>D</title>\nHere:\n${DRAWIO}`));
		const app = fakeApp();
		const { file } = await run(app, undefined, undefined, opts({ format: "drawio" }));
		expect(file.path).toBe("InkMagix/D.drawio");
		expect(app.vault.files.get("InkMagix/D.drawio")).toBe(DRAWIO);
		expect(callMock).toHaveBeenCalledTimes(1);
	});
	it("fails when no XML is found even after repair", async () => {
		callMock.mockResolvedValue(reply("<title>D</title>\nsorry, no diagram"));
		await expect(run(undefined, undefined, undefined, opts({ format: "drawio" }))).rejects.toThrow(
			"did not contain a draw.io diagram",
		);
		expect(callMock).toHaveBeenCalledTimes(2);
	});
	it("uses a repaired diagram", async () => {
		callMock.mockResolvedValueOnce(reply("<title>D</title>\nnone")).mockResolvedValueOnce(reply(`<title>D</title>\n${DRAWIO}`));
		const app = fakeApp();
		await run(app, undefined, undefined, opts({ format: "drawio" }));
		expect(app.vault.files.get("InkMagix/D.drawio")).toBe(DRAWIO);
	});
});

describe("status updates", () => {
	it("reports preparation and saving", async () => {
		callMock.mockResolvedValue(reply("x"));
		const status = vi.fn();
		await convertImages(fakeApp(), settings(), [img(), img()], opts(), new AbortController().signal, status);
		const msgs = status.mock.calls.map((c) => c[0]);
		expect(msgs).toContain("Preparing image 2/2…");
		expect(msgs.some((m) => m.includes("Sending to Claude…"))).toBe(true);
		expect(msgs.at(-1)).toBe("Saving…");
	});
	it("formats elapsed time", () => {
		expect(formatElapsed(59_999)).toBe("59s");
		expect(formatElapsed(60_000)).toBe("1m 00s");
		expect(formatElapsed(125_000)).toBe("2m 05s");
	});
	it("formats each phase", () => {
		const base = { thinkingChars: 0, textChars: 0 };
		expect(formatProgress("", { ...base, phase: "waiting" }, 0)).toBe("[0s] Sending to Claude…");
		expect(formatProgress("Fix · ", { ...base, phase: "thinking" }, 0)).toBe("[0s] Fix · Thinking…");
		expect(formatProgress("", { ...base, phase: "thinking", lastThought: "hmm" }, 0)).toBe("[0s] Thinking… “hmm”");
		expect(formatProgress("", { ...base, phase: "writing", textChars: 1234 }, 0)).toBe(
			`[0s] Writing… ${(1234).toLocaleString()} characters`,
		);
	});
});

describe("savePartial", () => {
	it("saves a cut-off note with a (partial) title", async () => {
		const app = fakeApp();
		const f = await savePartial(app, settings(), "mermaid", "<title>Long</title>\n# Half");
		expect(f.path).toBe("InkMagix/Long (partial).md");
		expect(app.vault.files.get(f.path)).toBe("# Half");
	});
	it("saves cut-off draw.io as .drawio.txt", async () => {
		const f = await savePartial(fakeApp(), settings({ noteFolder: "A/B" }), "drawio", "<mxfile>");
		expect(f.path).toBe("A/B/Converted image (partial).drawio.txt");
	});
});
