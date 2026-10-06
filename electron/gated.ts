// Locked runs: connector calls the user approved, with Legolas's input.
// Draft cards send through the user's own Slack and Superhuman connections, which live in Claude Code. A locked run
// may load tools with ToolSearch and make exactly the planned calls, once each, in order. Whatever input the model
// writes, the PreToolUse hook replaces it with Legolas's, so the model can't change a word or a recipient.
// Malcolm approved this mechanism on 6 Oct 2026 (auto mode had refused it as a bypass of its own screening).

// One call a locked run may make. `input` is built from the parsed results of the calls before it. `commit` runs right
// before the call is released and refuses it by returning false: the draft card's undo window lives there. `check`
// reads the parsed result: null when it's fine, otherwise why the run stops there.
export type GatedCall = {
  tool: string;
  input: (results: unknown[]) => Record<string, unknown>;
  commit?: () => Promise<boolean> | boolean;
  check?: (result: unknown) => string | null;
};

// `released` counts calls whose input went to the tool. `failedCall` is the call that stopped the run, if any, and
// `toolSaidNo` is true when that call's own answer said it failed (so it took no effect), rather than an error, a
// timeout or no answer at all.
export type GatedOutcome = {
  results: unknown[];
  released: number;
  completed: boolean;
  error?: string;
  failedCall?: number;
  toolSaidNo?: boolean;
};

export type Decision = { allow: true; input?: Record<string, unknown> } | { allow: false; reason: string };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export class CallGate {
  private next = 0;
  private inFlight: Record<string, unknown> | null = null;
  readonly results: unknown[] = [];
  released = 0;
  error?: string;
  failedCall?: number;
  toolSaidNo?: boolean;

  constructor(private calls: GatedCall[], private read: (response: unknown) => unknown = (value) => value) {}

  get done() { return this.error !== undefined || this.next >= this.calls.length; }
  get completed() { return this.error === undefined && this.next >= this.calls.length; }

  outcome(): GatedOutcome {
    return {
      results: this.results, released: this.released, completed: this.completed,
      ...(this.error !== undefined ? { error: this.error, failedCall: this.failedCall, toolSaidNo: !!this.toolSaidNo } : {}),
    };
  }

  // Stops the run. Only the first reason counts.
  stop(error: string, toolSaidNo = false) {
    if (this.error !== undefined) return;
    this.error = error;
    this.failedCall = this.next;
    this.toolSaidNo = toolSaidNo;
  }

  // PreToolUse. The call is marked in flight before any await, so two calls in one turn can't both be released.
  async before(toolName: string): Promise<Decision> {
    if (toolName === 'ToolSearch' && !this.done) return { allow: true };
    if (this.done) return { allow: false, reason: 'Nothing more to do. Reply with the word Done.' };
    if (this.inFlight) return { allow: false, reason: 'Wait for the call that is running.' };
    const call = this.calls[this.next];
    if (toolName !== call.tool) return { allow: false, reason: `Only ${call.tool} may run now.` };
    const input = call.input(this.results);
    this.inFlight = input;
    if (call.commit && !(await call.commit())) {
      this.inFlight = null;
      this.stop('Cancelled before it was sent', true);
      return { allow: false, reason: 'The user cancelled. Stop now.' };
    }
    this.released++;
    return { allow: true, input };
  }

  // PostToolUse. The call must have run with the input Legolas released.
  after(toolName: string, input: unknown, response: unknown) {
    if (!this.inFlight || this.done || toolName !== this.calls[this.next].tool) return;
    const released = this.inFlight;
    this.inFlight = null;
    const result = this.read(response);
    this.results.push(result);
    const ran = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    if (Object.keys(released).some((key) => !same(ran[key], released[key]))) {
      this.stop('The call ran with different input than Legolas released');
      return;
    }
    const problem = this.calls[this.next].check?.(result);
    if (problem) { this.stop(problem, true); return; }
    this.next++;
  }

  // PostToolUseFailure: an error instead of an answer, so whether it took effect is unknown.
  failed(toolName: string, error: string) {
    if (!this.inFlight || this.done || toolName !== this.calls[this.next].tool) return;
    this.inFlight = null;
    this.stop(error || 'The call failed');
  }
}
