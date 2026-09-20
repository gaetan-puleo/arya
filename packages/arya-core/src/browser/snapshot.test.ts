import { describe, expect, it } from 'vitest';
import { formatSnapshot, type PageSnapshot } from './snapshot';

describe('formatSnapshot', () => {
  const snap: PageSnapshot = {
    url: 'https://example.com',
    title: 'Example',
    elements: [
      { ref: 0, role: 'link', tag: 'a', text: 'Home', href: 'https://example.com/' },
      { ref: 1, role: 'textbox', tag: 'input', text: '', placeholder: 'Search' },
      { ref: 2, role: 'button', tag: 'button', text: 'Go', disabled: true },
    ],
  };

  it('includes url, title and element count', () => {
    const out = formatSnapshot(snap);
    expect(out).toContain('https://example.com');
    expect(out).toContain('Example');
    expect(out).toContain('Interactive elements: 3');
  });

  it('renders each element with its ref, role and tag', () => {
    const out = formatSnapshot(snap);
    expect(out).toContain('[0] link <a>');
    expect(out).toContain('[1] textbox <input>');
    expect(out).toContain('[2] button <button>');
  });

  it('shows href, placeholder and disabled markers', () => {
    const out = formatSnapshot(snap);
    expect(out).toContain('→ https://example.com/');
    expect(out).toContain('ph="Search"');
    expect(out).toContain('(disabled)');
  });
});
