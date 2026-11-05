import { join } from 'node:path';
import type { OneOnOneMeeting } from '../shared/one-on-ones.js';
import { BrainBridge } from './brain-bridge.js';
import { ClaudeDrafts } from './claude-drafts.js';
import type { ModelProvider } from './codex.js';
import type { Store } from './db.js';
import { GmailService } from './gmail.js';
import { OneOnOnes } from './one-on-ones.js';
import { SkillRegistry } from './skills.js';
import { SlackMessages } from './slack-messages.js';

// Structural service ports exclude private implementation state and database handles.
type Public<T> = Pick<T, keyof T>;
export type RuntimeServices = {
  skills: Public<SkillRegistry>; gmail: Public<GmailService>; oneOnOnes: Public<OneOnOnes>;
  brainBridge: Public<BrainBridge>; claudeDrafts: Public<ClaudeDrafts>; slackMessages: Public<SlackMessages>;
};
export type RuntimeHooks = {
  reviewEmailReplies: ConstructorParameters<typeof GmailService>[1];
  prepareOneOnOne: (meeting: OneOnOneMeeting) => Promise<string>;
  isThreadRunning: (id: string) => boolean;
};
export type RuntimeServicesFactory = (hooks: RuntimeHooks) => RuntimeServices;

/** Composition belongs here; Runtime consumes services without constructing concrete adapters. */
export function createRuntimeServices(store: Store, engine: ModelProvider, refresh: () => void, root: string): RuntimeServicesFactory {
  return hooks => ({
    brainBridge: new BrainBridge(store, refresh),
    claudeDrafts: new ClaudeDrafts(store, engine, refresh),
    slackMessages: new SlackMessages(store, refresh),
    gmail: new GmailService(store, hooks.reviewEmailReplies, refresh),
    oneOnOnes: new OneOnOnes(store, hooks.prepareOneOnOne, refresh, undefined, hooks.isThreadRunning),
    skills: new SkillRegistry(store.db, join(root, 'skills'), id => !!store.get('agents', id), id => store.routine(id)?.agentId),
  });
}
