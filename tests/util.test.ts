// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
	MAX_PIXELS,
	estimateCost,
	extractDrawioXml,
	extractMermaidBlocks,
	fitSize,
	parseResponse,
	sanitizeFileName,
	uniquePath,
	validateDrawioXml,
} from "../src/util";

describe("fitSize", () => {
	it("never upscales small images", () => {
		expect(fitSize(800, 600, 2576)).toEqual({ width: 800, height: 600 });
	});
	it("caps the long edge (portrait)", () => {
		const r = fitSize(3000, 8000, 2576);
		expect(r.height).toBeLessThanOrEqual(2576);
		expect(r.width / r.height).toBeCloseTo(3000 / 8000, 2);
	});
	it("caps total pixels for 48 MP 4:3 photos", () => {
		const r = fitSize(8000, 6000, 2576);
		expect(r.width).toBeLessThanOrEqual(2576);
		expect(r.width * r.height).toBeLessThanOrEqual(MAX_PIXELS);
		expect(r.width / r.height).toBeCloseTo(4 / 3, 2);
	});
	it("respects a smaller max edge", () => {
		expect(fitSize(4000, 2000, 1280)).toEqual({ width: 1280, height: 640 });
	});
});

describe("sanitizeFileName", () => {
	it("removes characters Obsidian disallows", () => {
		expect(sanitizeFileName('a/b:c*?"<>|#^[x]')).toBe("a b c x");
	});
	it("falls back when empty", () => {
		expect(sanitizeFileName("  ...  ")).toBe("Untitled");
	});
	it("truncates long names", () => {
		expect(sanitizeFileName("x".repeat(500)).length).toBe(120);
	});
});

describe("uniquePath", () => {
	it("adds numeric suffixes", () => {
		const taken = new Set(["Notes/A.md", "Notes/A (2).md"]);
		expect(uniquePath("Notes", "A", "md", (p) => taken.has(p))).toBe("Notes/A (3).md");
	});
	it("handles root folder", () => {
		expect(uniquePath("/", "A", "drawio", () => false)).toBe("A.drawio");
	});
});

describe("parseResponse", () => {
	it("extracts title and body", () => {
		expect(parseResponse("<title> Meeting </title>\n# Hi\ntext")).toEqual({ title: "Meeting", body: "# Hi\ntext" });
	});
	it("unwraps an outer markdown fence", () => {
		expect(parseResponse("<title>T</title>\n```markdown\n# Hi\n```").body).toBe("# Hi");
	});
	it("keeps inner mermaid fences", () => {
		const md = "# A\n```mermaid\nflowchart LR\nA-->B\n```\nend";
		expect(parseResponse(`<title>T</title>${md}`).body).toBe(md);
	});
	it("works without a title", () => {
		expect(parseResponse("just text")).toEqual({ title: null, body: "just text" });
	});
});

describe("extractMermaidBlocks", () => {
	it("finds all blocks", () => {
		const md = "a\n```mermaid\nflowchart LR\nA-->B\n```\nb\n```mermaid\nmindmap\n  root\n```\n";
		expect(extractMermaidBlocks(md)).toEqual(["flowchart LR\nA-->B\n", "mindmap\n  root\n"]);
	});
});

const GOOD = `<mxfile host="InkMagix"><diagram id="p1" name="Page-1"><mxGraphModel><root>
<mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="a" value="A" vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>
<mxCell id="b" value="B" vertex="1" parent="1"><mxGeometry x="200" y="0" width="80" height="40" as="geometry"/></mxCell>
<mxCell id="e" edge="1" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry"/></mxCell>
</root></mxGraphModel></diagram></mxfile>`;

describe("draw.io", () => {
	it("extracts the mxfile from surrounding text", () => {
		expect(extractDrawioXml(`Here you go:\n${GOOD}\nthanks`)).toBe(GOOD);
	});
	it("wraps a bare mxGraphModel", () => {
		const x = extractDrawioXml("<mxGraphModel><root/></mxGraphModel>");
		expect(x).toMatch(/^<mxfile.*<diagram.*<mxGraphModel>/);
	});
	it("returns null when absent", () => {
		expect(extractDrawioXml("no xml")).toBeNull();
	});
	it("accepts valid XML", () => {
		expect(validateDrawioXml(GOOD)).toEqual([]);
	});
	it("reports malformed XML", () => {
		expect(validateDrawioXml("<mxfile><diagram></mxfile>")[0]).toMatch(/parse error/i);
	});
	it("reports dangling edge targets and duplicate ids", () => {
		const bad = GOOD.replace('target="b"', 'target="zzz"').replace('id="b"', 'id="a"');
		const errs = validateDrawioXml(bad);
		expect(errs.some((e) => e.includes("Duplicate"))).toBe(true);
		expect(errs.some((e) => e.includes('"zzz"'))).toBe(true);
	});
});

describe("estimateCost", () => {
	it("computes for known models", () => {
		expect(estimateCost("claude-opus-5-5", 1_000_000, 100_000)).toBeCloseTo(6);
	});
	it("returns null for unknown models", () => {
		expect(estimateCost("custom", 1, 1)).toBeNull();
	});
});
