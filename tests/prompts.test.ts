import { describe, expect, it } from "vitest";
import { repairInstruction, systemPrompt, userInstruction } from "../src/prompts";

describe("systemPrompt", () => {
	it("picks the format-specific prompt", () => {
		expect(systemPrompt("mermaid", "")).toContain("```mermaid code block");
		expect(systemPrompt("drawio", "")).toContain("<mxfile host=\"InkMagix\">");
	});
	it("appends the user's default instructions only when non-empty", () => {
		expect(systemPrompt("mermaid", "   ")).not.toContain("Additional instructions");
		expect(systemPrompt("mermaid", "  Use German. ")).toMatch(/Additional instructions from the user[^\n]*:\nUse German\.$/);
	});
});

describe("userInstruction", () => {
	it("handles one vs. several images", () => {
		expect(userInstruction("mermaid", 1, "", "")).toBe("Convert this image into an Obsidian note.");
		expect(userInstruction("drawio", 3, "", "")).toBe("Convert these 3 images into a draw.io file.");
	});
	it("adds the title and extra instructions when given", () => {
		expect(userInstruction("mermaid", 1, " be brief ", " Plan ")).toBe(
			"Convert this image into an Obsidian note.\n\nUse this exact title: Plan\n\nInstructions for this conversion:\nbe brief",
		);
	});
});

describe("repairInstruction", () => {
	it("lists each error for the right format", () => {
		const m = repairInstruction("mermaid", ["e1", "e2"]);
		expect(m).toMatch(/^The Mermaid diagram\(s\) in your reply failed validation:\n- e1\n- e2\n/);
		expect(repairInstruction("drawio", ["x"])).toMatch(/^The draw\.io XML in your reply/);
	});
});
