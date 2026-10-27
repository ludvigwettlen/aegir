// Gate for a connector write (Slack, Notion, Composio) that needs the user's approval.
// The approval is bound to the run that asked for it: stopping or finishing the run withdraws it,
// and the run is checked again right before the write, so a late "Approve" never sends anything.
export class RunEndedError extends Error {
  constructor() { super('The run that asked for this write has ended, so nothing was sent'); }
}

export async function approveExternalWrite(
  run: { signal: AbortSignal | undefined; isCurrent: () => boolean },
  ask: (signal: AbortSignal) => Promise<boolean>,
): Promise<void> {
  const { signal } = run;
  if (!signal || signal.aborted || !run.isCurrent()) throw new RunEndedError();
  const approved = await ask(signal);
  // Revalidate after the wait: the caller must call the connector without awaiting anything else first.
  if (signal.aborted || !run.isCurrent()) throw new RunEndedError();
  if (!approved) throw new Error('External write declined');
}

// Keep the final check and connector dispatch in the same synchronous continuation.
export async function executeExternalWrite<T>(
  run: { signal: AbortSignal | undefined; isCurrent: () => boolean },
  ask: (signal: AbortSignal) => Promise<boolean>,
  call: () => Promise<T>,
): Promise<T> {
  await approveExternalWrite(run, ask);
  if (run.signal?.aborted || !run.isCurrent()) throw new RunEndedError();
  return call();
}
