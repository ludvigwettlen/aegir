import { CircleHelp, ExternalLink, MemoryStick, Sparkles, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Memory, Snapshot } from '../../../shared/types';
import { Button, Card } from '../design-system/primitives';
import { api, type Run } from './common';
import { PageHeader } from './PageHeader';
const date = (value: string) =>
  value && !Number.isNaN(Date.parse(value))
    ? new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric' })
    : '';

export function MemoryView({ data, run }: { data: Snapshot; run: Run }) {
  const [instructions, setInstructions] = useState(data.memoryInstructions);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Memory[]>([]);
  const [searched, setSearched] = useState(false);
  useEffect(() => setInstructions(data.memoryInstructions), [data.memoryInstructions]);
  const refreshResults = async () => setResults(await api.searchMemories(query));
  return (
    <div className="page-scroll supporting-page">
      <PageHeader
        eyebrow="WORKSPACE / MEMORY"
        title="Memory"
        description="Search the durable context your agents carry forward."
      />
      {data.legacyMemoryCount > 0 && (
        <Card variant="outline" padding="md" as="section">
          <p>
            {data.legacyMemoryCount} earlier memor
            {data.legacyMemoryCount === 1 ? 'y is' : 'ies are'} waiting to move into Mnemosyne.
            Install or reconnect Mnemosyne, then search again to retry the migration.
          </p>
        </Card>
      )}
      <div className="memory-layout">
        <Card className="content-panel" variant="outline" padding="none" as="section">
          <div className="panel-heading">
            <div>
              <h2>Search memories</h2>
              <p>Results come directly from Mnemosyne’s shared and agent banks.</p>
            </div>
            <MemoryStick size={19} />
          </div>
          <form
            className="form-row"
            onSubmit={(event) => {
              event.preventDefault();
              if (query.trim())
                void run(async () => {
                  await refreshResults();
                  setSearched(true);
                });
            }}
          >
            <input
              aria-label="Search memories"
              placeholder="Search decisions, preferences, or project facts"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Button type="submit" disabled={!query.trim()}>
              Search
            </Button>
          </form>
          {results.length ? (
            <div className="memory-list">
              {results.map((item) => (
                <MemoryRow
                  key={`${item.scope}:${item.id}`}
                  item={item}
                  run={run}
                  onChanged={refreshResults}
                />
              ))}
            </div>
          ) : (
            <div className="panel-empty">
              <span className="empty-icon">
                <MemoryStick size={22} />
              </span>
              <h3>{searched ? 'No matching memories' : 'Search your memories'}</h3>
              <p>
                {searched
                  ? 'Try a different phrase.'
                  : 'Search across shared and agent memories stored in Mnemosyne.'}
              </p>
            </div>
          )}
        </Card>
        <Card className="instruction-card" variant="outline" padding="md" as="section">
          <span className="eyebrow">MEMORY GUIDANCE</span>
          <h3>What should agents keep?</h3>
          <p>
            These instructions guide automatic memory writing. You can refine them as you learn what
            works.
          </p>
          <textarea
            aria-label="Memory instructions"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={10}
          />
          <Button
            fullWidth
            disabled={instructions === data.memoryInstructions}
            onClick={() => void run(() => api.setMemoryInstructions(instructions))}
          >
            Save instructions
          </Button>
          <div className="subtle-note">
            <CircleHelp size={14} /> Memories are stored in Mnemosyne. If it is unavailable, memory
            operations report an error.
          </div>
        </Card>
      </div>
    </div>
  );
}

function MemoryRow({
  item,
  run,
  onChanged,
}: {
  item: Memory;
  run: Run;
  onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(item.content);
  return (
    <div className="memory-row">
      <span className="memory-orb">
        <Sparkles size={15} />
      </span>
      <div>
        {editing ? (
          <div className="inline-editor">
            <textarea
              aria-label="Correct memory"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={3}
            />
            <Button
              size="sm"
              disabled={!content.trim()}
              onClick={() =>
                void run(async () => {
                  await api.correctMemory(item.id, item.scope, content);
                  await onChanged();
                  setEditing(false);
                })
              }
            >
              Save correction
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <p>{item.content}</p>
        )}
        <small>
          {item.scope}
          {date(item.createdAt) && ` · ${date(item.createdAt)}`}{' '}
          {item.sourceUrl && (
            <button onClick={() => void run(() => api.openExternal(item.sourceUrl!))}>
              Source <ExternalLink size={11} />
            </button>
          )}
        </small>
      </div>
      <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
        Correct
      </Button>
      <Button
        variant="ghost"
        size="sm"
        icon
        aria-label="Forget memory"
        onClick={() =>
          void run(async () => {
            await api.forgetMemory(item.id, item.scope);
            await onChanged();
          })
        }
      >
        <X size={15} />
      </Button>
    </div>
  );
}
