import { App, Modal, Notice, Platform, Setting } from "obsidian";
import { ConversionError } from "../claude";
import { MAX_IMAGES, convertImages, savePartial } from "../convert";
import type { InputImage } from "../image";
import type { DiagramFormat, InkMagixSettings } from "../settings";
import { WebcamModal } from "./WebcamModal";

export type StartAction = "file" | "camera" | null;

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/bmp,image/heic,image/heif,.heic,.heif";

export class ConvertModal extends Modal {
	private images: (InputImage & { url: string })[] = [];
	private format: DiagramFormat;
	private title = "";
	private abort: AbortController | null = null;

	private listEl!: HTMLElement;
	private statusEl!: HTMLElement;
	private convertBtn!: HTMLButtonElement;
	private cancelBtn!: HTMLButtonElement;
	private formEl!: HTMLElement;

	constructor(
		app: App,
		private settings: InkMagixSettings,
		private startAction: StartAction = null,
	) {
		super(app);
		this.format = settings.enableDrawio ? settings.defaultFormat : "mermaid";
	}

	onOpen() {
		const { contentEl } = this;
		this.titleEl.setText("Convert images");
		this.modalEl.addClass("inkmagix-modal");
		this.formEl = contentEl.createDiv();

		const add = this.formEl.createDiv({ cls: "inkmagix-add" });
		const fileBtn = add.createEl("button", { text: "Choose images…" });
		fileBtn.onclick = () => this.pickFiles();
		const camBtn = add.createEl("button", { text: "Take picture" });
		camBtn.onclick = () => this.takePicture();

		this.listEl = this.formEl.createDiv({ cls: "inkmagix-thumbs" });
		this.renderList();

		if (this.settings.enableDrawio) {
			new Setting(this.formEl)
				.setName("Output")
				.addDropdown((d) =>
					d
						.addOptions({ mermaid: "Note with Mermaid diagrams", drawio: "draw.io diagram" })
						.setValue(this.format)
						.onChange((v) => (this.format = v as DiagramFormat)),
				)
				.setClass("inkmagix-stacked");
		}
		new Setting(this.formEl)
			.setName("Title")
			.setDesc("Optional — Claude picks one if empty.")
			.addText((t) => t.onChange((v) => (this.title = v)))
			.setClass("inkmagix-stacked");

		this.statusEl = contentEl.createDiv({ cls: "inkmagix-status" });
		const footer = new Setting(contentEl).setClass("inkmagix-footer");
		footer.addButton((b) => {
			this.cancelBtn = b.buttonEl;
			b.setButtonText("Cancel").onClick(() => {
				if (this.abort) this.abort.abort();
				else this.close();
			});
		});
		footer.addButton((b) => {
			this.convertBtn = b.buttonEl;
			b.setButtonText("Convert").setCta().onClick(() => this.run());
		});
		this.updateButtons();

		if (this.startAction === "file") this.pickFiles();
		else if (this.startAction === "camera") this.takePicture();
	}

	private addImage(blob: Blob, name: string) {
		if (this.images.length >= MAX_IMAGES) {
			new Notice(`At most ${MAX_IMAGES} images per conversion.`);
			return;
		}
		this.images.push({ blob, name, url: URL.createObjectURL(blob) });
		this.renderList();
	}

	private pickFiles() {
		const input = createEl("input", { attr: { type: "file", accept: ACCEPT, multiple: "" } });
		input.onchange = () => {
			for (const f of Array.from(input.files ?? [])) this.addImage(f, f.name);
		};
		input.click();
	}

	private takePicture() {
		if (Platform.isMobile) {
			// Opens the native camera app on iOS/Android.
			const input = createEl("input", { attr: { type: "file", accept: "image/*", capture: "environment" } });
			input.onchange = () => {
				const f = input.files?.[0];
				if (f) this.addImage(f, f.name || `Photo ${stamp()}.jpg`);
			};
			input.click();
		} else {
			new WebcamModal(this.app, (blob) => this.addImage(blob, `Photo ${stamp()}.jpg`)).open();
		}
	}

	private renderList() {
		this.listEl.empty();
		if (this.images.length === 0) {
			this.listEl.createDiv({ cls: "inkmagix-empty", text: "No images yet. Pages are combined in the order shown." });
		}
		this.images.forEach((img, i) => {
			const card = this.listEl.createDiv({ cls: "inkmagix-thumb" });
			card.createEl("img", { attr: { src: img.url, alt: img.name } });
			card.createDiv({ cls: "inkmagix-thumb-name", text: `${i + 1}. ${img.name}` });
			const tools = card.createDiv({ cls: "inkmagix-thumb-tools" });
			const btn = (label: string, title: string, fn: () => void, disabled = false) => {
				const b = tools.createEl("button", { text: label, attr: { "aria-label": title } });
				b.disabled = disabled || !!this.abort;
				b.onclick = fn;
			};
			btn("←", "Move earlier", () => this.move(i, -1), i === 0);
			btn("→", "Move later", () => this.move(i, 1), i === this.images.length - 1);
			btn("✕", "Remove", () => {
				URL.revokeObjectURL(img.url);
				this.images.splice(i, 1);
				this.renderList();
			});
		});
		this.updateButtons();
	}

	private move(i: number, d: number) {
		const j = i + d;
		[this.images[i], this.images[j]] = [this.images[j], this.images[i]];
		this.renderList();
	}

	private updateButtons() {
		if (!this.convertBtn) return;
		const busy = !!this.abort;
		this.convertBtn.disabled = busy || this.images.length === 0;
		this.cancelBtn.setText(busy ? "Stop" : "Cancel");
		this.formEl.toggleClass("inkmagix-busy", busy);
		// Thumbnail buttons are handled in renderList().
		this.formEl.querySelectorAll<HTMLInputElement>(".inkmagix-add button, input, textarea, select").forEach((el) => (el.disabled = busy));
	}

	private setStatus(msg: string, cls?: "error") {
		this.statusEl.empty();
		this.statusEl.toggleClass("mod-warning", cls === "error");
		this.statusEl.setText(msg);
	}

	private async run() {
		this.abort = new AbortController();
		this.updateButtons();
		this.renderList();
		try {
			const res = await convertImages(
				this.app,
				this.settings,
				this.images,
				{ format: this.format, extraInstructions: "", title: this.title },
				this.abort.signal,
				(m) => this.setStatus(m),
			);
			new Notice(res.summary, 8000);
			this.abort = null;
			this.close();
			await this.app.workspace.getLeaf("tab").openFile(res.file);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			this.setStatus(msg, "error");
			if (e instanceof ConversionError && e.partial) {
				const partial = e.partial;
				const b = this.statusEl.createEl("button", { text: "Save partial output", cls: "inkmagix-partial" });
				b.onclick = async () => {
					const f = await savePartial(this.app, this.settings, this.format, partial);
					new Notice(`Saved ${f.path}`);
					this.close();
					await this.app.workspace.getLeaf("tab").openFile(f);
				};
			}
		} finally {
			this.abort = null;
			this.updateButtons();
			this.renderList();
		}
	}

	onClose() {
		this.abort?.abort();
		this.images.forEach((i) => URL.revokeObjectURL(i.url));
		this.contentEl.empty();
	}
}

function stamp(): string {
	const d = new Date();
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`;
}
