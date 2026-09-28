// Only explicitly wrapped results can supply protocol content. Ordinary connector
// data (including objects with a `content` field) remains ordinary JSON.
export class ToolResult {
  constructor(
    readonly contentItems: ({ type: 'inputText'; text: string } | { type: 'inputImage'; imageUrl: string })[],
    readonly success = true,
  ) {}
}

export function mcpToolResult(value: { content?: unknown; isError?: unknown }): ToolResult {
  const items: ToolResult['contentItems'] = [];
  for (const block of Array.isArray(value.content) ? value.content : []) {
    if (block.type === 'text' && typeof block.text === 'string') {
      items.push({ type: 'inputText', text: block.text.length > 40_000
        ? `${block.text.slice(0, 40_000)}\n[Truncated. Request a browser snapshot with a narrower target or depth for more detail.]` : block.text });
    } else if (block.type === 'image' && typeof block.data === 'string' &&
      /^image\/(png|jpeg|webp)$/.test(block.mimeType) && block.data.length <= 16 * 1024 * 1024) {
      items.push({ type: 'inputImage', imageUrl: `data:${block.mimeType};base64,${block.data}` });
    }
  }
  if (!items.length) items.push({ type: 'inputText', text: 'The tool returned no supported content.' });
  return new ToolResult(items, value.isError !== true);
}

export function toolResponse(value: unknown) {
  return value instanceof ToolResult
    ? { success: value.success, contentItems: value.contentItems }
    : { success: true, contentItems: [{ type: 'inputText', text: JSON.stringify(value ?? null) }] };
}
