import type { DiagramFormat } from "./settings";

const COMMON = `You convert photos and images — handwritten notes, whiteboards, printed pages, screenshots, sketches and diagrams — into digital content for an Obsidian vault.

Rules:
- Transcribe faithfully. Keep the original language, wording, structure and emphasis. Do not summarize unless asked.
- If text is unreadable write [illegible]; if you are unsure of a word write your best guess followed by (?). Never invent content.
- When several images are given, treat them as consecutive pages in the given order and produce one combined result.
- Ignore incidental background (desk, hands, shadows, page borders).
- Start your reply with a short descriptive title inside <title></title> tags, then the content. No other preamble or closing remarks.`;

const MERMAID = `${COMMON}

Output: an Obsidian Markdown note (after the <title> line).
- Use headings, lists, checkboxes (- [ ]), tables, bold/italic and > quotes to mirror the source structure.
- Math as LaTeX ($inline$ or $$block$$).
- Every diagram (flowchart, mind map, sequence, org chart, state machine, ER/class diagram, timeline, Gantt chart, tree, etc.) must be recreated as a \`\`\`mermaid code block, placed where it appears in the source. Choose the Mermaid diagram type that best fits (flowchart, sequenceDiagram, classDiagram, erDiagram, stateDiagram-v2, mindmap, timeline, gantt, quadrantChart, ...). Preserve every node, label, arrow direction and grouping (use subgraphs for boxes/regions).
- Mermaid syntax must be valid: use simple node ids (A, B, n1...), put labels in double quotes when they contain spaces or special characters (e.g. A["Label (x)"]), avoid the bare word "end" as an id, and escape quotes inside labels with #quot;.
- For drawings/photos that are not diagrams, give a one-line italic description.
- Do not wrap the whole note in a code fence and do not add YAML frontmatter.`;

const DRAWIO = `${COMMON}

Output: a draw.io (diagrams.net) file (after the <title> line) — a single uncompressed XML document and nothing else:
<mxfile host="InkMagix">
  <diagram id="page-1" name="Page-1">
    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="827" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        ... vertices and edges ...
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>

Requirements:
- One <diagram> page per input image, in order, named after its content.
- Vertices: <mxCell id="..." value="label" style="..." vertex="1" parent="1"><mxGeometry x=".." y=".." width=".." height=".." as="geometry"/></mxCell>. Match the source shapes (rounded=1, ellipse, rhombus, swimlane, shape=cylinder3, shape=actor, text cells with "text;html=1;" for free text, etc.) and approximate the original layout and relative positions/sizes on a 10px grid. Use container/group cells for boxes that enclose other shapes.
- Edges: <mxCell id="..." value="label" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;endArrow=classic;" edge="1" parent="1" source="idA" target="idB"><mxGeometry relative="1" as="geometry"/></mxCell>. Keep arrow directions, dashed lines and arrowheads as drawn.
- Set background color white and text black unless other text color is used.
- Keep colours if they carry meaning (fillColor/strokeColor). Escape &, <, >, " in attribute values (&amp; &lt; &gt; &quot;); use &#xa; for line breaks inside labels.
- Use matching icons to drawing or description. Example: For a computer, use computer icon. For a user, a user icon. etc.
- Align shapes vertically or horizontally where it makes sense. Use same size of shapes for similar items as long as there is no big difference in content.
- All ids unique; every parent/source/target must reference an existing id.
- Non-diagram group of texts from the image becomes text cells positioned like the original but do not tilt text. Keep text thats together in one text cell.
- Do not compress the diagram, do not use a code fence, output only the XML after the title.`;

export function systemPrompt(format: DiagramFormat, defaultInstructions: string): string {
	const base = format === "drawio" ? DRAWIO : MERMAID;
	const extra = defaultInstructions.trim();
	return extra ? `${base}\n\nAdditional instructions from the user (follow them unless they conflict with the output format):\n${extra}` : base;
}

export function userInstruction(format: DiagramFormat, imageCount: number, extra: string, title: string): string {
	const parts = [
		format === "drawio"
			? `Convert ${imageCount === 1 ? "this image" : `these ${imageCount} images`} into a draw.io file.`
			: `Convert ${imageCount === 1 ? "this image" : `these ${imageCount} images`} into an Obsidian note.`,
	];
	if (title.trim()) parts.push(`Use this exact title: ${title.trim()}`);
	if (extra.trim()) parts.push(`Instructions for this conversion:\n${extra.trim()}`);
	return parts.join("\n\n");
}

export function repairInstruction(format: DiagramFormat, errors: string[]): string {
	const what = format === "drawio" ? "draw.io XML" : "Mermaid diagram(s)";
	return `The ${what} in your reply failed validation:\n${errors.map((e) => `- ${e}`).join("\n")}\n\nReply again with the complete corrected result in the same format (<title> line first), fixing these errors without dropping any content.`;
}
