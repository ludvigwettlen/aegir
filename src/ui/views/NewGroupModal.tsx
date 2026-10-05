import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import type { Agent } from '../../../shared/types';

export function NewGroupModal({
  agents,
  onClose,
  onCreate,
}: {
  agents: Agent[];
  onClose: () => void;
  onCreate: (title: string, agentIds: string[]) => void;
}) {
  const [title, setTitle] = useState('');
  const [chosen, setChosen] = useState<string[]>(agents.map((agent) => agent.id));
  const ready = title.trim() && chosen.length;
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-group-title"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } }}
      >
        <div className="row-between">
          <h2 id="new-group-title">New group</h2>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <p>A standing set of agents for a project or topic. The first agent you pick leads.</p>
        <label>
          GROUP NAME
          <input
            autoFocus
            placeholder="e.g. research"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && ready && onCreate(title.trim(), chosen)}
          />
        </label>
        <fieldset className="ws-agent-picks">
          <legend>AGENTS</legend>
          {agents.map((agent) => (
            <label key={agent.id}>
              <input
                type="checkbox"
                checked={chosen.includes(agent.id)}
                onChange={(e) =>
                  setChosen(
                    e.target.checked
                      ? [...chosen, agent.id]
                      : chosen.filter((id) => id !== agent.id),
                  )
                }
              />
              {agent.name}
              <small>{agent.role}</small>
            </label>
          ))}
        </fieldset>
        <button
          className="primary-button full"
          disabled={!ready}
          onClick={() => onCreate(title.trim(), chosen)}
        >
          Create group <Plus size={15} />
        </button>
      </div>
    </div>
  );
}
