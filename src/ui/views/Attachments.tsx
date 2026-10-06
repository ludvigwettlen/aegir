import { File as FileIcon, FileCode, FileImage, FileSpreadsheet, FileText, Notebook, X } from 'lucide-react';
import type { StagedAttachment, TaskFile } from '../../../shared/types';
import { fileExtension, fileSize, type FileKind } from '../../../shared/task-files';
import { api, type Run } from './common';

// One icon per kind, so a chip says what the agent will do with the file before you read its name.
export function KindIcon({ kind, name, size = 12 }: { kind: FileKind; name: string; size?: number }) {
  const Icon = kind === 'image' ? FileImage
    : kind === 'office' ? (fileExtension(name) === 'xlsx' ? FileSpreadsheet : FileText)
    : kind === 'notebook' ? Notebook
    : kind === 'text' ? (/\.(md|markdown|txt|csv|tsv|log)$/i.test(name) ? FileText : FileCode)
    : kind === 'pdf' ? FileText
    : FileIcon;
  return <Icon size={size} aria-hidden="true" />;
}

export type Chip = StagedAttachment & { key: string };

/** What goes out with the next message. A refused file keeps its place and says why. */
export function ComposerAttachments({ chips, onRemove }: { chips: Chip[]; onRemove: (chip: Chip) => void }) {
  return (
    <div className="ws-attachments" aria-label="Attached files">
      {chips.map(chip => (
        <span key={chip.key} className={chip.error ? 'error' : undefined}>
          {chip.file ? <KindIcon kind={chip.file.kind} name={chip.file.name} /> : <FileIcon size={12} aria-hidden="true" />}
          <span className="ws-attachment-name" title={chip.name}>{chip.name}</span>
          <small>{chip.error || fileSize(chip.file!.bytes)}</small>
          <button type="button" className="ws-icon-btn" aria-label={`Remove ${chip.name}`} onClick={() => onRemove(chip)}>
            <X size={12} />
          </button>
        </span>
      ))}
    </div>
  );
}

/** The files a sent message carried. Click opens the file; ⌥click shows it in Finder. */
export function MessageAttachments({ files, run }: { files: TaskFile[]; run: Run }) {
  return (
    <div className="ws-attachments sent" aria-label="Files with this message">
      {files.map(file => (
        <button
          key={file.id}
          type="button"
          title={file.brainPath ? `Filed in the brain: ${file.brainPath}` : `${file.name} · click to open, ⌥click to show in Finder`}
          onClick={event => void run(() => (event.altKey ? api.revealTaskFile(file.id) : api.openTaskFile(file.id)))}
          onContextMenu={event => { event.preventDefault(); void run(() => api.revealTaskFile(file.id)); }}
        >
          <KindIcon kind={file.kind} name={file.name} />
          <span className="ws-attachment-name">{file.name}</span>
          <small>{fileSize(file.bytes)}</small>
        </button>
      ))}
    </div>
  );
}
