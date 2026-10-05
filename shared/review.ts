// Review in browser: Claude opens a Markdown draft in human-review, the user's browser surface for
// editing and commenting on long drafts, then applies each batch the user sends back.

export type ReviewTarget = {
  // A path relative to the task folder (where the task's runs work), or an absolute path for an attachment.
  path: string;
  // Where the draft is mirrored in the user's brain, which git versions: each batch becomes a commit, the
  // Claude draft to final pairs voice-dna-learning-sweep reads. Null when the file already lives there.
  mirror: string | null;
};

const markdown = /\.(md|markdown)$/i;
const inBrainDrafts = (path: string) => /(^~|\/Users\/[^/]+)\/brain\/drafts\//.test(path);

// human-review's poll must return before Claude Code's 10-minute command limit, and a review left open
// in a closed tab must not keep the run going forever.
export function reviewRequest(target: ReviewTarget): string {
  const where = target.path.startsWith('/') ? '' : " from this task's folder";
  const keep = target.mirror
    ? `Edit that file in place. Before my first batch and after each one, copy it to \`${target.mirror}\` and commit.`
    : 'Edit that file in place, and commit it after each batch.';
  return `Open \`${target.path}\`${where} in human-review so I can edit it in the browser. ${keep} Poll with \`--timeout 540\` and keep going until I press End review, or until 30 minutes pass with no feedback. Then tell me what changed.`;
}

// A local Markdown file attached with ⌘V (a file:// link), as a path. Null for web links and other files.
export function localMarkdownPath(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'file:') return null;
    const path = decodeURIComponent(parsed.pathname);
    return markdown.test(path) ? path : null;
  } catch {
    return null;
  }
}

// The brain mirror for a draft: dated by the task's creation, so a second review of the same task reuses it.
export function reviewMirror(path: string, createdAt: string): string | null {
  if (inBrainDrafts(path)) return null;
  const name = path.split('/').pop() || 'draft.md';
  return `~/brain/drafts/${/^\d{4}-\d{2}-\d{2}-/.test(name) ? name : `${createdAt.slice(0, 10)}-${name}`}`;
}

// What a task can be reviewed on: the Markdown files in its folder, then an attached local Markdown file.
export function reviewTargets(files: string[], attachments: string[], createdAt: string): ReviewTarget[] {
  const attached = attachments.map(localMarkdownPath).filter((path): path is string => !!path);
  return [...files.filter(file => markdown.test(file)), ...attached.filter(path => !files.includes(path))]
    .map(path => ({ path, mirror: reviewMirror(path, createdAt) }));
}
