import { useLayoutEffect, useRef, useState } from 'react';

// Visible width can shrink below the content width; the pane clips instead of reflowing.
export function usePaneWidth(storageKey: string, defaultWidth: (available: number) => number, reservedWidth = 24) {
  const container = useRef<HTMLDivElement>(null);
  const [preferredWidth, setPreferredWidth] = useState<number | null>(() => {
    try {
      const saved = Number(localStorage.getItem(storageKey));
      return Number.isFinite(saved) && saved >= 24 ? saved : null;
    } catch { return null; }
  });
  const [availableWidth, setAvailableWidth] = useState(0);
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () => setAvailableWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const max = Math.max(0, availableWidth - reservedWidth);
  const min = Math.min(24, max);
  const clamp = (value: number) => Math.max(min, Math.min(max, value));
  const width = availableWidth ? clamp(preferredWidth ?? defaultWidth(availableWidth)) : defaultWidth(window.innerWidth);
  const resize = (value: number) => {
    const next = Math.round(clamp(value));
    setPreferredWidth(next);
    try { localStorage.setItem(storageKey, String(next)); } catch { /* Layout preferences are optional. */ }
  };
  const reset = () => {
    setPreferredWidth(null);
    try { localStorage.removeItem(storageKey); } catch { /* Layout preferences are optional. */ }
  };
  return { container, width, min, max, availableWidth, resize, reset };
}
