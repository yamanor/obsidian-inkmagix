import { App, PluginSettingTab, Setting } from "obsidian";
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
	constructor(app: App, private plugin: InkMagixPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		const s = this.plugin.settings;
		const save = () => this.plugin.saveSettings();
		containerEl.empty();

		const secrets = this.app.secretStorage;
		const hasKey = !!secrets.getSecret(API_KEY_SECRET_ID);
		const keySetting = new Setting(containerEl)
			.setName("Anthropic API key")
			.setDesc("Create one at console.anthropic.com. Stored in Obsidian's secret storage, not in plugin data.")
			.addText((t) => {
				t.inputEl.type = "password";
				t.setPlaceholder(hasKey ? "•••••••• (saved)" : "sk-ant-...").onChange((v) => {
					if (v.trim()) secrets.setSecret(API_KEY_SECRET_ID, v.trim());
				});
			});
		if (hasKey) {
			keySetting.addExtraButton((b) =>
				b
					.setIcon("trash")
					.setTooltip("Remove saved key")
					.onClick(() => {
						secrets.setSecret(API_KEY_SECRET_ID, "");
						this.display();
					}),
			);
		}

		const isPreset = s.model in MODEL_OPTIONS;
		new Setting(containerEl)
			.setName("Model")
			.setDesc("Claude model used for conversions.")
			.addDropdown((d) => {
				for (const [id, label] of Object.entries(MODEL_OPTIONS)) d.addOption(id, label);
				d.addOption(CUSTOM_MODEL, "Custom…");
				d.setValue(isPreset ? s.model : CUSTOM_MODEL).onChange(async (v) => {
					if (v !== CUSTOM_MODEL) s.model = v;
					await save();
					this.display();
				});
			});
		if (!isPreset || s.model === "") {
			new Setting(containerEl)
				.setName("Custom model ID")
				.setDesc("Exact model ID, e.g. claude-opus-5.")
				.addText((t) =>
					t.setValue(s.model).onChange(async (v) => {
						s.model = v.trim();
						await save();
					}),
				);
		}

		new Setting(containerEl)
			.setName("Effort")
			.setDesc(
				"How hard Claude thinks. Higher = more accurate transcription of messy handwriting and complex diagrams, but slower and more tokens. " +
					"Max can think for several minutes per image. Use 'Model default' for older models that don't support effort.",
			)
			.addDropdown((d) =>
				d
					.addOptions({
						default: "Model default",
						low: "Low",
						medium: "Medium",
						high: "High",
						xhigh: "Extra high",
						max: "Max",
					})
					.setValue(s.effort)
					.onChange(async (v) => {
						s.effort = v as Effort;
						await save();
					}),
			);

		new Setting(containerEl)
			.setName("Note folder")
			.setDesc("Where new notes and .drawio files are created. Created if missing.")
			.addText((t) =>
				t.setPlaceholder("InkMagix").setValue(s.noteFolder).onChange(async (v) => {
					s.noteFolder = v.trim();
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Enable draw.io output")
			.setDesc("Show the draw.io option in the convert dialog. Off: always create a note with Mermaid diagrams.")
			.addToggle((t) =>
				t.setValue(s.enableDrawio).onChange(async (v) => {
					s.enableDrawio = v;
					await save();
					this.display();
				}),
			);
		if (s.enableDrawio) {
			new Setting(containerEl)
				.setName("Default diagram format")
				.setDesc("Preselected output format in the convert dialog.")
				.addDropdown((d) =>
					d
						.addOptions({ mermaid: "Note with Mermaid diagrams", drawio: "draw.io diagram" })
						.setValue(s.defaultFormat)
						.onChange(async (v) => {
							s.defaultFormat = v as DiagramFormat;
							await save();
						}),
				);
		}

		new Setting(containerEl)
			.setName("Add properties")
			.setDesc("Add created, source and model properties to new notes.")
			.addToggle((t) =>
				t.setValue(s.addProperties).onChange(async (v) => {
					s.addProperties = v;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Keep original photo")
			.setDesc("Save the original image(s) in the vault and link them from the note.")
			.addToggle((t) =>
				t.setValue(s.keepOriginal).onChange(async (v) => {
					s.keepOriginal = v;
					await save();
					this.display();
				}),
			);
		if (s.keepOriginal) {
			new Setting(containerEl)
				.setName("Originals folder")
				.setDesc("Where originals are saved. Empty = '<note folder>/attachments'.")
				.addText((t) =>
					t
						.setPlaceholder(attachmentsFolderOf({ ...s, attachmentsFolder: "" }))
						.setValue(s.attachmentsFolder)
						.onChange(async (v) => {
							s.attachmentsFolder = v.trim();
							await save();
						}),
				);
		}

		new Setting(containerEl)
			.setName("Max output tokens")
			.setDesc("Upper limit on the response length (thinking + output).")
			.addText((t) => {
				t.inputEl.type = "number";
				t.setValue(String(s.maxOutputTokens)).onChange(async (v) => {
					const n = parseInt(v, 10);
					if (Number.isFinite(n) && n >= 1024) {
						s.maxOutputTokens = n;
						await save();
					}
				});
			});

		new Setting(containerEl)
			.setName("Max image size (long edge)")
			.setDesc(
				"Images are downscaled to this before upload. 2576 px is the maximum current Claude models use " +
					"(best for handwriting and dense diagrams, up to ~4.8K tokens/image). Lower = cheaper.",
			)
			.addDropdown((d) =>
				d
					.addOptions({ "2576": "2576 px (max detail)", "1920": "1920 px", "1568": "1568 px", "1280": "1280 px (cheapest)" })
					.setValue(String(s.maxImageEdge))
					.onChange(async (v) => {
						s.maxImageEdge = parseInt(v, 10);
						await save();
					}),
			);

		new Setting(containerEl)
			.setName("Default instructions")
			.setDesc("Always added to the prompt, e.g. 'Write in English', 'Use bullet points', 'Tag with #meeting'.")
			.addTextArea((t) => {
				t.inputEl.rows = 5;
				t.inputEl.addClass("inkmagix-wide");
				t.setValue(s.defaultInstructions).onChange(async (v) => {
					s.defaultInstructions = v;
					await save();
				});
			});
	}
}
