import { useRef, useState } from 'react';
import { Button } from '../design-system/primitives';
import { api } from './common';
export function BrainFileButton({ workspaceId, path, kind, beforeFile, disabled }: {
  workspaceId: string; path: string; kind: 'document' | 'attachment'; beforeFile?: () => Promise<boolean>; disabled?: boolean;
}) {
  const [pending, setPending] = useState(false), [result, setResult] = useState(''), [error, setError] = useState('');
  const busy = useRef(false);
  return <span className="brain-file-action"><Button variant="ghost" size="sm" disabled={disabled || pending} onClick={async () => {
    if (busy.current) return;
    busy.current = true; setPending(true); setError(''); setResult('');
    try {
      if (beforeFile && !await beforeFile()) throw new Error('Save the document before filing.');
      const destination = await api.fileToBrain(workspaceId, path, kind); setResult(`Copied to ${destination}`);
    } catch (cause) { setError(String(cause).replace(/^Error: /, '')); }
    finally { busy.current = false; setPending(false); }
  }}>{pending ? 'Filing…' : 'File to brain'}</Button>
    {result && <span role="status">{result}</span>}{error && <span role="alert">{error}</span>}
  </span>;
}
