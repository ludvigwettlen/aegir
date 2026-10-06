// Files the user drops on a conversation. Legolas copies the bytes into the task's own folder and hands
// the agent absolute paths: Claude Code's Read parses text, images, PDFs and notebooks, and its
// docx / xlsx / pptx skills read Office files. Legolas parses, converts and executes nothing.
export type FileKind = 'text' | 'image' | 'pdf' | 'notebook' | 'office' | 'other';

export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_FILES_PER_MESSAGE = 10;
// Per attachment folder: a task's own attachments, or one chat thread's files.
export const MAX_FOLDER_BYTES = 200 * 1024 * 1024;

const TEXT_TYPES: Record<string, string> = {
  md: 'text/markdown', markdown: 'text/markdown', txt: 'text/plain', csv: 'text/csv',
  tsv: 'text/tab-separated-values', json: 'application/json', yaml: 'application/yaml',
  yml: 'application/yaml', html: 'text/html', xml: 'application/xml', log: 'text/plain',
};
// Source files are text to Read; the list only decides the icon and the word in the prompt.
const SOURCE_EXTENSIONS = 'ts tsx js jsx mjs cjs py rb go rs java kt swift c h cc cpp hpp cs php sh bash zsh sql css scss sass less toml ini conf r lua dart vue svelte'.split(' ');
const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
};
const OFFICE_TYPES: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export const fileExtension = (name: string) => (name.match(/\.([a-z0-9]{1,12})$/i)?.[1] || '').toLowerCase();

/** What the extension claims this file is. */
export function declaredType(name: string): { kind: FileKind; mime: string } {
  const extension = fileExtension(name);
  if (TEXT_TYPES[extension]) return { kind: 'text', mime: TEXT_TYPES[extension] };
  if (SOURCE_EXTENSIONS.includes(extension)) return { kind: 'text', mime: 'text/plain' };
  if (IMAGE_TYPES[extension]) return { kind: 'image', mime: IMAGE_TYPES[extension] };
  if (OFFICE_TYPES[extension]) return { kind: 'office', mime: OFFICE_TYPES[extension] };
  if (extension === 'pdf') return { kind: 'pdf', mime: 'application/pdf' };
  if (extension === 'ipynb') return { kind: 'notebook', mime: 'application/x-ipynb+json' };
  return { kind: 'other', mime: 'application/octet-stream' };
}

/** What the first bytes say it is, for the formats that announce themselves. Null for text and the unknown. */
export function magicKind(head: Uint8Array): FileKind | null {
  const at = (index: number, ...signature: number[]) => signature.every((byte, offset) => head[index + offset] === byte);
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'image'; // PNG
  if (at(0, 0xff, 0xd8, 0xff)) return 'image'; // JPEG
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'image'; // GIF8
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image'; // RIFF…WEBP
  if (at(0, 0x25, 0x50, 0x44, 0x46)) return 'pdf'; // %PDF
  if (at(0, 0x50, 0x4b, 0x03, 0x04)) return 'office'; // zip container: docx, xlsx, pptx
  return null;
}

// Extension and magic bytes have to agree. A .png that is really a zip is attached as an unknown type,
// and the prompt tells the agent to look at it before trusting the name.
export function identify(name: string, head: Uint8Array): { kind: FileKind; mime: string } {
  const declared = declaredType(name);
  const magic = magicKind(head);
  const binary = declared.kind === 'image' || declared.kind === 'pdf' || declared.kind === 'office';
  if (binary ? magic !== declared.kind : magic !== null) return { kind: 'other', mime: 'application/octet-stream' };
  return declared;
}

/** A file name that is safe to join onto a folder: no path, no control characters, no leading dot, 120 characters. */
export function safeFileName(raw: string): string {
  const base = (raw.split(/[/\\]/).pop() || '').replace(/[\x00-\x1f]/g, '').replace(/^\.+/, '').trim();
  if (!base) return 'attachment';
  if (base.length <= 120) return base;
  const extension = fileExtension(base);
  const suffix = extension ? `.${extension}` : '';
  return `${base.slice(0, 120 - suffix.length).trim()}${suffix}`;
}

/** Collisions get a counter. Nothing in an attachment folder is ever overwritten. */
export function uniqueFileName(name: string, taken: (candidate: string) => boolean): string {
  if (!taken(name)) return name;
  const extension = fileExtension(name);
  const suffix = extension ? `.${extension}` : '';
  const stem = suffix ? name.slice(0, -suffix.length) : name;
  for (let count = 2; count <= 999; count++) {
    const candidate = `${stem} (${count})${suffix}`;
    if (!taken(candidate)) return candidate;
  }
  throw new Error('Too many files with this name in the folder');
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

const KIND_WORD: Record<FileKind, string> = {
  text: 'text', image: 'image', pdf: 'PDF', notebook: 'notebook', office: 'Office file', other: 'unknown type',
};
// What the agent needs beyond the path: which skill opens it, or that Legolas could not identify it.
function kindNote(name: string, kind: FileKind): string {
  if (kind === 'office') return ` Use the ${fileExtension(name)} skill to read it.`;
  if (kind === 'pdf') return ' Read takes `pages`, and requires it over 10 pages.';
  if (kind === 'other') return ' Legolas could not identify this file; inspect it before trusting the extension.';
  return '';
}

export type PromptFile = { name: string; path: string; kind: FileKind; bytes: number; at?: string };
const day = (value: string) => new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const promptLine = (file: PromptFile) =>
  `- ${file.path} (${KIND_WORD[file.kind]}, ${fileSize(file.bytes)}${file.at ? `, attached ${day(file.at)}` : ''}).${kindNote(file.name, file.kind)}`;

/** Sent with no text, the files are the instruction. */
export const FILES_ONLY = 'No instruction, the files are the message.';

/** The run prompt's file block: absolute paths, so the agent's own Read does the parsing. */
export function attachmentPrompt(attached: PromptFile[], onTodo: PromptFile[]): string {
  const blocks: string[] = [];
  if (attached.length)
    blocks.push(`Files attached to this message (read them with Read; absolute paths):\n${attached.map(promptLine).join('\n')}`);
  if (onTodo.length)
    blocks.push(`Files already on this todo:\n${onTodo.map(promptLine).join('\n')}`);
  return blocks.join('\n\n');
}

// ---- Filing to the brain ---------------------------------------------------------------------
// The task folder stages, the brain keeps. Text sits at the top of sources/<slug>/ and is versioned;
// binaries go to sources/<slug>/.raw/, which .gitignore keeps out of the brain's history. That is the
// shape the brain already uses for a large source (an 18 MB PDF in .raw/, the page tracked).
export const brainTarget = (kind: FileKind, bytes: number): 'tracked' | 'raw' =>
  kind === 'text' || kind === 'notebook' || (kind === 'image' && bytes <= 1024 * 1024) ? 'tracked' : 'raw';

export const RAW_IGNORE_RULE = 'sources/*/.raw/';
export const isBrainSlug = (value: string) => /^[a-z0-9][a-z0-9-]{0,59}$/.test(value);

/** A proposed sources/ slug from the file name. A bad slug is a filing error that spreads through backlinks, so the user confirms it. */
export function brainSlug(name: string): string {
  const extension = fileExtension(name);
  const stem = extension ? name.slice(0, -(extension.length + 1)) : name;
  const slug = stem.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  return slug || 'attachment';
}

/** What the agent is asked to do after the bytes are in the brain: the judgment half of hard rule 5. */
export function brainFilingRequest(name: string, brainPath: string): string {
  return `I filed ${name} in the brain at ${brainPath}.

Read it, then finish the filing the way content-log does:
- Write what this is into the index.md beside it, under the front matter: a short paragraph, no more.
- Append a Timeline entry to every person, company and program the file touches, citing that source path.
- Leave the raw file as it is. It is immutable input.

Tell me which pages you touched.`;
}
