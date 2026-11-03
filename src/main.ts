import { Plugin } from "obsidian";
import { DEFAULT_SETTINGS, InkMagixSettings, InkMagixSettingTab } from "./settings";
import { ConvertModal, StartAction } from "./ui/ConvertModal";

export default class InkMagixPlugin extends Plugin {
	settings!: InkMagixSettings;

	async onload() {
		await this.loadSettings();

		this.addRibbonIcon("image-plus", "InkMagix: convert images to note", () => this.open(null));

		this.addCommand({
			id: "convert-images",
			name: "Convert images to note",
			callback: () => this.open(null),
		});
		this.addCommand({
			id: "convert-from-file",
			name: "Convert image files…",
			callback: () => this.open("file"),
		});
		this.addCommand({
			id: "convert-from-camera",
			name: "Take picture and convert",
			callback: () => this.open("camera"),
		});

		this.addSettingTab(new InkMagixSettingTab(this.app, this));
	}

	private open(action: StartAction) {
		new ConvertModal(this.app, this.settings, action).open();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
