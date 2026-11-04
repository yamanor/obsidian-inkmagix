import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { ClaudeClient, ConversionError, Progress, friendlyError } from "../src/claude";
import type { PreparedImage } from "../src/image";
import { DEFAULT_SETTINGS, InkMagixSettings } from "../src/settings";

const image = (data: string): PreparedImage => ({ base64: data, mediaType: "image/jpeg", width: 1, height: 1, bytes: 1 });

describe("ClaudeClient.firstMessage", () => {
	it("does not label a single image", () => {
		const m = ClaudeClient.firstMessage([image("A")], "Do it");
		expect(m.role).toBe("user");
		expect(m.content).toEqual([
			{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "A" } },
			{ type: "text", text: "Do it" },
		]);
	});
	it("labels multiple images in order, instruction last", () => {
		const content = ClaudeClient.firstMessage([image("A"), image("B")], "Do it").content as { type: string; text?: string }[];
		expect(content.map((b) => b.text ?? b.type)).toEqual(["Image 1 of 2:", "image", "Image 2 of 2:", "image", "Do it"]);
	});
});

describe("friendlyError", () => {
	const h = new Headers();
	const body = { error: { message: "bad image" } };
	it.each([
		[new Anthropic.APIUserAbortError(), "Cancelled."],
		[new Anthropic.AuthenticationError(401, body, "x", h), /Invalid Anthropic API key/],
		[new Anthropic.PermissionDeniedError(403, body, "x", h), /doesn't have access/],
		[new Anthropic.NotFoundError(404, body, "x", h), /Model not found/],
		[new Anthropic.RateLimitError(429, body, "x", h), /Rate limited/],
		[new Anthropic.BadRequestError(400, body, "x", h), "Request rejected by the API: bad image"],
		[new Anthropic.InternalServerError(500, body, "x", h), /server error/],
		[new Anthropic.APIConnectionError({ message: "down" }), /Could not reach/],
		[new Anthropic.APIError(418, body, "x", h), "Anthropic API error (418): bad image"],
		[new Error("boom"), "boom"],
		["plain", "plain"],
	])("maps %o", (err, expected) => {
		const msg = friendlyError(err);
		if (expected instanceof RegExp) expect(msg).toMatch(expected);
		else expect(msg).toBe(expected);
	});
	it("falls back to the error message when the body has none", () => {
		const e = new Anthropic.BadRequestError(400, undefined, "raw message", h);
		expect(friendlyError(e)).toContain("raw message");
	});
});

type Ev = { kind: "event"; ev: unknown } | { kind: "text"; delta: string };

/** A ClaudeClient whose SDK stream replays `events` then resolves to `message` (or rejects with `error`). */
function client(over: Partial<InkMagixSettings>, events: Ev[], message: unknown, error?: unknown) {
	const c = new ClaudeClient({ ...DEFAULT_SETTINGS, ...over }, "sk-test");
	const stream = vi.fn(() => {
		const handlers: Record<string, ((x: unknown) => void)[]> = {};
		return {
			on(name: string, fn: (x: unknown) => void) {
				(handlers[name] ??= []).push(fn);
				return this;
			},
			async finalMessage() {
				for (const e of events) {
					if (e.kind === "event") handlers.streamEvent?.forEach((f) => f(e.ev));
					else handlers.text?.forEach((f) => f(e.delta));
				}
				if (error) throw error;
				return message;
			},
		};
	});
	(c as unknown as { client: unknown }).client = { beta: { messages: { stream } } };
	return { c, stream };
}
const msg = (text: string, stop_reason = "end_turn", extra = {}) => ({
	content: text ? [{ type: "thinking", thinking: "..." }, { type: "text", text }] : [],
	stop_reason,
	usage: { input_tokens: 1, output_tokens: 1 },
	...extra,
});
const call = (c: ClaudeClient, onProgress: (p: Progress) => void = () => {}) =>
	c.call("sys", [{ role: "user", content: "hi" }], new AbortController().signal, onProgress);

describe("ClaudeClient.call", () => {
	it("returns the joined text and sends the expected params", async () => {
		const { c, stream } = client({ effort: "high" }, [], msg("hello"));
		const r = await call(c);
		expect(r.text).toBe("hello");
		const params = (stream.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
		expect(params).toMatchObject({
			model: "claude-opus-5-5",
			max_tokens: 50000,
			system: "sys",
			output_config: { effort: "high" },
			thinking: { type: "adaptive", display: "summarized" },
		});
		expect(params).not.toHaveProperty("stream");
	});
	it("omits effort when set to default, and thinking for other models", async () => {
		const { c, stream } = client({ effort: "default", model: "my-custom-model" }, [], msg("ok"));
		await call(c);
		const params = (stream.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
		expect(params).not.toHaveProperty("output_config");
		expect(params).not.toHaveProperty("thinking");
	});
	it("reports progress through thinking and writing", async () => {
		const long = `**${"x".repeat(100)}**`;
		const events: Ev[] = [
			{ kind: "event", ev: { type: "content_block_start", content_block: { type: "thinking" } } },
			{ kind: "event", ev: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "## First idea\n" } } },
			{ kind: "event", ev: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: long } } },
			{ kind: "text", delta: "abc" },
			{ kind: "text", delta: "de" },
		];
		const seen: Progress[] = [];
		const { c } = client({}, events, msg("abcde"));
		await call(c, (p) => seen.push({ ...p }));
		expect(seen[0].phase).toBe("thinking");
		expect(seen[1].lastThought).toBe("First idea");
		expect(seen[2].lastThought).toBe(`${"x".repeat(79)}…`);
		expect(seen[2].thinkingChars).toBe(14 + long.length);
		expect(seen.at(-1)).toMatchObject({ phase: "writing", textChars: 5 });
	});
	it("wraps SDK errors in a friendly ConversionError", async () => {
		const { c } = client({}, [], null, new Anthropic.APIUserAbortError());
		await expect(call(c)).rejects.toThrow(new ConversionError("Cancelled."));
	});
	it("reports a refusal with its explanation", async () => {
		const { c } = client({}, [], msg("", "refusal", { stop_details: { explanation: "policy" } }));
		await expect(call(c)).rejects.toThrow("Claude declined to process this image: policy");
	});
	it("reports a refusal without an explanation", async () => {
		const { c } = client({}, [], msg("", "refusal"));
		await expect(call(c)).rejects.toThrow("Claude declined to process this image.");
	});
	it("keeps partial text when cut off by max_tokens", async () => {
		const { c } = client({}, [], msg("half a note", "max_tokens"));
		const err = await call(c).catch((e) => e);
		expect(err).toBeInstanceOf(ConversionError);
		expect(err.message).toMatch(/Max output tokens/);
		expect(err.partial).toBe("half a note");
	});
	it("rejects an empty reply", async () => {
		const { c } = client({}, [], msg("  "));
		await expect(call(c)).rejects.toThrow("Claude returned an empty response.");
	});
});
