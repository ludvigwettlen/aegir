import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { reviewComments, type ListedComment } from '../document-review';
import { reviewBatchMessage } from '../../../shared/review';
import { Button } from '../design-system/primitives';

export function DocumentReview({ editor, path, storageKey, save, send, busy }: {
  editor: Editor | null; path: string; storageKey: string; save: () => Promise<boolean>;
  send: (text: string) => Promise<void>; busy: boolean;
}) {
  const [comments, setComments] = useState<ListedComment[]>([]);
  const [submitted, setSubmitted] = useState<string[]>(() => {
    try { const value = JSON.parse(localStorage.getItem(storageKey) || '[]'); return Array.isArray(value) ? value.filter(x => typeof x === 'string') : []; } catch { return []; }
  });
  const [sending, setSending] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  const signature = (comment: ListedComment) => JSON.stringify([comment.id, comment.text]);
  const pending = comments.filter(comment => !submitted.includes(signature(comment)));
  useEffect(() => {
    if (!editor) return;
    const refresh = () => setComments(reviewComments(editor.state.doc));
    refresh(); editor.on('transaction', refresh);
    return () => { editor.off('transaction', refresh); };
  }, [editor]);
  const submit = async () => {
    if (lock.current || busy || !pending.length) return;
    lock.current = true; setSending(true); setError('');
    const batch = pending;
    try {
      if (!await save()) throw new Error('Save the document before sending comments. Your comments are still here.');
      await send(reviewBatchMessage(path, batch));
      setSubmitted(previous => {
        const next = [...new Set([...previous, ...batch.map(signature)])];
        try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Conversation retains the submitted batch. */ }
        return next;
      });
    } catch (cause) { setError(String(cause).replace(/^Error: /, '')); }
    finally { lock.current = false; setSending(false); }
  };
  const submitRef = useRef(submit); submitRef.current = submit;
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key === 'Enter' && !event.isComposing && !document.querySelector('[role="dialog"]')) {
        event.preventDefault(); void submitRef.current();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  return <section className="ws-review-comments" aria-label="Passage comments">
    <Button variant="outline" size="sm" disabled={busy || sending || !pending.length} onClick={() => void submit()}>{sending ? 'Sending comments…' : `Send ${pending.length} comment${pending.length === 1 ? '' : 's'}`}</Button>
    {error && <p role="alert">{error}</p>}
    {!comments.length && <p>Select text in the document and choose Comment, or press ⇧⌘M.</p>}
    <ol>{comments.map(comment => <li key={comment.id}>
      <button className="ws-review-passage" onClick={() => editor?.chain().setTextSelection({ from: comment.from, to: comment.to }).focus().scrollIntoView().run()}>{comment.passage}</button>
      <p>{comment.text}</p>
      {submitted.includes(signature(comment)) && <small>Submitted · saved in conversation</small>}
    </li>)}</ol>
  </section>;
}
