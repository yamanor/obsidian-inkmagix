import { App, PluginSettingTab, SettingDefinitionItem } from "obsidian";
import type InkMagixPlugin from "./main";

export type DiagramFormat = "mermaid" | "drawio";
export type Effort = "default" | "low" | "medium" | "high" | "xhigh" | "max";

export interface InkMagixSettings {
	model: string;
	effort: Effort;
	noteFolder: string;
	addProperties: boolean;
	keepOriginal: boolean;
	attachmentsFolder: string;
	enableDrawio: boolean;
	defaultFormat: DiagramFormat;
	maxOutputTokens: number;
	maxImageEdge: number;
	defaultInstructions: string;
}

export const DEFAULT_SETTINGS: InkMagixSettings = {
	model: "claude-opus-5-5",
	effort: "high",
	noteFolder: "InkMagix",
	addProperties: false,
	keepOriginal: false,
	attachmentsFolder: "",
	enableDrawio: true,
	defaultFormat: "mermaid",
	maxOutputTokens: 50000,
	maxImageEdge: 2576,
	defaultInstructions: "",
};

/** Fixed name of the secret in Obsidian's SecretStorage that holds the Anthropic API key. */
export const API_KEY_SECRET_ID = "inkmagix-anthropic-api-key";

export const MODEL_OPTIONS: Record<string, string> = {
	"claude-opus-5-5": "Claude Opus 5.5 (recommended)",
	"claude-sonnet-5-5": "Claude Sonnet 5.5 (cheaper)",
	"claude-haiku-5-5": "Claude Haiku 5.5 (cheapest)",
	"claude-fable-5-1": "Claude Fable 5.1 (most capable, expensive)",
};
const CUSTOM_MODEL = "__custom__";

/** Attachments folder actually used (falls back to `<noteFolder>/attachments`). */
export function attachmentsFolderOf(s: InkMagixSettings): string {
	return s.attachmentsFolder.trim() || `${s.noteFolder.trim() || "/"}/attachments`;
}

export class InkMagixSettingTab extends PluginSettingTab {
	/** UI-only: user picked "Custom…" while the saved model is still a preset. */
	private customModelSelected = false;
	private customModelInput: HTMLInputElement | null = null;

	constructor(app: App, private plugin: InkMagixPlugin) {
		super(app, plugin);
	}

	getControlValue(key: string): unknown {
		const value: unknown = this.plugin.settings[key as keyof InkMagixSettings];
		return key === "maxImageEdge" ? String(value) : value;
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		let v = value;
		if (key === "maxImageEdge") v = parseInt(String(value), 10);
		else if (key === "noteFolder" || key === "attachmentsFolder") v = String(value).trim();
		(this.plugin.settings as unknown as Record<string, unknown>)[key] = v;
		await this.plugin.saveSettings();
		// Dependent rows use `visible`; re-evaluate them.
		if (key === "enableDrawio" || key === "keepOriginal") this.update();
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const s = this.plugin.settings;
		const showCustomModel = () => this.customModelSelected || !(s.model in MODEL_OPTIONS);

		return [
			{
				name: "Anthropic API key",
				desc: "Create one at console.anthropic.com. Stored in Obsidian's secret storage, not in plugin data.",
				aliases: ["secret", "token"],
				render: (setting) => {
					const secrets = this.app.secretStorage;
					const hasKey = !!secrets.getSecret(API_KEY_SECRET_ID);
					setting.addText((t) => {
						t.inputEl.type = "password";
						t.setPlaceholder(hasKey ? "•••••••• (saved)" : "sk-ant-...").onChange((v) => {
							if (v.trim()) secrets.setSecret(API_KEY_SECRET_ID, v.trim());
						});
					});
					if (hasKey) {
						setting.addExtraButton((b) =>
							b
								.setIcon("trash")
								.setTooltip("Remove saved key")
								.onClick(() => {
									secrets.setSecret(API_KEY_SECRET_ID, "");
									this.update();
								}),
						);
					}
				},
			},
			{
				name: "Model",
				desc: "Claude model used for conversions.",
				render: (setting) => {
					setting.addDropdown((d) => {
						for (const [id, label] of Object.entries(MODEL_OPTIONS)) d.addOption(id, label);
						d.addOption(CUSTOM_MODEL, "Custom…");
						d.setValue(showCustomModel() ? CUSTOM_MODEL : s.model).onChange(async (v) => {
							if (v === CUSTOM_MODEL) {
								// Keep the current model until a custom ID is typed; just reveal the field.
								this.customModelSelected = true;
								this.update();
								this.customModelInput?.focus();
								return;
							}
							this.customModelSelected = false;
							s.model = v;
							await this.plugin.saveSettings();
							this.update();
						});
					});
				},
			},
			{
				name: "Custom model ID",
				desc: "Exact model ID, e.g. claude-opus-5.",
				visible: showCustomModel,
				render: (setting) => {
					setting.addText((t) => {
						this.customModelInput = t.inputEl;
						t.setPlaceholder("claude-…")
							.setValue(s.model)
							.onChange(async (v) => {
								const id = v.trim();
								if (!id) return; // never save an empty model
								s.model = id;
								await this.plugin.saveSettings();
							});
					});
					return () => {
						this.customModelInput = null;
					};
				},
			},
			{
				name: "Effort",
				desc:
					"How hard Claude thinks. Higher = more accurate transcription of messy handwriting and complex diagrams, but slower and more tokens. " +
					"Max can think for several minutes per image. Use 'Model default' for older models that don't support effort.",
				control: {
					type: "dropdown",
					key: "effort",
					options: {
						default: "Model default",
						low: "Low",
						medium: "Medium",
						high: "High",
						xhigh: "Extra high",
						max: "Max",
					},
				},
			},
			{
				name: "Note folder",
				desc: "Where new notes and .drawio files are created. Created if missing.",
				control: { type: "text", key: "noteFolder", placeholder: "InkMagix" },
			},
			{
				name: "Enable draw.io output",
				desc: "Show the draw.io option in the convert dialog. Off: always create a note with Mermaid diagrams.",
				control: { type: "toggle", key: "enableDrawio" },
			},
			{
				name: "Default diagram format",
				desc: "Preselected output format in the convert dialog.",
				visible: () => s.enableDrawio,
				control: {
					type: "dropdown",
					key: "defaultFormat",
					options: { mermaid: "Note with Mermaid diagrams", drawio: "draw.io diagram" },
				},
			},
			{
				name: "Add properties",
				desc: "Add created, source and model properties to new notes.",
				control: { type: "toggle", key: "addProperties" },
			},
			{
				name: "Keep original photo",
				desc: "Save the original image(s) in the vault and link them from the note.",
				control: { type: "toggle", key: "keepOriginal" },
			},
			{
				name: "Originals folder",
				desc: "Where originals are saved. Empty = '<note folder>/attachments'.",
				visible: () => s.keepOriginal,
				control: {
					type: "text",
					key: "attachmentsFolder",
					placeholder: attachmentsFolderOf({ ...s, attachmentsFolder: "" }),
				},
			},
			{
				name: "Max output tokens",
				desc: "Upper limit on the response length (thinking + output).",
				control: {
					type: "number",
					key: "maxOutputTokens",
					min: 1024,
					validate: (n) => (Number.isFinite(n) && n >= 1024 ? undefined : "Must be at least 1024."),
				},
			},
			{
				name: "Max image size (long edge)",
				desc:
					"Images are downscaled to this before upload. 2576 px is the maximum current Claude models use " +
					"(best for handwriting and dense diagrams, up to ~4.8K tokens/image). Lower = cheaper.",
				control: {
					type: "dropdown",
					key: "maxImageEdge",
					options: { "2576": "2576 px (max detail)", "1920": "1920 px", "1568": "1568 px", "1280": "1280 px (cheapest)" },
				},
			},
			{
				name: "Default instructions",
				desc: "Always added to the prompt, e.g. 'Write in English', 'Use bullet points', 'Tag with #meeting'.",
				render: (setting) => {
					setting.addTextArea((t) => {
						t.inputEl.rows = 5;
						t.inputEl.addClass("inkmagix-wide");
						t.setValue(s.defaultInstructions).onChange(async (v) => {
							s.defaultInstructions = v;
							await this.plugin.saveSettings();
						});
					});
				},
			},
		];
	}
}
