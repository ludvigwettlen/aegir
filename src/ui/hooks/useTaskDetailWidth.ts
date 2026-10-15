import { usePaneWidth } from './usePaneWidth';

export function useTaskDetailWidth() {
  return usePaneWidth('aegir:task-detail-width', () => window.innerWidth <= 1180 ? 380 : 440, 25);
}
