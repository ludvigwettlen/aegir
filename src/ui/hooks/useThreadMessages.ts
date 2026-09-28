import { useEffect, useRef, useState } from 'react';
import type { Message } from '../../../shared/types';
import { api, type Run } from '../views/common';

function merge(older: Message[], newer: Message[]) {
  const messages = new Map(older.map((message) => [message.id, message]));
  for (const message of newer) messages.set(message.id, message);
  return [...messages.values()];
}

export function useThreadMessages(threadId: string, run: Run) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [before, setBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const loadingOlder = useRef(false);

  useEffect(() => {
    const version = ++generation.current;
    const updates: Message[] = [];
    let initializing = true;
    setMessages([]);
    setBefore(null);
    setLoading(true);
    loadingOlder.current = false;
    const unsubscribe = api.onEvent((event) => {
      if (event.type !== 'message' || event.value.threadId !== threadId) return;
      if (initializing) updates.push(event.value);
      setMessages((current) => merge(current, [event.value]));
    });
    void run(async () => {
      try {
        const page = await api.threadMessages(threadId);
        if (generation.current !== version) return;
        setMessages(merge(page.messages, updates));
        setBefore(page.before);
      } finally {
        initializing = false;
        if (generation.current === version) setLoading(false);
      }
    });
    return () => {
      generation.current++;
      unsubscribe();
    };
  }, [threadId, run]);

  const loadOlder = () => {
    if (!before || loadingOlder.current) return;
    const version = generation.current;
    loadingOlder.current = true;
    setLoading(true);
    void run(async () => {
      try {
        const page = await api.threadMessages(threadId, before);
        if (generation.current !== version) return;
        setMessages((current) => merge(page.messages, current));
        setBefore(page.before);
      } finally {
        if (generation.current === version) {
          loadingOlder.current = false;
          setLoading(false);
        }
      }
    });
  };
  return { messages, hasOlder: before !== null, loading, loadOlder };
}
