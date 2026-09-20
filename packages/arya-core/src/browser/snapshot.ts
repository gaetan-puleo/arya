// Structured page snapshot: tag interactive elements with a stable `data-arya-ref`
// and return a flat, model-friendly list. Runs inside the page via Playwright's
// `page.evaluate`. No vision needed — the agent reads roles/text/refs and acts on
// refs. Re-running reassigns refs (they are only stable within one snapshot).

export interface SnapshotElement {
  ref: number;
  role: string;
  tag: string;
  text: string;
  href?: string;
  value?: string;
  placeholder?: string;
  disabled?: boolean;
}

export interface PageSnapshot {
  url: string;
  title: string;
  elements: SnapshotElement[];
}

// The selector for elements the agent can act on.
const INTERACTIVE = [
  'a[href]',
  'button',
  'input:not([type=hidden])',
  'textarea',
  'select',
  '[role=button]',
  '[role=link]',
  '[role=textbox]',
  '[role=checkbox]',
  '[role=radio]',
  '[role=combobox]',
  '[role=menuitem]',
  '[role=tab]',
  '[onclick]',
  '[contenteditable=true]',
].join(',');

// Injected into the page. Returns the tagged elements.
export const SNAPSHOT_SCRIPT = `() => {
  const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
  };
  const sel = ${JSON.stringify(INTERACTIVE)};
  const nodes = Array.from(document.querySelectorAll(sel)).filter(visible);
  const out = [];
  let ref = 0;
  for (const el of nodes) {
    if (out.length >= 300) break;
    el.setAttribute('data-arya-ref', String(ref));
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role') || (
      tag === 'a' ? 'link' :
      tag === 'button' ? 'button' :
      tag === 'input' ? (el.type || 'textbox') :
      tag === 'textarea' ? 'textbox' :
      tag === 'select' ? 'combobox' : 'generic'
    );
    const text = clean(el.innerText || el.textContent || el.getAttribute('aria-label') || '');
    const item = { ref, role, tag, text: text.slice(0, 120) };
    if (el.href) item.href = el.href;
    if ('value' in el && typeof el.value === 'string') item.value = el.value.slice(0, 120);
    if (el.placeholder) item.placeholder = el.placeholder;
    if (el.disabled) item.disabled = true;
    out.push(item);
    ref++;
  }
  return { url: location.href, title: document.title, elements: out };
}`;

export const formatSnapshot = (snap: PageSnapshot): string => {
  const lines = [`URL: ${snap.url}`, `Title: ${snap.title}`, `Interactive elements: ${snap.elements.length}`, ''];
  for (const e of snap.elements) {
    const bits = [`[${e.ref}] ${e.role} <${e.tag}>`];
    if (e.text) bits.push(`"${e.text}"`);
    if (e.href) bits.push(`→ ${e.href}`);
    if (e.value) bits.push(`value="${e.value}"`);
    if (e.placeholder) bits.push(`ph="${e.placeholder}"`);
    if (e.disabled) bits.push('(disabled)');
    lines.push(bits.join(' '));
  }
  return lines.join('\n');
};
