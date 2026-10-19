export function reviewRequest(path: string): string {
  return `Open the saved Markdown document at ${JSON.stringify(path)} in human-review so I can edit and comment in the browser. First check that human-review is installed and available; if not, explain how to configure it and stop. Apply the feedback batches to this file in place. Preserve my direct edits. Poll with --timeout 540, stopping when I press End review or after 30 minutes without feedback. Summarize the changes when finished. Do not copy the file to a brain folder or create git commits as part of this review.`;
}
export type ReviewComment = { passage: string; text: string };
export function reviewBatchMessage(path: string, comments: ReviewComment[]) {
  return [`Review of ${JSON.stringify(path)}: ${comments.length} comment${comments.length === 1 ? '' : 's'}. My direct edits are saved in the file; preserve them.`,
    ...comments.map((comment, i) => `\n${i + 1}. Passage: ${JSON.stringify(comment.passage)}\nComment: ${comment.text}`),
    '\nApply each comment in the file, then explain what changed for each. Retain the annotations as review history. Do not mirror files or make git commits for this review.',
  ].join('\n');
}
