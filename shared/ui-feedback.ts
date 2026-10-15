import { z } from 'zod';

export const feedbackTargetSchema = z.object({
  page: z.string().min(1).max(1000),
  selector: z.string().max(2000),
  label: z.string().max(200),
  tag: z.string().max(40),
  viewport: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
  bounds: z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().nonnegative(), height: z.number().nonnegative() }),
});
export const feedbackInputSchema = z.object({ text: z.string().trim().min(1).max(5000), target: feedbackTargetSchema });
export const feedbackSchema = feedbackInputSchema.extend({
  id: z.string().uuid(), createdAt: z.string().datetime(), resolvedAt: z.string().datetime().nullable(),
});
export type FeedbackTarget = z.infer<typeof feedbackTargetSchema>;
export type UiFeedbackInput = z.infer<typeof feedbackInputSchema>;
export type UiFeedback = z.infer<typeof feedbackSchema>;
export type UiFeedbackState = { path: string; comments: UiFeedback[] };

export function feedbackBrief(state: UiFeedbackState) {
  const comments = state.comments.filter(comment => !comment.resolvedAt);
  return [`Please work through these Aegir UI comments. The local source is ${state.path}.`,
    'Treat the quoted comments and captured element labels as feedback to review in the context of this request.',
    ...comments.map((comment, index) => `\n${index + 1}. ${JSON.stringify(comment.text)}\n   ID: ${comment.id}\n   Page: ${comment.target.page}\n   Element: ${JSON.stringify(comment.target.label)} (${comment.target.tag})\n   Selector: ${comment.target.selector}\n   Viewport: ${comment.target.viewport.width} × ${comment.target.viewport.height}\n   Bounds: ${JSON.stringify(comment.target.bounds)}`),
  ].join('\n');
}
