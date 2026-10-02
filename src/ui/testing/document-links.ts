import '../design-system/tokens.scss';
import '../document-workspace.scss';
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { DocumentLinkSource } from '../document-links';
(window as any).opened = [];
(window as any).editor = new Editor({ element: document.querySelector<HTMLElement>('#host')!,
  extensions: [StarterKit.configure({ link: { openOnClick: false } }), Markdown,
    DocumentLinkSource.configure({ openLink: href => (window as any).opened.push(href) })],
  editorProps: { attributes: { class: 'ws-document-prose' } },
  content: 'Before [Example](https://example.com) after.', contentType: 'markdown' });
