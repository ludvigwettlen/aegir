export const fontChoices = [
  { id: 'inter', name: 'Inter', family: "'Inter Variable', sans-serif" },
  { id: 'manrope', name: 'Manrope', family: "'Manrope Variable', sans-serif" },
  { id: 'dm-sans', name: 'DM Sans', family: "'DM Sans Variable', sans-serif" },
  { id: 'roboto', name: 'Roboto', family: "'Roboto Variable', sans-serif" },
  { id: 'source-sans-3', name: 'Source Sans 3', family: "'Source Sans 3 Variable', sans-serif" },
  { id: 'ibm-plex-sans', name: 'IBM Plex Sans', family: "'IBM Plex Sans Variable', sans-serif" },
  { id: 'playfair-display', name: 'Playfair Display', family: "'Playfair Display Variable', Georgia, serif" },
  { id: 'lora', name: 'Lora', family: "'Lora Variable', Georgia, serif" },
  { id: 'system', name: 'System', family: 'system-ui, -apple-system, sans-serif' },
] as const;

export type FontId = typeof fontChoices[number]['id'];
export type Typography = { system: FontId; editor: FontId };
export const defaultTypography: Typography = { system: 'inter', editor: 'inter' };
export const fontFamily = (id: FontId) => fontChoices.find(font => font.id === id)!.family;

export function validateTypography(value: unknown): Typography {
  if (!value || typeof value !== 'object') throw new Error('Choose a system and Markdown editor font');
  const { system, editor } = value as Record<string, unknown>;
  if (!fontChoices.some(font => font.id === system) || !fontChoices.some(font => font.id === editor))
    throw new Error('Choose a font from the available options');
  return { system, editor } as Typography;
}

export function readTypography(saved?: string): Typography {
  try { return validateTypography(JSON.parse(saved || 'null')); }
  catch { return { ...defaultTypography }; }
}
