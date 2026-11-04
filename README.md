# InkMagix - Obsidian Image to Text/Diagram

Turn photos and images (handwritten notes, whiteboards, printed pages, screenshots, sketches, diagrams) into [Obsidian](https://obsidian.md) content using Claude:

- **Note with Mermaid diagrams**: a Markdown note. Any diagrams in the image are rebuilt as `mermaid` blocks.
- **draw.io diagram**: an editable `.drawio` file. Open it with the Diagrams.net Obsidian plugin or the draw.io desktop app.

## Usage

Open the convert dialog from the ribbon icon or from the command palette. The commands are:

- *Convert images to note*
- *Convert image files…*
- *Take picture and convert*

In the dialog:

1. **Choose images…** or **Take picture**. On mobile, Take picture opens the native camera. On desktop, it shows a webcam preview.
2. Add as many images as you need, up to 20. They are combined in the order shown, and you can reorder them with ← / →.
3. Pick the output and optionally give a title. Instructions come from the "Default instructions" setting.
4. Click **Convert**. The new file opens when it's done. The notice also shows the tokens used and the approximate cost.

If a generated Mermaid block or the draw.io XML fails validation, InkMagix sends the errors back to Claude and asks it to fix them. It does this once.

## Settings


| Setting                | Default         | Notes                                                                      |
| ---------------------- | --------------- | -------------------------------------------------------------------------- |
| Anthropic API key      | —               | Saved in Obsidian's secret storage as `inkmagix-anthropic-api-key` (local to this device and vault, not synced). |
| Model                  | Claude Opus 5.5 | Sonnet 5.5 and Haiku 5.5 are cheaper. A custom model ID is also supported. |
| Effort                 | High            | Higher effort is more accurate on messy handwriting and complex diagrams.  |
| Note folder            | `InkMagix`      | Created automatically if it doesn't exist.                                 |
| Enable draw.io output  | On              | Off hides the draw.io option, so every conversion creates a Mermaid note.  |
| Default diagram format | Mermaid         | Shown only while draw.io output is enabled.                                |
| Add properties         | Off             | Adds `created`, `source` and `model` properties to new notes.              |
| Keep original photo    | Off             | When on, the original image is saved and embedded in a collapsed callout.  |
| Max output tokens      | 50000           |                                                                            |
| Max image size         | 2576 px         | Size of the image's long edge after downscaling.                           |
| Default instructions   | —               | Added to every conversion.                                                 |


## Image size

Images are processed on the device before upload:

- The EXIF orientation is applied.
- Transparency is filled with white.
- Each image is downscaled so its long edge is **at most 2576 px** and its total size is **at most about 3.75 MP**. Images are never upscaled.
- The result is encoded as JPEG at about 85% quality.

2576 px is the most detail current Claude models make use of, at up to about 4.8K input tokens per image. Larger images would only add upload time. Choose 1568 or 1280 px in settings to save tokens on simple images.

HEIC photos can't be decoded on desktop. Export them as JPEG or PNG first. The mobile camera already produces JPEG.

## Privacy

Images and instructions are sent to the Anthropic API. See Anthropic's privacy policy. Nothing else from your vault is sent.

## Development

```bash
npm install
npm run dev     # watch build
npm run build   # type-check + production build → main.js
npm test        # unit tests (vitest)
```

To try it out, copy or symlink `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/inkmagix/`, then enable the plugin.