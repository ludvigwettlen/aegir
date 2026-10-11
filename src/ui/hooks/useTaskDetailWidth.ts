import { useLayoutEffect, useRef, useState } from 'react';

const storageKey = 'aegir:task-detail-width';

export function useTaskDetailWidth() {
  const container = useRef<HTMLDivElement>(null);
  const [preferredWidth, setPreferredWidth] = useState<number | null>(() => {
    try {
      const saved = Number(localStorage.getItem(storageKey));
      return Number.isFinite(saved) && saved >= 340 ? saved : null;
    } catch { return null; }
  });
  const [availableWidth, setAvailableWidth] = useState(0);
  const [defaultWidth, setDefaultWidth] = useState(window.innerWidth <= 1180 ? 380 : 440);
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () => {
      setAvailableWidth(element.clientWidth);
      setDefaultWidth(window.innerWidth <= 1180 ? 380 : 440);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // Reserve room for the task list and the detail pane's one-pixel border.
  const max = Math.max(0, availableWidth - 281);
  const min = Math.min(340, max);
  const clamp = (value: number) => Math.max(min, Math.min(max, value));
  const width = availableWidth ? clamp(preferredWidth ?? defaultWidth) : defaultWidth;
  const resize = (value: number) => {
    const next = Math.round(clamp(value));
    setPreferredWidth(next);
    try { localStorage.setItem(storageKey, String(next)); } catch { /* Resizing still works without storage. */ }
  };
  const reset = () => {
    setPreferredWidth(null);
    try { localStorage.removeItem(storageKey); } catch { /* Resizing still works without storage. */ }
  };
  return { container, width, min, max, resize, reset };
}
