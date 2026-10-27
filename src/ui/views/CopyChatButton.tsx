import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '../design-system/primitives';
import { api } from './common';

export function CopyChatButton({ threadId, disabled, iconOnly = false }: { threadId: string; disabled: boolean; iconOnly?: boolean }) {
  const [status, setStatus] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = useRef(false);
  const pending = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; if (timer.current) clearTimeout(timer.current); };
  }, []);
  const copy = async () => {
    if (pending.current) return;
    pending.current = true;
    if (timer.current) clearTimeout(timer.current);
    setStatus('copying');
    try {
      await api.copyChatTranscript(threadId);
      if (active.current) {
        setStatus('copied');
        timer.current = setTimeout(() => setStatus('idle'), 2500);
      }
    } catch {
      if (active.current) setStatus('failed');
    } finally { pending.current = false; }
  };
  const label = status === 'copying' ? 'Copying…' : status === 'copied' ? 'Copied' : status === 'failed' ? 'Retry copy' : 'Copy chat';
  return <div className="ws-copy-chat">
    <Button size="sm" icon={iconOnly} variant="ghost" aria-label="Copy chat transcript" title={status === 'failed' ? 'Could not copy chat. Click to retry.' : `${label} · Copy the full conversation as Markdown`} disabled={disabled || status === 'copying'} onClick={() => void copy()}>
      {status === 'copied' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}{!iconOnly && label}
    </Button>
    <span className="ws-copy-announcement" role="status">{status === 'copied' ? 'Chat transcript copied.' : status === 'failed' ? 'Could not copy chat. Try again.' : ''}</span>
  </div>;
}
