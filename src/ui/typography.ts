import { fontFamily, type Typography } from '../../shared/typography';

export function applyTypography(value: Typography) {
  const style = document.documentElement.style;
  style.setProperty('--ds-font-system', fontFamily(value.system));
  style.setProperty('--ds-font-editor', fontFamily(value.editor));
  style.setProperty('--ds-system-text-scale', String(value.systemScale / 100));
  style.setProperty('--ds-editor-text-scale', String(value.editorSize / 14));
  style.setProperty('--ds-scratchpad-text-scale', String(value.scratchpadSize / 13));
}
