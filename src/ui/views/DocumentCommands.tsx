import { useEffect, useId, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import type { Node } from '@tiptap/pm/model';
import { Button } from '../design-system/primitives';

const commands = [
  { id: 'table', label: 'Table', detail: '3 columns, with a header row' },
  { id: 'link', label: 'Link', detail: 'Add text and a destination' },
  { id: 'bullet', label: 'Bullet list', detail: 'An unordered list' },
  { id: 'ordered', label: 'Numbered list', detail: 'A sequence of steps' },
  { id: 'task', label: 'Checklist', detail: 'Items you can check off' },
  { id: 'quote', label: 'Quote', detail: 'A block quotation' },
  { id: 'code', label: 'Code block', detail: 'Preformatted code' },
  { id: 'divider', label: 'Divider', detail: 'A horizontal rule' },
];
type Trigger = { from: number; to: number; query: string; left: number; top: number };
type LinkDraft = { from: number; to: number; doc: Node; text: string; href: string };

export function DocumentCommands({ editor }: { editor: Editor | null }) {
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [active, setActive] = useState(0);
  const [link, setLink] = useState<LinkDraft | null>(null);
  const [error, setError] = useState('');
  const dismissed = useRef('');
  const id = useId();
  const options = commands.filter(command => `${command.label} ${command.detail}`.toLowerCase().includes(trigger?.query.toLowerCase() || ''));
  const activeIndex = Math.min(active, Math.max(0, options.length - 1));
  const close = () => {
    if (trigger) dismissed.current = `${trigger.from}:${trigger.query}`;
    setTrigger(null); setLink(null); setError('');
  };
  useEffect(() => {
    if (!editor) return;
    const sync = () => {
      const { $from, empty } = editor.state.selection;
      const text = $from.parent.textBetween(0, $from.parentOffset, '', '\ufffc');
      const match = empty && $from.parent.type.name === 'paragraph' && text.match(/^\/([\w -]*)$/);
      if (!editor.isEditable || !editor.isFocused || !match || $from.parentOffset !== $from.parent.content.size) {
        setTrigger(null); dismissed.current = ''; return;
      }
      const from = $from.start();
      if (dismissed.current === `${from}:${match[1]}`) return;
      const rect = editor.view.coordsAtPos($from.pos);
      const pane = editor.view.dom.closest('.ws-document')!.getBoundingClientRect();
      setTrigger({ from, to: $from.pos, query: match[1],
          left: Math.max(pane.left + 8, Math.min(rect.left, pane.right - 300)),
          top: Math.max(pane.top + 50, Math.min(rect.bottom + 6, window.innerHeight - 330)) });
    };
    const blur = () => setTrigger(null);
    editor.on('transaction', sync); editor.on('focus', sync); editor.on('blur', blur);
    const scroll = editor.view.dom.closest('.ws-document-scroll');
    scroll?.addEventListener('scroll', sync); window.addEventListener('resize', sync);
    return () => { editor.off('transaction', sync); editor.off('focus', sync); editor.off('blur', blur);
      scroll?.removeEventListener('scroll', sync); window.removeEventListener('resize', sync); };
  }, [editor]);
  useEffect(() => setActive(0), [trigger?.query]);
  useEffect(() => {
    if (trigger) document.getElementById(`${id}-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, trigger?.query, id]);
  const openLink = (from: number, to: number, text: string) => {
    if (!editor) return;
    if (trigger) dismissed.current = `${trigger.from}:${trigger.query}`;
    setLink({ from, to, text, href: '', doc: editor.state.doc });
    setTrigger(null); setError('');
  };
  const choose = (command: typeof commands[number]) => {
    if (!editor?.isEditable || !trigger) return;
    if (command.id === 'link') { openLink(trigger.from, trigger.to, ''); return; }
    const chain = editor.chain().focus().deleteRange({ from: trigger.from, to: trigger.to });
    if (command.id === 'table') chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    if (command.id === 'bullet') chain.toggleBulletList().run();
    if (command.id === 'ordered') chain.toggleOrderedList().run();
    if (command.id === 'task') chain.toggleTaskList().run();
    if (command.id === 'quote') chain.toggleBlockquote().run();
    if (command.id === 'code') chain.toggleCodeBlock().run();
    if (command.id === 'divider') chain.setHorizontalRule().run();
    setTrigger(null);
  };
  useEffect(() => {
    if (!editor) return;
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (link) {
        if (event.key === 'Escape') { event.preventDefault(); close(); editor.commands.focus(); }
        return;
      }
      if (!editor.isFocused || !editor.isEditable) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        if (editor.isActive('codeBlock') || editor.isActive('documentLinkSource')) return;
        event.preventDefault();
        const { from, to } = editor.state.selection;
        openLink(from, to, editor.state.doc.textBetween(from, to, ' ')); return;
      }
      if (!trigger) return;
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); setActive(options.length ? (activeIndex + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length : 0);
      }
      if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
        event.preventDefault(); if (options.length) choose(options[activeIndex]);
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  });
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    if (trigger) {
      dom.setAttribute('aria-controls', id);
      if (options.length) dom.setAttribute('aria-activedescendant', `${id}-${activeIndex}`);
      else dom.removeAttribute('aria-activedescendant');
    }
    return () => { dom.removeAttribute('aria-controls'); dom.removeAttribute('aria-activedescendant'); };
  }, [editor, trigger, activeIndex, options.length, id]);
  if (!editor) return null;
  if (link) return <form className="ws-document-insert ws-document-link-form" role="dialog" aria-label="Insert link"
    onSubmit={event => {
      event.preventDefault();
      if (!editor.isEditable || !editor.state.doc.eq(link.doc)) { setError('The document changed. Cancel and select the text again.'); return; }
      const href = link.href.trim();
      if (!href || /[\s<>]/.test(href) || (/^[a-z][a-z\d+.-]*:/i.test(href) && !/^(https?:|mailto:)/i.test(href))) {
        setError('Enter a web address, email link, or relative file path.'); return;
      }
      editor.chain().focus().insertContentAt({ from: link.from, to: link.to }, {
        type: 'text', text: link.text.trim() || href, marks: [{ type: 'link', attrs: { href } }],
      }).run();
      close();
    }}>
    <strong>Insert link</strong>
    <label>Text<input autoFocus value={link.text} onChange={event => setLink({ ...link, text: event.target.value })} /></label>
    <label>Destination<input placeholder="https://… or notes.md" value={link.href} onChange={event => setLink({ ...link, href: event.target.value })} /></label>
    {error && <p role="alert">{error}</p>}
    <div><Button type="button" variant="ghost" onClick={() => { close(); editor.commands.focus(); }}>Cancel</Button><Button type="submit">Insert link</Button></div>
  </form>;
  if (!trigger) return null;
  return <div className="ws-document-insert ws-document-command-menu" style={{ left: trigger.left, top: trigger.top }}
    id={id} role="listbox" aria-label="Insert formatting">
    <div className="ws-picker-label">INSERT</div>
    {options.map((command, index) => <button type="button" key={command.id} role="option" id={`${id}-${index}`}
      aria-selected={index === activeIndex} onMouseDown={event => event.preventDefault()} onClick={() => choose(command)}>
      <strong>{command.label}</strong><small>{command.detail}</small>
    </button>)}
    {!options.length && <p role="status">No matching formatting. Escape to dismiss.</p>}
  </div>;
}
