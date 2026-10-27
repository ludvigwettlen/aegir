import { useEffect, useState } from 'react';
import { defaultBrainBridgeConfig, type BrainBridgeConfig, type BrainBridgeState } from '../../../shared/brain-bridge';
import { Button, Card } from '../design-system/primitives';
import { api } from './common';

export function BrainBridgeSettings({ state }: { state?: BrainBridgeState }) {
  const [config, setConfig] = useState<BrainBridgeConfig>(state || defaultBrainBridgeConfig());
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [result, setResult] = useState('');
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (!dirty && state) setConfig(state); }, [state, dirty]);
  const edit = (change: Partial<BrainBridgeConfig>) => { setConfig(value => ({ ...value, ...change })); setDirty(true); setResult(''); };
  const act = async (action: () => Promise<void>) => {
    if (pending) return;
    setPending(true); setError(''); setResult('');
    try { await action(); } catch (cause) { setError(String(cause).replace(/^Error: /, '')); } finally { setPending(false); }
  };
  const external = !!state?.externalSetup;
  return <Card className="content-panel settings-panel brain-bridge-settings" variant="outline" padding="none" as="section">
    <div className="panel-heading"><div><h2>External workflow and brain filing</h2><p>{external ? 'Connect your external Claude routines to Aegir. Import and export run once per minute while setup is complete and the app is open.' : 'Task discovery stays inside Aegir. External task import/export becomes available in the Legolas setup.'}</p></div></div>
    <div className="brain-bridge-body">
      {(['import', 'export', 'filing'] as const).map(purpose => {
        const enabledKey = `${purpose}Enabled` as const, dirKey = `${purpose}Dir` as const;
        const available = purpose === 'filing' || external;
        return <fieldset key={purpose} disabled={pending || !available}>
          <legend>{({ import: 'Task import', export: 'Task export', filing: 'File to brain' })[purpose]}</legend>
          <label className="brain-bridge-toggle"><input type="checkbox" checked={config[enabledKey]} onChange={event => edit({ [enabledKey]: event.target.checked })} />{({ import: 'Import external task suggestions', export: 'Export task status and notes', filing: 'Enable per-file brain copies' })[purpose]}</label>
          <div className="brain-bridge-folder"><label>{({ import: 'Intake folder', export: 'Export folder', filing: 'Brain filing folder' })[purpose]}<input value={config[dirKey]} onChange={event => edit({ [dirKey]: event.target.value })} placeholder="Choose an existing folder" /></label>
            <Button variant="outline" size="sm" onClick={() => void act(async () => { const path = await api.chooseBridgeFolder(purpose); if (path) edit({ [dirKey]: path }); })}>Choose {purpose === 'filing' ? 'brain filing' : purpose} folder</Button></div>
          <p>{({ import: 'JSON or Markdown suggestions appear in Needs you. Stable source keys prevent repeated imports, including completed, dismissed and deleted imports. Existing task edits and priorities are preserved.', export: 'Writes aegir-tasks.json and aegir-tasks.md, including task status, notes, priorities and source links. Exported files are replaced on each change.', filing: 'Available with either AI setup. Use File to brain on a document or attachment to copy that file into this folder. Linked files and images remain in the task workspace. No automatic filing, indexing or commits.' })[purpose]}</p>
        </fieldset>;
      })}
      <p>Keep the intake folder separate from export and filing destinations. Folder selection alone does not enable an integration.</p>
      <div className="brain-bridge-actions"><Button size="sm" disabled={pending || !dirty} onClick={() => void act(async () => {
        const saved = await api.configureBrainBridge(config); setConfig(saved); setDirty(false); setResult('Workflow settings saved.');
      })}>{pending ? 'Working…' : 'Save workflow settings'}</Button>
        {external && <Button variant="outline" size="sm" disabled={pending || dirty || state?.paused || (!config.importEnabled && !config.exportEnabled)} onClick={() => void act(async () => { await api.runBrainBridge(); setResult('Workflow check finished.'); })}>Check now</Button>}</div>
      {state?.paused && external && <p role="status">Automatic import/export stays paused until setup is complete.</p>}
      {state?.report && <p role="status">Last check: {state.report.created} imported · {state.report.skipped} duplicates skipped · {state.report.rejected} rejected · {state.report.deferred} deferred{state.report.exported ? ' · export updated' : ''}.</p>}
      {state?.lastRunAt && <p>Last checked {new Date(state.lastRunAt).toLocaleString()}</p>}
      {result && <p role="status">{result}</p>}
      {(error || state?.error) && <p role="alert">{error || state?.error}</p>}
    </div>
  </Card>;
}
