import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@usefragments/ui';
import '../styles';
import type { DesktopApi, Task } from '../../../shared/types';
import type { DelegationInput } from '../../../shared/delegation';
const person = { id: 'd0894967-e1ac-4794-9092-322baa213b76', name: 'Malcolm Burenstam Linder', email: 'malcolm@example.com' };
const fixture = { fail: false, delay: 0, calls: [] as unknown[] };
Object.assign(window, { fixture });
let setTask: (task: Task) => void;
let task = { id: 'sample', title: 'Review launch plan', notes: 'PRIVATE NOTES DO NOT SHARE', dueAt: '2026-10-30', labels: ['work'], status: 'ready' } as Task;
const check = async () => { if (fixture.delay) await new Promise(resolve => setTimeout(resolve, fixture.delay)); if (fixture.fail) throw new Error('Notion is unavailable. Try again.'); };
window.aegir = {
  findDelegationPeople: async () => { await check(); return [person]; },
  delegateTask: async (_id: string, input: DelegationInput) => {
    await check(); fixture.calls.push(input);
    task = { ...task, delegation: { ...input, pageUrl: 'https://www.notion.so/40892fd0e10181f5b48debf3092a539a', dataSourceId: '51d440ed-1827-43ab-8da5-805e699bfdf2', status: 'Assigned', publishing: false, syncedAt: new Date().toISOString(), progress: '', error: null } }; setTask(task);
  },
  syncDelegations: async () => { await check(); },
  setDelegationStatus: async (_id, status) => { await check(); task = { ...task, delegation: { ...task.delegation!, status } }; setTask(task); },
  openExternal: async () => {},
} satisfies Partial<DesktopApi> as unknown as DesktopApi;
const { TaskDelegation } = await import('../views/TaskDelegation');
function App() { const [value, setter] = useState(task); setTask = setter; return <main style={{ padding: 20, maxWidth: 400 }}><TaskDelegation task={value} connected /></main>; }
createRoot(document.getElementById('root')!).render(<ThemeProvider defaultMode="light"><App /></ThemeProvider>);
