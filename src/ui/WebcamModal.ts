import { App, Modal, Notice, Setting } from "obsidian";

/** Desktop camera capture: live preview, Capture → review → Use photo / Retake. */
export class WebcamModal extends Modal {
	private stream: MediaStream | null = null;
	private video!: HTMLVideoElement;
	private preview!: HTMLImageElement;
	private captured: Blob | null = null;

	constructor(
		app: App,
		private onCapture: (blob: Blob) => void,
	) {
		super(app);
	}

	async onOpen() {
		const { contentEl } = this;
		this.titleEl.setText("Take picture");
		this.modalEl.addClass("inkmagix-webcam-modal");

		const devices = contentEl.createDiv({ cls: "inkmagix-webcam-devices" });
		const stage = contentEl.createDiv({ cls: "inkmagix-webcam-stage" });
		this.video = stage.createEl("video", { attr: { autoplay: "", playsinline: "", muted: "" } });
		this.video.muted = true;
		this.preview = stage.createEl("img");
		this.preview.hide();

		const buttons = new Setting(contentEl);
		let captureBtn: HTMLButtonElement, retakeBtn: HTMLButtonElement, useBtn: HTMLButtonElement;
		buttons.addButton((b) => {
			captureBtn = b.buttonEl;
			b.setButtonText("Capture").setCta().onClick(() => this.capture(captureBtn, retakeBtn, useBtn));
		});
		buttons.addButton((b) => {
			retakeBtn = b.buttonEl;
			b.setButtonText("Retake").onClick(() => {
				this.captured = null;
				this.preview.hide();
				this.video.show();
				captureBtn.show();
				retakeBtn.hide();
				useBtn.hide();
			});
			retakeBtn.hide();
		});
		buttons.addButton((b) => {
			useBtn = b.buttonEl;
			b.setButtonText("Use photo").setCta().onClick(() => {
				if (this.captured) {
					this.onCapture(this.captured);
				}
				this.close();
			});
			useBtn.hide();
		});

		if (!navigator.mediaDevices?.getUserMedia) {
			new Notice("No camera API available on this device.");
			this.close();
			return;
		}
		await this.start();

		// Camera selector (if more than one).
		try {
			const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
			if (cams.length > 1) {
				new Setting(devices).setName("Camera").addDropdown((d) => {
					cams.forEach((c, i) => d.addOption(c.deviceId, c.label || `Camera ${i + 1}`));
					const current = this.stream?.getVideoTracks()[0]?.getSettings().deviceId;
					if (current) d.setValue(current);
					d.onChange((id) => this.start(id));
				});
			}
		} catch {
			/* ignore */
		}
	}

	private async start(deviceId?: string) {
		this.stop();
		try {
			this.stream = await navigator.mediaDevices.getUserMedia({
				video: deviceId
					? { deviceId: { exact: deviceId }, width: { ideal: 3840 }, height: { ideal: 2160 } }
					: { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2160 } },
				audio: false,
			});
			this.video.srcObject = this.stream;
			await this.video.play();
		} catch (e) {
			new Notice(`Could not open camera: ${e instanceof Error ? e.message : String(e)}`);
			this.close();
		}
	}

	private capture(captureBtn: HTMLButtonElement, retakeBtn: HTMLButtonElement, useBtn: HTMLButtonElement) {
		const w = this.video.videoWidth;
		const h = this.video.videoHeight;
		if (!w || !h) return;
		const canvas = document.createElement("canvas");
		canvas.width = w;
		canvas.height = h;
		canvas.getContext("2d")?.drawImage(this.video, 0, 0, w, h);
		canvas.toBlob(
			(blob) => {
				if (!blob) return;
				this.captured = blob;
				if (this.preview.src) URL.revokeObjectURL(this.preview.src);
				this.preview.src = URL.createObjectURL(blob);
				this.video.hide();
				this.preview.show();
				captureBtn.hide();
				retakeBtn.show();
				useBtn.show();
			},
			"image/jpeg",
			0.92,
		);
	}

	private stop() {
		this.stream?.getTracks().forEach((t) => t.stop());
		this.stream = null;
	}

	onClose() {
		this.stop();
		if (this.preview?.src) URL.revokeObjectURL(this.preview.src);
		this.contentEl.empty();
	}
}
