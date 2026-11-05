import { dialog, shell } from 'electron';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { SkillCreate, SkillFile, SkillSettings } from '../shared/skills.js';
import { importAttachment, readAttachment } from './attachments.js';
import { Store } from './db.js';
import { importDocumentImage, readDocumentImage } from './document-images.js';
import { documentLocation, listDocuments, readDocument, saveDocument } from './documents.js';
import { Runtime } from './runtime.js';
import { fileBytes, parseSkill, readPackage } from './skill-package.js';

import type { IpcHandle } from './ipc.js';

export function registerWorkspaceIpc(handle: IpcHandle, dependencies: { store: Store; runtime: Runtime; refresh: () => void; documentRoot: (id: string) => string; attachmentRoot: (id: string) => string }) {
  const { store, runtime, refresh, documentRoot, attachmentRoot } = dependencies;
  handle('document-list', (id: string) => listDocuments(documentRoot(id)));
  handle('document-create', (id: string, name: string) => {
    const taskId = store.get('tasks', id)?.id || store.get('threads', id)?.taskId;
    if (!taskId) throw new Error('Choose a task to create a document');
    return runtime.createTaskDocument(taskId, name);
  });
  handle('document-read', (id: string, path: string) => readDocument(documentRoot(id), path));
  handle('document-image-read', (id: string, path: string, src: string) => readDocumentImage(documentRoot(id), path, src));
  handle('document-image-import', (id: string, path: string, name: string, bytes: Uint8Array) => importDocumentImage(documentRoot(id), path, name, bytes));
  handle('document-show-in-finder', (id: string, path: string) => shell.showItemInFolder(documentLocation(documentRoot(id), path)));
  handle('document-save', (id: string, path: string, expected: string, content: string) => saveDocument(documentRoot(id), path, expected, content));
  handle('skill-library', () => runtime.skills.library());
  handle('skill-detail', (id: string) => runtime.skills.detail(id));
  handle('skill-create', (input: SkillCreate) => runtime.skills.create(input));
  handle('skill-update', (id: string, expected: string, files: SkillFile[], reason: string) => runtime.skills.update(id, expected, files, reason));
  handle('skill-configure', (id: string, settings: SkillSettings) => runtime.skills.configure(id, settings));
  handle('skill-copy', (id: string, owner: string | null) => runtime.skills.copy(id, owner));
  handle('skill-restore', (id: string, expected: string, revision: string) => runtime.skills.restoreRevision(id, expected, revision));
  handle('skill-revision-files', (id: string, revision: string) => runtime.skills.revisionFiles(id, revision));
  handle('skill-resolve', (id: string, apply: boolean) => runtime.skills.resolveProposal(id, apply));
  handle('skill-bind-routine', (id: string, skills: string[]) => runtime.skills.bindRoutine(id, skills));
  handle('skill-import', async (owner: string | null) => {
    const choice = await dialog.showOpenDialog({ title: 'Import a skill folder or SKILL.md', properties: ['openFile', 'openDirectory'] });
    if (choice.canceled || !choice.filePaths[0]) return null;
    const path = choice.filePaths[0]; const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error('Choose the original folder or file, not a symlink');
    if (stat.isFile() && stat.size > 1024 * 1024) throw new Error('Skill file is too large');
    const files: SkillFile[] = stat.isDirectory() ? readPackage(path) : [{ path: 'SKILL.md', encoding: 'utf8', content: readFileSync(path, 'utf8') }];
    parseSkill(files);
    return runtime.skills.create({ ownerAgentId: owner, files }, {}, 'imported', path);
  });
  handle('skill-export', async (id: string) => {
    const { skill, files } = runtime.skills.detail(id); parseSkill(files);
    const choice = await dialog.showOpenDialog({ title: 'Choose a folder for the exported skill', properties: ['openDirectory', 'createDirectory'] });
    if (choice.canceled || !choice.filePaths[0]) return;
    const destination = join(choice.filePaths[0], skill.name);
    if (existsSync(destination)) throw new Error('A folder with this skill name already exists. Choose another destination.');
    mkdirSync(destination);
    for (const file of files) { const path = join(destination, file.path); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, fileBytes(file)); }
  });
  handle('attachment-import', (id: string, name: string, bytes: Uint8Array) => importAttachment(attachmentRoot(id), name, bytes));
  handle('attachment-open', async (id: string, path: string) => {
    const file = readAttachment(attachmentRoot(id), path);
    // Reveal files instead of executing arbitrary attachment types.
    shell.showItemInFolder(file.path);
  });
}
