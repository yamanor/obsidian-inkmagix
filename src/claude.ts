import Anthropic from "@anthropic-ai/sdk";
import type { BetaContentBlockParam, BetaMessage, BetaMessageParam, MessageCreateParamsStreaming } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { PreparedImage } from "./image";
import type { InkMagixSettings } from "./settings";

export interface CallResult {
	text: string;
	message: BetaMessage;
}

export interface Progress {
	phase: "waiting" | "thinking" | "writing";
	thinkingChars: number;
	textChars: number;
	/** Last line of the summarized thinking, if available. */
	lastThought?: string;
}

export class ConversionError extends Error {
	constructor(
		message: string,
		/** Partial text, when the reply was cut off. */
		public partial?: string,
	) {
		super(message);
	}
}

export class ClaudeClient {
	private client: Anthropic;

	constructor(
		private settings: InkMagixSettings,
		apiKey: string,
	) {
		this.client = new Anthropic({
			apiKey,
			// Obsidian is a browser-like (Electron / mobile WebView) environment; the key is the user's own.
			dangerouslyAllowBrowser: true,
			maxRetries: 2,
		});
	}

	/** Build the first user message: labelled images followed by the instruction text. */
	static firstMessage(images: PreparedImage[], instruction: string): BetaMessageParam {
		const content: BetaContentBlockParam[] = [];
		images.forEach((img, i) => {
			if (images.length > 1) content.push({ type: "text", text: `Image ${i + 1} of ${images.length}:` });
			content.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } });
		});
		content.push({ type: "text", text: instruction });
		return { role: "user", content };
	}

	/** One streamed request; `onProgress` fires on every thinking/text delta. */
	async call(
		system: string,
		messages: BetaMessageParam[],
		signal: AbortSignal,
		onProgress: (p: Progress) => void,
	): Promise<CallResult> {
		const s = this.settings;
		const params: MessageCreateParamsStreaming = {
			model: s.model,
			max_tokens: s.maxOutputTokens,
			system,
			messages,
			stream: true,
			// On a policy refusal, let the API retry on Anthropic's recommended fallback model.
			// Models without fallback support simply run alone.
			betas: ["server-side-fallback-2026-07-01"],
			fallbacks: "default",
		};
		if (s.effort !== "default") params.output_config = { effort: s.effort };
		// Current models omit thinking text by default, so a long think (e.g. effort "max") streams nothing
		// for minutes. Ask for summarized thinking so we can show progress. Older/custom models: leave as is.
		if (/^claude-(opus|sonnet|haiku|fable|mythos)-5/.test(s.model)) {
			params.thinking = { type: "adaptive", display: "summarized" };
		}

		const p: Progress = { phase: "waiting", thinkingChars: 0, textChars: 0 };
		let thoughtBuf = "";
		let message: BetaMessage;
		try {
			const { stream: _stream, ...rest } = params;
			const stream = this.client.beta.messages.stream(rest, { signal });
			stream.on("streamEvent", (ev) => {
				if (ev.type === "content_block_start" && ev.content_block.type === "thinking" && p.phase === "waiting") {
					p.phase = "thinking";
					onProgress(p);
				} else if (ev.type === "content_block_delta" && ev.delta.type === "thinking_delta") {
					p.phase = "thinking";
					p.thinkingChars += ev.delta.thinking.length;
					thoughtBuf = (thoughtBuf + ev.delta.thinking).slice(-400);
					const lines = thoughtBuf.split("\n").map((l) => l.replace(/[*#_`]/g, "").trim()).filter(Boolean);
					const last = lines[lines.length - 1];
					if (last) p.lastThought = last.length > 80 ? `${last.slice(0, 79)}…` : last;
					onProgress(p);
				}
			});
			stream.on("text", (delta) => {
				p.phase = "writing";
				p.textChars += delta.length;
				onProgress(p);
			});
			message = await stream.finalMessage();
		} catch (e) {
			throw new ConversionError(friendlyError(e));
		}

		const text = message.content
			.filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
			.map((b) => b.text)
			.join("");

		if (message.stop_reason === "refusal") {
			const why = message.stop_details?.explanation;
			throw new ConversionError(`Claude declined to process this image${why ? `: ${why}` : "."}`);
		}
		if (message.stop_reason === "max_tokens") {
			throw new ConversionError(
				"The response hit the 'Max output tokens' limit and was cut off. Increase it in settings or convert fewer images at once.",
				text,
			);
		}
		if (!text.trim()) throw new ConversionError("Claude returned an empty response.");
		return { text, message };
	}
}

export function friendlyError(e: unknown): string {
	if (e instanceof Anthropic.APIUserAbortError) return "Cancelled.";
	if (e instanceof Anthropic.AuthenticationError) return "Invalid Anthropic API key — check InkMagix settings.";
	if (e instanceof Anthropic.PermissionDeniedError) return "This API key doesn't have access to the selected model.";
	if (e instanceof Anthropic.NotFoundError) return "Model not found — check the model ID in InkMagix settings.";
	if (e instanceof Anthropic.RateLimitError) return "Rate limited by the Anthropic API. Wait a moment and try again.";
	if (e instanceof Anthropic.BadRequestError) return `Request rejected by the API: ${apiMessage(e)}`;
	if (e instanceof Anthropic.InternalServerError) return "Anthropic API is having problems (server error). Try again shortly.";
	if (e instanceof Anthropic.APIConnectionError) return "Could not reach the Anthropic API. Check your internet connection.";
	if (e instanceof Anthropic.APIError) return `Anthropic API error (${e.status ?? "?"}): ${apiMessage(e)}`;
	return e instanceof Error ? e.message : String(e);
}

function apiMessage(e: { error?: unknown; message: string }): string {
	const body = e.error;
	if (typeof body === "object" && body !== null && "error" in body) {
		const inner = body.error;
		if (typeof inner === "object" && inner !== null && "message" in inner && typeof inner.message === "string") {
			return inner.message;
		}
	}
	return e.message;
}
