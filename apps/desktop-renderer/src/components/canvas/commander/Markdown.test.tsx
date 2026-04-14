// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { Markdown } from './Markdown.js';

afterEach(() => {
  cleanup();
});

describe('Markdown', () => {
  it('renders bold text', () => {
    render(<Markdown content="**hello**" />);
    const strong = document.querySelector('strong');
    expect(strong).toBeTruthy();
    expect(strong!.textContent).toBe('hello');
  });

  it('renders italic text', () => {
    render(<Markdown content="*hello*" />);
    expect(document.querySelector('em')).toBeTruthy();
  });

  it('renders inline code', () => {
    render(<Markdown content="use `foo()` here" />);
    const code = document.querySelector('code');
    expect(code).toBeTruthy();
    expect(code!.textContent).toBe('foo()');
  });

  it('renders fenced code blocks', () => {
    render(<Markdown content={'```js\nconst x = 1;\n```'} />);
    const pre = document.querySelector('pre');
    expect(pre).toBeTruthy();
    expect(pre!.textContent).toContain('const x = 1;');
  });

  it('renders GFM tables', () => {
    render(<Markdown content="| A | B |\n|---|---|\n| 1 | 2 |" />);
    expect(document.querySelector('table')).toBeTruthy();
    expect(document.querySelector('td')!.textContent).toBe('1');
  });

  it('renders headers', () => {
    render(<Markdown content="## Section Title" />);
    const h2 = document.querySelector('h2');
    expect(h2).toBeTruthy();
    expect(h2!.textContent).toBe('Section Title');
  });

  it('renders unordered lists', () => {
    render(<Markdown content="- one\n- two\n- three" />);
    const items = document.querySelectorAll('li');
    expect(items.length).toBe(3);
  });

  it('renders ordered lists', () => {
    render(<Markdown content="1. first\n2. second" />);
    expect(document.querySelector('ol')).toBeTruthy();
  });

  it('renders links with target=_blank', () => {
    render(<Markdown content="[click](https://example.com)" />);
    const a = document.querySelector('a');
    expect(a).toBeTruthy();
    expect(a!.getAttribute('href')).toBe('https://example.com');
    expect(a!.getAttribute('target')).toBe('_blank');
    expect(a!.getAttribute('rel')).toContain('noopener');
  });

  it('blocks javascript: URLs', () => {
    render(<Markdown content="[click](javascript:alert(1))" />);
    // Should render as span, not as link
    const a = document.querySelector('a[href*="javascript"]');
    expect(a).toBeNull();
  });

  it('strips raw HTML tags from LLM output', () => {
    const { container } = render(
      <Markdown content='created <strong>角色A</strong> (ID: <code class="foo">abc</code>)' />,
    );
    expect(container.innerHTML).not.toContain('class="foo"');
    expect(container.textContent).toContain('角色A');
    expect(container.textContent).toContain('abc');
  });

  it('renders DeepSeek think tags as collapsed details', () => {
    render(<Markdown content="<think>reasoning here</think>\n\nfinal answer" />);
    const details = document.querySelector('details');
    expect(details).toBeTruthy();
    expect(details!.textContent).toContain('reasoning here');
    expect(document.body.textContent).toContain('final answer');
  });

  it('handles empty string', () => {
    const { container } = render(<Markdown content="" />);
    expect(container.innerHTML).toBe('');
  });

  it('renders node:// links as clickable buttons', () => {
    const onNodeClick = vi.fn();
    render(<Markdown content="see [My Node](node://abc-123)" onNodeClick={onNodeClick} />);
    const btn = document.querySelector('[data-node-id]');
    expect(btn).toBeTruthy();
    expect(btn!.getAttribute('data-node-id')).toBe('abc-123');
    expect(btn!.textContent).toBe('My Node');
  });

  it('calls onNodeClick when node link is clicked', () => {
    const onNodeClick = vi.fn();
    render(<Markdown content="see [My Node](node://abc-123)" onNodeClick={onNodeClick} />);
    const btn = document.querySelector('[data-node-id]') as HTMLElement;
    btn.click();
    expect(onNodeClick).toHaveBeenCalledWith('abc-123');
  });

  it('renders blockquotes', () => {
    render(<Markdown content="> quoted text" />);
    expect(document.querySelector('blockquote')).toBeTruthy();
  });
});
