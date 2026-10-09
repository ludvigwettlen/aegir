import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '../design-system/primitives';

export function CopyMessageButton({ content }: { content: string }) {
  const [status, setStatus] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = useRef(false);
  const pending = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; if (timer.current) clearTimeout(timer.current); };
  }, []);
  const copy = async () => {
    if (pending.current || !content.trim()) return;
    pending.current = true;
    if (timer.current) clearTimeout(timer.current);
    setStatus('copying');
    try {
      await navigator.clipboard.writeText(content);
      if (active.current) {
        setStatus('copied');
        timer.current = setTimeout(() => setStatus('idle'), 2500);
      }
    } catch {
      if (active.current) setStatus('failed');
    } finally { pending.current = false; }
  };
  return <div className="ws-copy-message">
    <Button size="sm" icon variant="ghost" aria-label={status === 'failed' ? 'Retry copy message' : 'Copy message'} title={status === 'copying' ? 'Copying…' : status === 'copied' ? 'Message copied' : status === 'failed' ? 'Could not copy message. Click to retry.' : 'Copy message as Markdown'} disabled={!content.trim() || status === 'copying'} onClick={() => void copy()}>
      {status === 'copied' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
    </Button>
    <span className="ws-copy-announcement" role="status">{status === 'copied' ? 'Message copied.' : status === 'failed' ? 'Could not copy message. Try again.' : ''}</span>
  </div>;
}
