import { connectorDecision } from './tool-authorization.js';
import { executeExternalWrite } from './external-write.js';
import type { ToolHandler } from './codex.js';
import type { Store } from './db.js';
import type { Runtime } from './runtime.js';
import type { ConnectorManager } from './connectors.js';

type Dependencies = {
  store: Pick<Store, 'isOpen'>;
  runtime: Pick<Runtime, 'logToolCall' | 'logToolResult' | 'handleInternalTool' | 'contextFor' | 'runSignal'>;
  connectors: Pick<ConnectorManager, 'toolInfo' | 'call'>;
  isShuttingDown: () => boolean;
  approvalForExternal: (detail: string, threadId: string | undefined, options: { title: string; signal: AbortSignal; method: string }) => Promise<boolean>;
};
export function createToolDispatcher({ store, runtime, connectors, isShuttingDown, approvalForExternal }: Dependencies): ToolHandler {
  return async (provider, tool, args, readOnly, codexThreadId) => {
    if (isShuttingDown() || !store.isOpen) throw new Error('App is shutting down');
    runtime.logToolCall(codexThreadId, `${provider}.${tool}`, args);
    try {
      const internal = await runtime.handleInternalTool(provider, tool, args, codexThreadId);
      if (internal !== undefined) {
        runtime.logToolResult(codexThreadId, internal);
        return internal;
      }
      if (provider !== 'slack' && provider !== 'notion' && provider !== 'composio') throw new Error('Unknown tool');
      const info = connectors.toolInfo(provider, tool);
      if (!info) throw new Error('Tool is not available');
      readOnly = info.readOnly;
      const context = runtime.contextFor(codexThreadId);
      const decision = connectorDecision(context?.kind, readOnly);
      if (decision === 'deny') throw new Error('This run cannot use this connector tool');
      const call = () => {
        if (isShuttingDown() || !store.isOpen) throw new Error('App is shutting down');
        return connectors.call(provider, tool, args);
      };
      const result = decision === 'allow' ? await call() : await executeExternalWrite(
        { signal: runtime.runSignal(codexThreadId), isCurrent: () => !!context && runtime.contextFor(codexThreadId) === context },
        signal => approvalForExternal(
          `${provider}: ${tool}\n${JSON.stringify(args, null, 2)}\nGrant: this one write only`,
          context?.threadId,
          { title: `Write to ${provider}`, signal, method: 'external-write' },
        ),
        call,
      );
      runtime.logToolResult(codexThreadId, result);
      return result;
    } catch (error) {
      runtime.logToolResult(codexThreadId, String(error), true);
      throw error;
    }
  };
}
