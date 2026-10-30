import { Table, TableView } from '@tiptap/extension-table';
import { closeHistory } from '@tiptap/pm/history';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { addColumnAfter, addRowAfter, CellSelection, moveTableColumn, moveTableRow, TableMap } from '@tiptap/pm/tables';
import { headerlessTableStart, tableHeaderOffMarker } from '../../shared/documents';

export const DocumentTable = Table.extend({
  parseMarkdown(token, helpers) {
    const table = this.parent!(token, helpers);
    if (token.headerOff && !Array.isArray(table)) {
      for (const cell of table.content?.[0]?.content || []) cell.type = 'tableCell';
    }
    return table;
  },
  renderMarkdown(node, helpers, context) {
    const headerOff = node.content?.[0]?.content?.every(cell => cell.type === 'tableCell');
    const normalized = headerOff ? { ...node, content: node.content?.map((row, index) => index ? row : {
      ...row, content: row.content?.map(cell => ({ ...cell, type: 'tableHeader' })),
    }) } : node;
    const source = this.parent!(normalized, helpers, context);
    return headerOff ? `${tableHeaderOffMarker}\n${source.trimStart()}` : source;
  },
  markdownTokenizer: {
    name: 'table', level: 'block',
    start(src) {
      const marker = src.indexOf(tableHeaderOffMarker);
      const start = Table.config.markdownTokenizer!.start;
      const regular = typeof start === 'function' ? start(src) : -1;
      return marker < 0 ? regular : regular < 0 ? marker : Math.min(marker, regular);
    },
    tokenize(src, tokens, helpers) {
      const prefix = src.match(headerlessTableStart)?.[0];
      if (!prefix) return Table.config.markdownTokenizer!.tokenize(src, tokens, helpers);
      const rest = src.slice(prefix.length);
      const end = rest.indexOf('\n\n');
      const table = helpers.blockTokens(end < 0 ? rest : rest.slice(0, end))[0];
      if (table?.type !== 'table') return undefined;
      return { ...table, raw: prefix + table.raw, headerOff: true };
    },
  },
  addNodeView() {
    return ({ node, view, getPos, editor, HTMLAttributes }) => {
      const base = new TableView(node, 100, view, HTMLAttributes);
      base.dom.classList.add('ws-editable-table');
      const frame = document.createElement('div');
      frame.className = 'ws-table-frame';
      base.dom.append(frame);
      frame.append(base.table);
      const toolbar = document.createElement('div');
      toolbar.className = 'ws-table-toolbar';
      toolbar.contentEditable = 'false';
      toolbar.setAttribute('role', 'group');
      toolbar.setAttribute('aria-label', 'Table controls');
      frame.prepend(toolbar);
      const button = (parent: HTMLElement, label: string, text: string, action: () => void) => {
        const control = document.createElement('button');
        control.type = 'button'; control.contentEditable = 'false';
        control.setAttribute('aria-label', label); control.title = label; control.textContent = text;
        control.addEventListener('mousedown', event => event.preventDefault());
        control.addEventListener('click', action);
        parent.append(control);
        return control;
      };
      const position = () => {
        const pos = getPos();
        return typeof pos === 'number' && editor.isEditable && view.state.doc.nodeAt(pos)?.type.name === 'table' ? pos : undefined;
      };
      const selectFirst = () => {
        const pos = position(); if (pos === undefined) return;
        const map = TableMap.get(base.node);
        view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, pos + 1 + map.map[0], pos + 1 + map.map[map.width - 1])));
        view.focus();
      };
      const first = button(toolbar, 'Select first row', '⠿ First row', selectFirst);
      const header = button(toolbar, 'Toggle header row', 'Header row', () => {
        if (position() === undefined) return;
        selectFirst();
        view.dispatch(closeHistory(view.state.tr));
        editor.commands.toggleHeaderRow();
        view.dispatch(closeHistory(view.state.tr));
      });
      const hint = document.createElement('span');
      hint.className = 'ws-table-drag-hint'; hint.contentEditable = 'false';
      hint.setAttribute('role', 'status'); frame.append(hint);
      const add = (axis: 'row' | 'column', count: number) => {
        const pos = position(); if (pos === undefined || count < 1) return;
        const tr = closeHistory(view.state.tr);
        for (let index = 0; index < count; index++) {
          const map = TableMap.get(tr.doc.nodeAt(pos)!);
          const cell = axis === 'row' ? map.map[(map.height - 1) * map.width] : map.map[map.width - 1];
          // Table commands map positions from their input document. Give each
          // insertion a fresh state so earlier steps aren't mapped twice.
          const state = EditorState.create({ schema: view.state.schema, doc: tr.doc,
            selection: CellSelection.create(tr.doc, pos + 1 + cell) });
          (axis === 'row' ? addRowAfter : addColumnAfter)(state, delta => {
            for (const step of delta.steps) tr.step(step);
          });
        }
        const map = TableMap.get(tr.doc.nodeAt(pos)!);
        const cell = axis === 'row' ? map.map[(map.height - 1) * map.width] : map.map[map.width - 1];
        tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 2 + cell)));
        view.dispatch(tr);
        view.dispatch(closeHistory(view.state.tr));
        view.focus();
      };
      let cancelDrag: (() => void) | undefined;
      const handles = document.createElement('div');
      handles.className = 'ws-table-handles'; handles.contentEditable = 'false';
      frame.append(handles);
      const dropLine = document.createElement('div');
      dropLine.className = 'ws-table-drop-line'; dropLine.hidden = true;
      frame.append(dropLine);
      const selectAxis = (axis: 'row' | 'column', index: number) => {
        const pos = position(); if (pos === undefined) return;
        const map = TableMap.get(base.node);
        const start = axis === 'row' ? index * map.width : index;
        const end = axis === 'row' ? start + map.width - 1 : start + (map.height - 1) * map.width;
        view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, pos + 1 + map.map[start], pos + 1 + map.map[end])));
      };
      const reorder = (axis: 'row' | 'column', from: number, to: number) => {
        const pos = position(); if (pos === undefined || from === to) return;
        const map = TableMap.get(base.node);
        if (to < 0 || to >= (axis === 'row' ? map.height : map.width)) return;
        // The move commands also inspect the selection, so resolve it in this
        // table even when the caret is in a different table or paragraph.
        const state = EditorState.create({ schema: view.state.schema, doc: view.state.doc,
          selection: CellSelection.create(view.state.doc, pos + 1 + map.map[0]) });
        (axis === 'row' ? moveTableRow : moveTableColumn)({ from, to })(state, tr => {
          view.dispatch(closeHistory(tr));
          view.dispatch(closeHistory(view.state.tr));
        });
      };
      const axisElements = (axis: 'row' | 'column') => axis === 'row'
        ? Array.from(base.table.rows) : Array.from(base.table.rows[0]?.cells || []);
      const createHandle = (axis: 'row' | 'column', index: number) => {
        let suppressClick = false;
        const control = button(handles, `Move ${axis} ${index + 1}`, '⠿', () => {
          if (!suppressClick) selectAxis(axis, index);
        });
        control.className = `ws-table-move ws-table-move-${axis}`;
        control.dataset.axis = axis;
        control.title = `Drag to move ${axis} ${index + 1}, or use Alt + ${axis === 'row' ? 'Up/Down' : 'Left/Right'}`;
        control.addEventListener('keydown', event => {
          suppressClick = false;
          const keys = axis === 'row' ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
          if (!event.altKey || !keys.includes(event.key)) return;
          event.preventDefault(); event.stopPropagation();
          const to = index + (event.key === keys[0] ? -1 : 1);
          reorder(axis, index, to);
          handles.querySelectorAll<HTMLButtonElement>(`[data-axis="${axis}"]`)[to]?.focus();
        });
        control.addEventListener('pointerdown', event => {
          if (event.button !== 0 || position() === undefined) return;
          event.preventDefault(); cancelDrag?.(); suppressClick = false;
          control.focus({ preventScroll: true });
          const original = base.node;
          let moved = false; let target = index;
          let lastPointer = event; let scrollFrame = 0;
          control.setPointerCapture(event.pointerId);
          const move = (next: PointerEvent) => {
            if (next.pointerId !== event.pointerId) return;
            lastPointer = next;
            moved ||= Math.hypot(next.clientX - event.clientX, next.clientY - event.clientY) > 6;
            if (!moved) return;
            const bounds = base.table.getBoundingClientRect();
            const frameBounds = frame.getBoundingClientRect();
            const rects = axisElements(axis).map(element => element.getBoundingClientRect());
            const coordinate = axis === 'row' ? next.clientY : next.clientX;
            const inside = next.clientX >= bounds.left - 28 && next.clientX <= bounds.right + 28
              && next.clientY >= bounds.top - 28 && next.clientY <= bounds.bottom + 28;
            let slot = rects.findIndex(rect => coordinate < (axis === 'row' ? rect.top + rect.height / 2 : rect.left + rect.width / 2));
            if (slot < 0) slot = rects.length;
            target = inside ? slot - (slot > index ? 1 : 0) : index;
            base.dom.dataset.dragging = 'true';
            control.dataset.dragging = 'true';
            dropLine.hidden = target === index;
            hint.textContent = target === index ? '' : `Move ${axis} ${index + 1} to position ${target + 1}`;
            if (target === index) return;
            const edge = slot < rects.length ? rects[slot] : rects[rects.length - 1];
            const offset = axis === 'row' ? (slot < rects.length ? edge.top : edge.bottom) : (slot < rects.length ? edge.left : edge.right);
            Object.assign(dropLine.style, axis === 'row'
              ? { left: `${bounds.left - frameBounds.left}px`, top: `${offset - frameBounds.top}px`, width: `${bounds.width}px`, height: '3px' }
              : { left: `${offset - frameBounds.left}px`, top: `${bounds.top - frameBounds.top}px`, width: '3px', height: `${bounds.height}px` });
          };
          const scroll = () => {
            if (moved) {
              const viewport = axis === 'column' ? base.dom : base.dom.closest('.ws-document-scroll');
              if (viewport) {
                const bounds = viewport.getBoundingClientRect();
                const coordinate = axis === 'row' ? lastPointer.clientY : lastPointer.clientX;
                const start = axis === 'row' ? bounds.top : bounds.left;
                const end = axis === 'row' ? bounds.bottom : bounds.right;
                const cross = axis === 'row' ? lastPointer.clientX : lastPointer.clientY;
                const crossStart = axis === 'row' ? bounds.left : bounds.top;
                const crossEnd = axis === 'row' ? bounds.right : bounds.bottom;
                if (coordinate >= start - 24 && coordinate <= end + 24 && cross >= crossStart && cross <= crossEnd) {
                  const delta = coordinate < start + 28 ? -8 : coordinate > end - 28 ? 8 : 0;
                  if (delta) {
                    viewport.scrollBy(axis === 'row' ? { top: delta } : { left: delta });
                    move(lastPointer);
                  }
                }
              }
            }
            scrollFrame = requestAnimationFrame(scroll);
          };
          scrollFrame = requestAnimationFrame(scroll);
          const cleanup = () => {
            cancelAnimationFrame(scrollFrame);
            control.removeEventListener('pointermove', move);
            control.removeEventListener('pointerup', up);
            control.removeEventListener('pointercancel', cancel);
            control.removeEventListener('lostpointercapture', cancel);
            window.removeEventListener('keydown', escape, true);
            window.removeEventListener('blur', cancel);
            if (control.hasPointerCapture(event.pointerId)) control.releasePointerCapture(event.pointerId);
            dropLine.hidden = true; hint.textContent = '';
            delete base.dom.dataset.dragging; delete control.dataset.dragging; cancelDrag = undefined;
          };
          const cancel = () => { suppressClick = true; cleanup(); };
          const escape = (key: KeyboardEvent) => {
            if (key.key === 'Escape') { key.preventDefault(); key.stopImmediatePropagation(); cancel(); }
          };
          const up = (next: PointerEvent) => {
            if (next.pointerId !== event.pointerId) return;
            move(next); suppressClick = moved; cleanup();
            if (moved && base.node.eq(original)) {
              reorder(axis, index, target);
              handles.querySelectorAll<HTMLButtonElement>(`[data-axis="${axis}"]`)[target]?.focus({ preventScroll: true });
            }
          };
          cancelDrag = cancel;
          control.addEventListener('pointermove', move);
          control.addEventListener('pointerup', up);
          control.addEventListener('pointercancel', cancel);
          control.addEventListener('lostpointercapture', cancel);
          window.addEventListener('keydown', escape, true);
          window.addEventListener('blur', cancel);
        });
      };
      let layoutFrame = 0;
      const layoutHandles = () => {
        cancelAnimationFrame(layoutFrame);
        layoutFrame = requestAnimationFrame(() => {
          const bounds = frame.getBoundingClientRect();
          for (const axis of ['row', 'column'] as const) {
            const elements = axisElements(axis);
            let controls = Array.from(handles.querySelectorAll<HTMLButtonElement>(`[data-axis="${axis}"]`));
            if (controls.length !== elements.length) {
              cancelDrag?.(); controls.forEach(control => control.remove());
              elements.forEach((_, index) => createHandle(axis, index));
              controls = Array.from(handles.querySelectorAll<HTMLButtonElement>(`[data-axis="${axis}"]`));
            }
            elements.forEach((element, index) => {
              const rect = element.getBoundingClientRect();
              Object.assign(controls[index].style, axis === 'row'
                ? { top: `${rect.top - bounds.top}px`, height: `${rect.height}px` }
                : { left: `${rect.left - bounds.left}px`, width: `${rect.width}px` });
            });
          }
        });
      };
      const resize = new ResizeObserver(layoutHandles);
      resize.observe(base.table);
      for (const axis of ['row', 'column'] as const) {
        const control = button(frame, `Add ${axis}`, '+', () => { if (!suppressClick) add(axis, 1); });
        control.className = `ws-table-add ws-table-add-${axis}`;
        control.title = `Click to add a ${axis}, or drag to add several`;
        let suppressClick = false;
        control.addEventListener('pointerdown', event => {
          if (event.button !== 0 || position() === undefined) return;
          cancelDrag?.(); suppressClick = false;
          const start = axis === 'row' ? event.clientY : event.clientX;
          const original = base.node;
          let count = 0; let moved = false;
          control.setPointerCapture(event.pointerId);
          const move = (next: PointerEvent) => {
            const distance = (axis === 'row' ? next.clientY : next.clientX) - start;
            moved ||= Math.abs(distance) > 6;
            count = distance > 6 ? Math.min(20, Math.ceil(distance / (axis === 'row' ? 36 : 96))) : 0;
            hint.textContent = count ? `Add ${count} ${axis}${count === 1 ? '' : 's'}` : '';
            base.dom.dataset.dragging = String(moved);
          };
          const cleanup = () => {
            control.removeEventListener('pointermove', move);
            control.removeEventListener('pointerup', up);
            control.removeEventListener('lostpointercapture', cancel);
            control.removeEventListener('pointercancel', cancel);
            window.removeEventListener('keydown', escape, true);
            window.removeEventListener('blur', cancel);
            if (control.hasPointerCapture(event.pointerId)) control.releasePointerCapture(event.pointerId);
            hint.textContent = ''; delete base.dom.dataset.dragging; cancelDrag = undefined;
          };
          const cancel = () => { suppressClick = true; cleanup(); };
          const escape = (key: KeyboardEvent) => {
            if (key.key === 'Escape') { key.preventDefault(); key.stopImmediatePropagation(); cancel(); }
          };
          const up = () => {
            suppressClick = moved;
            cleanup();
            if (moved && base.node.eq(original)) add(axis, count);
          };
          cancelDrag = cancel;
          control.addEventListener('pointermove', move);
          control.addEventListener('pointerup', up);
          control.addEventListener('lostpointercapture', cancel);
          control.addEventListener('pointercancel', cancel);
          window.addEventListener('keydown', escape, true);
          window.addEventListener('blur', cancel);
        });
        control.addEventListener('keydown', () => { suppressClick = false; });
      }
      const sync = () => {
        layoutHandles();
        base.dom.style.setProperty('--table-columns', String(TableMap.get(base.node).width));
        const pos = getPos();
        const selection = view.state.selection;
        const selected = typeof pos === 'number' && selection.from > pos && selection.to < pos + base.node.nodeSize;
        base.dom.dataset.active = String(selected);
        const firstRow = selected && selection.from < pos! + 1 + base.node.firstChild!.nodeSize;
        first.setAttribute('aria-pressed', String(firstRow));
        header.hidden = !firstRow;
        header.setAttribute('aria-pressed', String(base.node.firstChild?.firstChild?.type.name === 'tableHeader'));
      };
      editor.on('transaction', sync); editor.on('update', sync); sync();
      return {
        dom: base.dom, contentDOM: base.contentDOM,
        update(next) { if (!next.eq(base.node)) cancelDrag?.(); const updated = base.update(next); if (updated) sync(); return updated; },
        ignoreMutation: mutation => base.ignoreMutation(mutation),
        stopEvent: event => event.target instanceof Element && Boolean(event.target.closest('button, .ws-table-toolbar')),
        destroy() { cancelDrag?.(); resize.disconnect(); cancelAnimationFrame(layoutFrame); editor.off('transaction', sync); editor.off('update', sync); },
      };
    };
  },
});
