import type { Store } from './db.js';
import type { RemindersState } from '../shared/types.js';
import { parseLedger, syncReminders, RemindersHelper } from './reminders.js';
export class PhoneCapture {
  private busy = false;
  private stopped = false;
  private detail = 'Off';
  private lastSyncAt: string | null = null;
  constructor(private store: Store, private binary: string | null, private refresh: () => void) {}
  get hasActiveWork() { return this.busy; }
  state(): RemindersState { return { enabled: this.store.getSetting('remindersCapture') === 'on', list: this.store.getSetting('remindersList') || 'Reminders', detail: this.detail, syncing: this.busy, lastSyncAt: this.lastSyncAt }; }
  configure(enabled: boolean, list: string) {
    if (typeof enabled !== 'boolean' || typeof list !== 'string' || !list.trim() || list.length > 100) throw new Error('Name a Reminders list (up to 100 characters).');
    if (enabled && !this.binary) throw new Error('Apple Reminders requires macOS and the bundled Reminders helper.');
    if (this.busy) throw new Error('Wait for Reminders capture to finish before changing its settings.');
    this.store.setSetting('remindersList', list.trim()); this.store.setSetting('remindersCapture', enabled ? 'on' : 'off');
    this.detail = enabled ? 'Ready to capture' : 'Off'; this.refresh();
  }
  stop() { this.stopped = true; }
  async sync() {
    if (this.stopped || this.busy || !this.store.isOpen || !this.state().enabled || this.store.getSetting('setupAutomationPaused') === 'true') return;
    if (!this.binary) { this.detail = 'Reminders helper unavailable in this build.'; this.refresh(); return; }
    this.busy = true; this.detail = 'Checking Apple Reminders…'; this.refresh();
    try {
      const ledger = parseLedger(this.store.getSetting('remindersLedger'));
      const result = await syncReminders(this.store, new RemindersHelper(this.binary), this.state().list, ledger, {
        save: () => { if (!this.stopped && this.store.isOpen) this.store.setSetting('remindersLedger', JSON.stringify(ledger)); },
        keepGoing: () => !this.stopped && this.store.isOpen && this.state().enabled,
      });
      this.detail = `${result.imported} imported · ${result.keptForAlert} kept for alerts · ${result.failed} failed`;
      this.lastSyncAt = new Date().toISOString();
    } catch (error) { this.detail = error instanceof Error ? error.message : String(error); }
    finally { this.busy = false; if (!this.stopped && this.store.isOpen) this.refresh(); }
  }
}
