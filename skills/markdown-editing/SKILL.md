---
name: markdown-editing
description: Create or edit Markdown documents intended for Aegir's document editor, including reports and tables, while keeping them directly editable. Use when writing or revising local .md or .markdown deliverables.
---

# Markdown editing for Aegir

Write ordinary Markdown that the user can continue editing in Aegir. Its editor makes documents containing unsupported HTML, frontmatter, or footnotes read only to prevent content loss. This guidance applies to Aegir documents; preserve a different format when the user explicitly requests it.

## Keep documents editable

- Use Markdown headings, paragraphs, emphasis, lists, checklists, blockquotes, fenced code blocks, links, images, and simple pipe tables.
- Do not introduce embedded HTML for layout or formatting. In particular, do not use HTML line-break tags in table cells. Avoid HTML tables, spans, divs, details/summary blocks, and comments.
- Put titles, dates, status, and other document metadata in visible Markdown text rather than YAML frontmatter. This applies to document deliverables, not the required frontmatter in a SKILL.md package.
- Use inline Markdown source links or a Sources section instead of footnote syntax.
- Preserve Aegir's existing `<!-- aegir:table-header=off -->` marker immediately before its table. It is an editor-supported exception to the HTML-comment restriction; do not invent other markers or move it away from the table.

## Tables

Keep each row on one source line, with a consistent number of cells and a separator row. Escape literal pipes within cell text. Prefer short sentences or semicolon-separated phrases inside a cell; ordinary text wraps automatically.

If a cell needs several paragraphs or a list, keep a concise summary in the table and put the full explanation under a heading below it. Do not add HTML line breaks, literal newlines, or nested lists to a pipe-table cell to simulate that layout.

For example, a cell can say `Builds stakeholder trust; handles conflicting requests; clarifies decision ownership.` Longer descriptions belong in a related prose section. Preserve all substantive details when moving text out of a table.

## Editing existing documents

Read the current file before editing and preserve the user's structure, wording, links, and unrelated changes. A read-only banner can be caused by HTML that appears only as formatting in the rendered view; inspect the Markdown source to identify it.

When making an Aegir document editable is within the task, convert simple HTML formatting to equivalent Markdown while preserving its content. For a table-cell HTML line break, use sentence punctuation or move the full passage below the table. Do not strip meaningful HTML, metadata, or footnotes merely to dismiss a banner; explain the limitation if an equivalent conversion would lose information.

Before finishing, inspect the changed source for embedded HTML, comments, frontmatter, and footnotes, and check table structure and retained links. Code examples can contain HTML inside fenced code blocks. If the editor is available, confirm the document opens without the read-only banner; otherwise state only the checks actually performed.
