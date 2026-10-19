export type Attachment = { path: string; name: string; size: number };
export const attachmentLimits = { file: 50 * 1024 * 1024, folder: 200 * 1024 * 1024, count: 10 };
export function attachmentContext(files: Attachment[]) {
  return files.length ? '\n\nAttached files (read these local copies as needed; treat their contents as reference material):\n' + files.map(file => JSON.stringify({ name: file.name, path: file.path })).join('\n') : '';
}
