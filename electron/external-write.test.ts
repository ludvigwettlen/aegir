import { describe, expect, it, vi } from 'vitest';
import { approveExternalWrite, executeExternalWrite, RunEndedError } from './external-write.js';

// Mirrors main.ts approvalForExternal: a pending approval that the run's abort signal withdraws.
function approvalBar() {
  const pending = new Map<string, (approved: boolean) => void>();
  let n = 0;
  const ask = (signal: AbortSignal) => new Promise<boolean>((resolve) => {
    if (signal.aborted) return resolve(false);
    const id = `a${++n}`;
    const cancel = () => { pending.delete(id); resolve(false); };
    pending.set(id, (approved) => { signal.removeEventListener('abort', cancel); pending.delete(id); resolve(approved); });
    signal.addEventListener('abort', cancel, { once: true });
  });
  // The user's click; a click on an approval that is gone does nothing (like resolve-approval).
  const answer = (id: string, approved: boolean) => pending.get(id)?.(approved);
  return { pending, ask, answer };
}

// A run as Runtime tracks it: current while registered, aborted when stopped or finished.
function run() {
  const abort = new AbortController();
  let current = true;
  return {
    abort,
    end: () => { current = false; abort.abort(); },
    gate: { signal: abort.signal, isCurrent: () => current },
  };
}

async function write(gate: ReturnType<typeof run>['gate'], ask: (signal: AbortSignal) => Promise<boolean>, call: () => void) {
  await executeExternalWrite(gate, ask, async () => call());
}

describe('external write approvals', () => {
  it('writes once the user approves while the run is active', async () => {
    const bar = approvalBar();
    const active = run();
    const call = vi.fn();
    const pending = write(active.gate, bar.ask, call);
    await vi.waitFor(() => expect(bar.pending.size).toBe(1));
    bar.answer('a1', true);
    await pending;
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('withdraws the approval and sends nothing when the run is stopped', async () => {
    const bar = approvalBar();
    const active = run();
    const call = vi.fn();
    const pending = write(active.gate, bar.ask, call);
    await vi.waitFor(() => expect(bar.pending.size).toBe(1));
    active.abort.abort(); // Stop pressed: the signal fires before the run is deregistered.
    const outcome = await pending.then(() => 'sent', (error) => error);
    expect(outcome).toBeInstanceOf(RunEndedError);
    expect(bar.pending.size).toBe(0);
    bar.answer('a1', true); // A late click on the vanished card.
    expect(call).not.toHaveBeenCalled();
  });

  it('expires the approval when the run completes', async () => {
    const bar = approvalBar();
    const active = run();
    const call = vi.fn();
    const pending = write(active.gate, bar.ask, call);
    await vi.waitFor(() => expect(bar.pending.size).toBe(1));
    active.end();
    const outcome = await pending.then(() => 'sent', (error) => error);
    expect(outcome).toBeInstanceOf(RunEndedError);
    expect(bar.pending.size).toBe(0);
    expect(call).not.toHaveBeenCalled();
  });

  it('sends nothing when the approval arrives after the run ended', async () => {
    // An approval surface that ignores the signal, so the late "yes" still resolves: the revalidation must catch it.
    let approve!: (approved: boolean) => void;
    const active = run();
    const call = vi.fn();
    const pending = write(active.gate, () => new Promise((resolve) => { approve = resolve; }), call);
    await vi.waitFor(() => expect(approve).toBeTypeOf('function'));
    active.end();
    approve(true);
    const outcome = await pending.then(() => 'sent', (error) => error);
    expect(outcome).toBeInstanceOf(RunEndedError);
    expect(call).not.toHaveBeenCalled();
  });

  it('sends nothing when the run was replaced while waiting', async () => {
    let approve!: (approved: boolean) => void;
    let current = true;
    const call = vi.fn();
    const pending = write({ signal: new AbortController().signal, isCurrent: () => current }, () => new Promise((resolve) => { approve = resolve; }), call);
    await vi.waitFor(() => expect(approve).toBeTypeOf('function'));
    current = false;
    approve(true);
    await expect(pending).rejects.toBeInstanceOf(RunEndedError);
    expect(call).not.toHaveBeenCalled();
  });

  it('never asks for a run that has already ended or is unknown', async () => {
    const ask = vi.fn(async () => true);
    const ended = run();
    ended.end();
    await expect(approveExternalWrite(ended.gate, ask)).rejects.toBeInstanceOf(RunEndedError);
    await expect(approveExternalWrite({ signal: undefined, isCurrent: () => true }, ask)).rejects.toBeInstanceOf(RunEndedError);
    expect(ask).not.toHaveBeenCalled();
  });

  it('reports a declined write', async () => {
    await expect(approveExternalWrite(run().gate, async () => false)).rejects.toThrow('External write declined');
  });
  it('checks cancellation again at the actual connector dispatch boundary', async () => {
    const active = run();
    const call = vi.fn(async () => {});
    // Completion queued after approval validation but before the dispatch continuation.
    const pending = executeExternalWrite(active.gate, async () => {
      queueMicrotask(() => queueMicrotask(() => active.end()));
      return true;
    }, call);
    await expect(pending).rejects.toBeInstanceOf(RunEndedError);
    expect(call).not.toHaveBeenCalled();
  });

});
