import { useEffect, useRef, type ComponentType } from 'react';
import type { LucideProps } from 'lucide-react';

export type CommandIcon = ComponentType<LucideProps>;
export type CommandSection = 'task' | 'go' | 'create' | 'routines' | 'app';
export type CommandOption = { id: string; title: string; subtitle?: string; icon?: CommandIcon; current?: boolean; run: () => void };
// A second step in the same box, like Godspeed's "Move task to list": the field then searches these options.
// standalone: the step is not about the selected task (Find a task), so the palette leaves out the "Task: …" line.
// more: rows that take a moment (a search in the app's database), added below options once they arrive. pending says
// what the box shows while the first of them is on its way and options found nothing.
export type CommandStep = {
  title: string; placeholder: string; empty: string; options: (query: string) => CommandOption[]; standalone?: boolean;
  more?: (query: string) => Promise<CommandOption[]>; pending?: string;
};
export type Command = {
  id: string;
  title: string;
  section: CommandSection;
  icon?: CommandIcon;
  // Shown as keycaps, space separated ('⇧ D', '⌘ L', 'G then T'). It must match what the key handlers do.
  keys?: string;
  subtitle?: string;
  keywords?: readonly string[];
  // Left out of the empty list to keep it short; still found by search.
  searchOnly?: boolean;
  run?: () => void;
  step?: CommandStep;
};
// `context` names what the commands act on, e.g. the selected task. `forQuery` adds rows built from
// what was typed, like "Set due date to Fri 9 Oct" for "fri"; they go above the ranked results.
export type CommandSet = { context?: string; commands: Command[]; forQuery?: (query: string) => Command[] };

const sources = new Map<string, { current: () => CommandSet }>();
let opener: ((commandId?: string) => void) | null = null;

// The palette registers itself here. Keys like ⌘L open it straight at one command's second step.
export function setCommandPaletteOpener(open: typeof opener) {
  opener = open;
}
export function openCommandPalette(commandId?: string) {
  opener?.(commandId);
}

// A view hands the palette a function that returns its commands for the current state.
// The newest function is kept on every render, so the palette never runs a stale one.
export function useCommands(id: string, read: () => CommandSet) {
  const latest = useRef(read);
  latest.current = read;
  useEffect(() => {
    sources.set(id, latest);
    return () => {
      sources.delete(id);
    };
  }, [id]);
}

export function registeredCommands(): CommandSet[] {
  return [...sources.values()].map((source) => source.current());
}
