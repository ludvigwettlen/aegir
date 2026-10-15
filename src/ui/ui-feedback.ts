import type { FeedbackTarget } from '../../shared/ui-feedback';

export function feedbackElement(element: Element): HTMLElement {
  return (element.closest('button, a, input, textarea, select, [role="button"], [data-feedback-id]') ||
    element.closest('svg')?.parentElement || element) as HTMLElement;
}

export function describeFeedbackTarget(element: HTMLElement, page: string): FeedbackTarget {
  const path: string[] = [];
  for (let node: Element | null = element; node && node !== document.body; node = node.parentElement) {
    const context = node.getAttribute('data-feedback-context');
    if (context) { path.unshift(`[data-feedback-context="${CSS.escape(context)}"]`); break; }
    if (node.id) { path.unshift(`#${CSS.escape(node.id)}`); break; }
    const classes = [...node.classList].filter(name => !['active', 'selected', 'focused'].includes(name)).slice(0, 3);
    let part = node.tagName.toLowerCase() + classes.map(name => `.${CSS.escape(name)}`).join('');
    const siblings = node.parentElement ? [...node.parentElement.children].filter(sibling => sibling.tagName === node!.tagName) : [];
    if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
    path.unshift(part);
  }
  const rect = element.getBoundingClientRect();
  const isField = element.matches('input, textarea, select, [contenteditable="true"]');
  const label = element.getAttribute('aria-label') || element.getAttribute('title') ||
    (isField ? element.getAttribute('placeholder') : element.innerText) || element.tagName.toLowerCase();
  return {
    page, selector: path.join(' > ').slice(0, 2000), label: label.replace(/\s+/g, ' ').trim().slice(0, 200),
    tag: element.tagName.toLowerCase(), viewport: { width: innerWidth, height: innerHeight },
    bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
  };
}
