import { useRef, useState } from 'react';
import { defaultTypography, fontChoices, type FontId, type Typography } from '../../../shared/typography';
import { Button, Card } from '../design-system/primitives';
import { api } from './common';

export function TypographySettings({ value = defaultTypography }: { value?: Typography }) {
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const save = async (next: Typography) => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true); setError(''); setMessage('');
    try {
      await api.setTypography(next);
      setMessage('Fonts saved');
    } catch (cause) {
      setError(String(cause).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, ''));
    } finally { saving.current = false; setBusy(false); }
  };
  return <Card className="content-panel settings-panel typography-settings" variant="outline" padding="none" as="section">
    <div className="panel-heading">
      <div><h2>Fonts</h2><p>Choose a font for the app and another for Markdown documents.</p></div>
      <Button variant="outline" size="sm" disabled={busy || (value.system === defaultTypography.system && value.editor === defaultTypography.editor)}
        onClick={() => void save(defaultTypography)}>Reset to default</Button>
    </div>
    <div className="typography-body">
      <div className="typography-controls">
        {(['system', 'editor'] as const).map(role => <label key={role} className="ws-field">
          <span>{role === 'system' ? 'System font' : 'Markdown editor font'}</span>
          <select aria-label={role === 'system' ? 'System font' : 'Markdown editor font'} value={value[role]} disabled={busy}
            onChange={event => void save({ ...value, [role]: event.target.value as FontId })}>
            {fontChoices.map(font => <option key={font.id} value={font.id}>{font.name}</option>)}
          </select>
        </label>)}
      </div>
      <div className="typography-preview" aria-label="System font preview">
        <h3>Make room for your next idea</h3>
        <p>Review the launch plan, capture a quick thought, or hand a task to the team.</p>
        <div><span className="ws-status review">Ready for review</span><span>Today · 14:30</span></div>
      </div>
      <div className="typography-preview" aria-label="Markdown editor font preview">
        <div className="ws-document-prose">
          <h3>A little space to think</h3>
          <p>Shape an idea into a plan. <strong>Keep what matters</strong>, <em>explore the details</em>, and make the next step clear.</p>
          <p>Inline code stays distinct: <code>project.status</code></p>
        </div>
      </div>
      <p className="typography-note">Changes apply immediately and are saved automatically. All fonts work offline. Code and logs keep their monospace font.</p>
      {error && <p className="ws-field-error" role="alert">{error}</p>}
      <span className="typography-feedback" role="status">{busy ? 'Saving…' : message}</span>
    </div>
  </Card>;
}
