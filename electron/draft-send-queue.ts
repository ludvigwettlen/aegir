type Draft = { state: string; revision: number; queuedUntil?: number; manuallySentAt?: string; error?: string };
/** Main-process countdown. Restart recovery is owned by the draft services. */
export class DraftSendQueue<T extends Draft> {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  constructor(private read: (id: string) => T, private save: (id: string, draft: T) => void) {}
  get size() { return this.timers.size; }
  queue(id: string, revision: number, deliver: () => Promise<void>) {
    const draft = this.editable(id, revision);
    const queued = { ...draft, state: 'queued', queuedUntil: Date.now() + 5000, error: undefined };
    this.save(id, queued);
    this.timers.set(id, setTimeout(() => {
      this.timers.delete(id);
      let current: T;
      try { current = this.read(id); } catch { return; }
      if (current.state !== 'queued' || current.revision !== revision) return;
      this.save(id, { ...current, state: 'draft', queuedUntil: undefined });
      // Existing delivery services persist failures, including uncertain outcomes.
      void deliver().catch(() => {});
    }, 5000));
    return queued;
  }
  cancel(id: string, revision: number) {
    const draft = this.read(id);
    if (draft.state !== 'queued' || draft.revision !== revision || !this.timers.has(id)) throw new Error('Sending has already started.');
    clearTimeout(this.timers.get(id)); this.timers.delete(id);
    const next = { ...draft, state: 'draft', queuedUntil: undefined };
    this.save(id, next); return next;
  }
  markSentManually(id: string, revision: number) {
    const draft = this.editable(id, revision);
    const next = { ...draft, state: 'sent-manually', manuallySentAt: new Date().toISOString(), error: undefined };
    this.save(id, next); return next;
  }
  private editable(id: string, revision: number) {
    const draft = this.read(id);
    if (draft.state !== 'draft' || draft.revision !== revision || this.timers.has(id)) throw new Error('This draft changed or is locked for sending.');
    return draft;
  }
  stop() {
    for (const [id, timer] of this.timers) {
      clearTimeout(timer);
      let draft: T;
      try { draft = this.read(id); } catch { continue; }
      this.save(id, { ...draft, state: 'draft', queuedUntil: undefined });
    }
    this.timers.clear();
  }
}
