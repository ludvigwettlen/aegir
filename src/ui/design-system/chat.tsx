import type { ReactNode } from 'react';
import { ConversationList, Prompt } from '@usefragments/ui';
import { ArrowDownRight, Send } from 'lucide-react';

type ChatBubbleProps = {
  variant: 'agent' | 'user';
  author: string;
  role?: string;
  timestamp: string;
  status?: 'streaming' | 'failed' | 'complete';
  avatar?: ReactNode;
  children: ReactNode;
};

export function ChatConversation({ roomId, emptyState, children }: { roomId: string; emptyState: ReactNode; children: ReactNode }) {
  return <ConversationList key={roomId} className="chat-scroll" autoScroll="smart" emptyState={emptyState}>
    {children}
  </ConversationList>;
}

export function ChatBubble({ variant, author, role, timestamp, status, avatar, children }: ChatBubbleProps) {
  return <article className={`chat-bubble-row chat-bubble-row--${variant}`} aria-label={`${author}, ${timestamp}`}>
    {variant === 'agent' && <div className="chat-bubble-avatar">{avatar}</div>}
    <div className="chat-bubble-stack">
      {variant === 'agent' && <div className="chat-bubble-heading"><strong>{author}</strong>{role && <span>{role}</span>}</div>}
      <div className={`chat-bubble chat-bubble--${variant}`}>{children}</div>
      <div className="chat-bubble-foot"><time>{timestamp}</time>{status === 'streaming' && <span className="chat-bubble-status">Working</span>}{status === 'failed' && <span className="chat-bubble-status chat-bubble-status--failed">Failed</span>}</div>
    </div>
  </article>;
}

export function ChatEvent({ children }: { children: ReactNode }) {
  return <div className="chat-event"><ArrowDownRight size={14} aria-hidden="true"/><span>{children}</span></div>;
}

type ChatComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onStop: () => void;
  leadName: string;
  busy: boolean;
};

export function ChatComposer({ value, onChange, onSubmit, onStop, leadName, busy }: ChatComposerProps) {
  return <div className="composer-wrap">
    <Prompt className="composer" value={value} onChange={onChange} onSubmit={onSubmit} submitOnEnter minRows={2} maxRows={6} autoResize loading={busy} variant="ghost" placeholder={`Message ${leadName}…`}>
      <Prompt.Textarea aria-label="Message agents"/>
      <Prompt.Toolbar>
        <Prompt.Actions><span className="composer-help">@mention an agent · /goal to delegate</span></Prompt.Actions>
        <Prompt.Info>{busy && <button className="text-button" onClick={onStop}>Stop run</button>}<Prompt.Submit aria-label="Send message"><Send size={16}/></Prompt.Submit></Prompt.Info>
      </Prompt.Toolbar>
    </Prompt>
    <p className="composer-note">Agents can make mistakes. Source links and approvals stay visible.</p>
  </div>;
}
