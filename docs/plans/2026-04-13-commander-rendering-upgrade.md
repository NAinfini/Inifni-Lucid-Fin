# Commander AI Rendering & UX Upgrade Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the regex-based markdown renderer with a proper AST parser that handles all mainstream LLM output formats, add clickable node links in Commander responses, add session search to HistoryPanel, and add artifact change previews after tool executions.

**Architecture:** Replace `renderMarkdown()` (regex → HTML string → dangerouslySetInnerHTML) with `react-markdown` + remark/rehype plugins rendered as React components. Node links use a custom `node://` protocol in markdown links, handled by a rehype plugin that renders clickable spans dispatching Redux `setSelection` + ReactFlow `setCenter`. Session search is a simple client-side filter on title/message content. Artifact previews show inline diffs of node changes after mutating tool calls complete.

**Tech Stack:** react-markdown, remark-gfm, remark-math, rehype-katex, katex (CSS), DOMPurify (retain for sanitization), React 19, Redux Toolkit, @xyflow/react

---

## Task 1: Install markdown rendering dependencies

**Files:**
- Modify: `apps/desktop-renderer/package.json`

**Step 1: Install packages**

```bash
cd apps/desktop-renderer
npm install react-markdown remark-gfm remark-math rehype-katex katex
```

This installs:
- `react-markdown` — React component that parses Markdown into React elements (no `dangerouslySetInnerHTML`)
- `remark-gfm` — GitHub Flavored Markdown (tables, strikethrough, task lists, autolinks)
- `remark-math` — Parse `$...$` and `$$...$$` LaTeX math delimiters
- `rehype-katex` — Render parsed math nodes via KaTeX
- `katex` — The KaTeX CSS + fonts for math rendering

**Step 2: Verify build**

```bash
cd apps/desktop-renderer && npx tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add apps/desktop-renderer/package.json apps/desktop-renderer/package-lock.json
git commit -m "deps: add react-markdown, remark-gfm, remark-math, rehype-katex"
```

---

## Task 2: Create the new `<Markdown>` component

Replace the regex-based `renderMarkdown()` function with a React component that uses `react-markdown` and proper plugins. This component will be used everywhere `renderMarkdown` + `dangerouslySetInnerHTML` is currently used.

**Files:**
- Create: `apps/desktop-renderer/src/components/canvas/commander/Markdown.tsx`
- Create: `apps/desktop-renderer/src/components/canvas/commander/Markdown.test.tsx`

**Step 1: Write the failing tests**

```tsx
// apps/desktop-renderer/src/components/canvas/commander/Markdown.test.tsx
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Markdown } from './Markdown.js';

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
    const a = document.querySelector('a');
    // Should either strip the link or remove the href
    if (a) {
      expect(a.getAttribute('href')).not.toContain('javascript:');
    }
  });

  it('strips raw HTML tags from LLM output', () => {
    render(<Markdown content='created <strong>角色A</strong> (ID: <code class="foo">abc</code>)' />);
    // Raw HTML should NOT render — react-markdown with skipHtml strips it
    const container = document.querySelector('[data-testid="markdown"]') ?? document.body;
    expect(container.innerHTML).not.toContain('class="foo"');
    expect(container.textContent).toContain('角色A');
    expect(container.textContent).toContain('abc');
  });

  it('renders DeepSeek <think> tags as collapsed details', () => {
    render(<Markdown content="<think>reasoning here</think>\n\nfinal answer" />);
    // Think content should be hidden or in a collapsible element
    expect(document.body.textContent).toContain('final answer');
  });

  it('handles empty string', () => {
    const { container } = render(<Markdown content="" />);
    expect(container.textContent).toBe('');
  });

  it('renders newlines correctly', () => {
    render(<Markdown content="line1\nline2" />);
    // react-markdown renders single newlines as soft breaks
    expect(document.body.textContent).toContain('line1');
    expect(document.body.textContent).toContain('line2');
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npx vitest run apps/desktop-renderer/src/components/canvas/commander/Markdown.test.tsx
```

Expected: FAIL — module not found.

**Step 3: Implement the Markdown component**

```tsx
// apps/desktop-renderer/src/components/canvas/commander/Markdown.tsx
import { memo, type ComponentPropsWithoutRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

const BLOCKED_PROTOCOLS = ['javascript:', 'data:', 'vbscript:', 'blob:'];

// Strip raw HTML tags that LLMs sometimes emit instead of Markdown.
// Must run BEFORE react-markdown parses, so it sees clean Markdown.
const htmlTagRe = /<\/?[a-z][a-z0-9]*(?:\s[^>]*)?\/?>/gi;

// DeepSeek R1 reasoning traces: <think>...</think>
// Extract into a separate collapsible block.
const thinkBlockRe = /<think>([\s\S]*?)<\/think>/gi;

function preprocess(raw: string): { content: string; thinkBlocks: string[] } {
  const thinkBlocks: string[] = [];
  let content = raw.replace(thinkBlockRe, (_m, inner: string) => {
    thinkBlocks.push(inner.trim());
    return '';
  });
  content = content.replace(htmlTagRe, '');
  return { content: content.trim(), thinkBlocks };
}

// Custom link renderer — blocks dangerous protocols, opens in new tab
function LinkRenderer({ href, children, ...props }: ComponentPropsWithoutRef<'a'>) {
  if (href) {
    const trimmed = href.trim().toLowerCase();
    if (BLOCKED_PROTOCOLS.some((p) => trimmed.startsWith(p))) {
      return <span {...props}>{children}</span>;
    }
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline"
      {...props}
    >
      {children}
    </a>
  );
}

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeKatex];

const components = {
  a: LinkRenderer,
  // Style overrides for markdown elements
  pre: (props: ComponentPropsWithoutRef<'pre'>) => (
    <pre className="commander-codeblock my-2 overflow-x-auto rounded-md bg-muted/50 p-3 text-xs" {...props} />
  ),
  code: ({ className, children, ...props }: ComponentPropsWithoutRef<'code'> & { inline?: boolean }) => {
    // Fenced code blocks get a className like "language-js" from react-markdown
    const isBlock = className?.startsWith('language-');
    if (isBlock) {
      return <code className={className} {...props}>{children}</code>;
    }
    return (
      <code className="commander-inline-code rounded bg-muted px-1 py-0.5 text-[0.9em]" {...props}>
        {children}
      </code>
    );
  },
  table: (props: ComponentPropsWithoutRef<'table'>) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-xs" {...props} />
    </div>
  ),
  th: (props: ComponentPropsWithoutRef<'th'>) => (
    <th className="border border-border/40 bg-muted/30 px-2 py-1 text-left font-medium" {...props} />
  ),
  td: (props: ComponentPropsWithoutRef<'td'>) => (
    <td className="border border-border/40 px-2 py-1" {...props} />
  ),
  ul: (props: ComponentPropsWithoutRef<'ul'>) => (
    <ul className="my-1 ml-4 list-disc" {...props} />
  ),
  ol: (props: ComponentPropsWithoutRef<'ol'>) => (
    <ol className="my-1 ml-4 list-decimal" {...props} />
  ),
  h1: (props: ComponentPropsWithoutRef<'h1'>) => (
    <h1 className="mt-3 mb-1 text-base font-bold" {...props} />
  ),
  h2: (props: ComponentPropsWithoutRef<'h2'>) => (
    <h2 className="mt-2.5 mb-1 text-sm font-bold" {...props} />
  ),
  h3: (props: ComponentPropsWithoutRef<'h3'>) => (
    <h3 className="mt-2 mb-0.5 text-sm font-semibold" {...props} />
  ),
  blockquote: (props: ComponentPropsWithoutRef<'blockquote'>) => (
    <blockquote className="my-1 border-l-2 border-primary/40 pl-3 text-muted-foreground" {...props} />
  ),
};

interface MarkdownProps {
  content: string;
}

export const Markdown = memo(function Markdown({ content }: MarkdownProps) {
  if (!content) return null;

  const { content: cleaned, thinkBlocks } = preprocess(content);

  return (
    <div data-testid="markdown" className="commander-markdown">
      {thinkBlocks.length > 0 && (
        <details className="my-1 rounded border border-border/40 bg-muted/20 text-xs">
          <summary className="cursor-pointer px-2 py-1 text-muted-foreground select-none">
            Reasoning ({thinkBlocks.length})
          </summary>
          <div className="px-2 py-1 text-muted-foreground whitespace-pre-wrap">
            {thinkBlocks.join('\n\n---\n\n')}
          </div>
        </details>
      )}
      {cleaned && (
        <ReactMarkdown
          remarkPlugins={remarkPlugins}
          rehypePlugins={rehypePlugins}
          skipHtml
          components={components}
        >
          {cleaned}
        </ReactMarkdown>
      )}
    </div>
  );
});
```

**Step 4: Run tests to verify they pass**

```bash
npx vitest run apps/desktop-renderer/src/components/canvas/commander/Markdown.test.tsx
```

Expected: all PASS.

**Step 5: Commit**

```bash
git add apps/desktop-renderer/src/components/canvas/commander/Markdown.tsx apps/desktop-renderer/src/components/canvas/commander/Markdown.test.tsx
git commit -m "feat: add react-markdown based Markdown component with GFM, math, think blocks"
```

---

## Task 3: Replace `renderMarkdown` usage in MessageList

Swap all `dangerouslySetInnerHTML={{ __html: renderMarkdown(...) }}` calls with the new `<Markdown>` component.

**Files:**
- Modify: `apps/desktop-renderer/src/components/canvas/commander/MessageList.tsx`

**Step 1: Replace all renderMarkdown usages**

In `MessageList.tsx`, make these changes:

1. Replace import:
   - Remove: `import { renderMarkdown } from './markdown.js';`
   - Add: `import { Markdown } from './Markdown.js';`

2. Replace all 4 instances of the `dangerouslySetInnerHTML` pattern:

   ```tsx
   // OLD (4 occurrences at lines 67-71, 91-94, 121-125)
   <div
     className="commander-markdown"
     dangerouslySetInnerHTML={{ __html: renderMarkdown(seg.content) }}
   />

   // NEW
   <Markdown content={seg.content} />
   ```

   For the streaming live message (line 121-125), same replacement:
   ```tsx
   // OLD
   <div
     className="commander-markdown"
     dangerouslySetInnerHTML={{ __html: renderMarkdown(seg.content) }}
   />

   // NEW
   <Markdown content={seg.content} />
   ```

**Step 2: Run existing MessageList tests + markdown tests**

```bash
npx vitest run apps/desktop-renderer/src/components/canvas/commander/
```

Expected: all pass.

**Step 3: Run typecheck**

```bash
cd apps/desktop-renderer && npx tsc --noEmit
```

Expected: no errors.

**Step 4: Commit**

```bash
git add apps/desktop-renderer/src/components/canvas/commander/MessageList.tsx
git commit -m "refactor: replace renderMarkdown with Markdown component in MessageList"
```

---

## Task 4: Add node link support (`node://` protocol)

Enable clickable node references in Commander AI responses. When the LLM outputs `[Node Title](node://nodeId)`, clicking it selects and centers on that node.

**Files:**
- Modify: `apps/desktop-renderer/src/components/canvas/commander/Markdown.tsx`
- Modify: `apps/desktop-renderer/src/components/canvas/commander/Markdown.test.tsx`
- Modify: `apps/desktop-renderer/src/components/canvas/commander/MessageList.tsx`
- Modify: `apps/desktop-renderer/src/components/canvas/CommanderPanel.tsx`

**Step 1: Add node link tests**

Add to `Markdown.test.tsx`:

```tsx
describe('node links', () => {
  it('renders node:// links with special styling', () => {
    const onNodeClick = vi.fn();
    render(<Markdown content="see [My Node](node://abc-123)" onNodeClick={onNodeClick} />);
    const link = document.querySelector('[data-node-id]');
    expect(link).toBeTruthy();
    expect(link!.getAttribute('data-node-id')).toBe('abc-123');
    expect(link!.textContent).toBe('My Node');
  });

  it('calls onNodeClick when node link is clicked', async () => {
    const onNodeClick = vi.fn();
    render(<Markdown content="see [My Node](node://abc-123)" onNodeClick={onNodeClick} />);
    const link = document.querySelector('[data-node-id]') as HTMLElement;
    link.click();
    expect(onNodeClick).toHaveBeenCalledWith('abc-123');
  });
});
```

**Step 2: Run tests — expect FAIL**

**Step 3: Update Markdown component to support node links**

Add `onNodeClick` prop to `MarkdownProps`:

```tsx
interface MarkdownProps {
  content: string;
  onNodeClick?: (nodeId: string) => void;
}
```

Update `LinkRenderer` to detect `node://` protocol (make it accept `onNodeClick` via closure — move into the component body or use a context):

```tsx
export const Markdown = memo(function Markdown({ content, onNodeClick }: MarkdownProps) {
  if (!content) return null;
  const { content: cleaned, thinkBlocks } = preprocess(content);

  const nodeAwareLinkRenderer = useMemo(() => {
    return function NodeAwareLink({ href, children, ...props }: ComponentPropsWithoutRef<'a'>) {
      if (href?.startsWith('node://')) {
        const nodeId = href.slice(7); // strip "node://"
        return (
          <button
            type="button"
            data-node-id={nodeId}
            className="text-primary underline decoration-dotted cursor-pointer hover:text-primary/80"
            onClick={() => onNodeClick?.(nodeId)}
            {...props}
          >
            {children}
          </button>
        );
      }
      // Regular links
      if (href) {
        const trimmed = href.trim().toLowerCase();
        if (BLOCKED_PROTOCOLS.some((p) => trimmed.startsWith(p))) {
          return <span {...props}>{children}</span>;
        }
      }
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline" {...props}>
          {children}
        </a>
      );
    };
  }, [onNodeClick]);

  const dynamicComponents = useMemo(
    () => ({ ...components, a: nodeAwareLinkRenderer }),
    [nodeAwareLinkRenderer],
  );

  return (
    <div data-testid="markdown" className="commander-markdown">
      {/* thinkBlocks rendering unchanged */}
      {cleaned && (
        <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} skipHtml components={dynamicComponents}>
          {cleaned}
        </ReactMarkdown>
      )}
    </div>
  );
});
```

**Step 4: Thread `onNodeClick` from CommanderPanel through MessageList to Markdown**

In `MessageList.tsx`, add to `MessageListProps`:
```tsx
onNodeClick?: (nodeId: string) => void;
```

Pass it to every `<Markdown>` instance:
```tsx
<Markdown content={seg.content} onNodeClick={onNodeClick} />
```

In `CommanderPanel.tsx`, create the handler using the existing `handleNavigateToNode` pattern.  The CommanderPanel does NOT have access to `useReactFlow()` (it's outside the ReactFlow `<ReactFlowProvider>`). Instead, dispatch a custom event that `CanvasWorkspace` listens for:

```tsx
// In CommanderPanel.tsx
const handleNodeClick = useCallback((nodeId: string) => {
  // Dispatch a custom DOM event that CanvasWorkspace listens for
  window.dispatchEvent(new CustomEvent('commander:navigate-to-node', { detail: { nodeId } }));
}, []);

// Pass to MessageList
<MessageList ... onNodeClick={handleNodeClick} />
```

In `CanvasWorkspace.tsx`, add a listener that calls the existing `handleNavigateToNode`:
```tsx
useEffect(() => {
  const handler = (e: Event) => {
    const nodeId = (e as CustomEvent).detail?.nodeId;
    if (typeof nodeId === 'string') handleNavigateToNode(nodeId);
  };
  window.addEventListener('commander:navigate-to-node', handler);
  return () => window.removeEventListener('commander:navigate-to-node', handler);
}, [handleNavigateToNode]);
```

**Step 5: Run tests**

```bash
npx vitest run apps/desktop-renderer/src/components/canvas/commander/
```

Expected: all PASS.

**Step 6: Instruct the LLM to use node links**

Modify the system prompt to tell the LLM about the `node://` link format.

Find the system prompt file:
```bash
grep -r "agent-system" packages/application/src/prompts/
```

Add to the prompt (near the formatting section):
```
When referencing nodes in your responses, use markdown link syntax with the node:// protocol: [Node Title](node://nodeId). This creates a clickable link that navigates to the node on the canvas.
```

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: add clickable node links in Commander responses (node:// protocol)"
```

---

## Task 5: Add session search to HistoryPanel

Add a search input at the top of the HistoryPanel that filters sessions by title and message content.

**Files:**
- Modify: `apps/desktop-renderer/src/components/canvas/HistoryPanel.tsx`

**Step 1: Add search state and filtering**

Add after the existing state declarations (around line 58):
```tsx
const [searchQuery, setSearchQuery] = useState('');

const filteredSessions = useMemo(() => {
  if (!searchQuery.trim()) return sessions;
  const q = searchQuery.toLowerCase();
  return sessions.filter(
    (s) =>
      s.title.toLowerCase().includes(q) ||
      s.messages.some((m) => m.content.toLowerCase().includes(q)),
  );
}, [sessions, searchQuery]);
```

**Step 2: Add search input UI**

Add right after the header `<div>` (after line 253), before the sessions list:
```tsx
<div className="px-2 py-1.5 border-b border-border/60">
  <input
    type="text"
    value={searchQuery}
    onChange={(e) => setSearchQuery(e.target.value)}
    placeholder={t('history.search')}
    className="w-full rounded bg-muted/50 border border-border/40 px-2 py-1 text-xs outline-none focus:border-primary placeholder:text-muted-foreground/50"
  />
</div>
```

**Step 3: Use `filteredSessions` instead of `sessions` in the render**

Replace `sessions.map((session) =>` with `filteredSessions.map((session) =>` in the JSX.

Also update the empty state to distinguish between "no sessions" and "no search results":
```tsx
{filteredSessions.length === 0 ? (
  <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground px-3 text-center">
    {searchQuery.trim() ? t('history.noResults') : t('history.empty')}
  </div>
) : (
  <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
    {filteredSessions.map((session) => {
      // ... existing session rendering
    })}
  </div>
)}
```

**Step 4: Run typecheck**

```bash
cd apps/desktop-renderer && npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add apps/desktop-renderer/src/components/canvas/HistoryPanel.tsx
git commit -m "feat: add session search filter to HistoryPanel"
```

---

## Task 6: Add artifact change preview after mutating tool calls

After a mutating tool call completes (e.g., `canvas.updateNodes`, `canvas.addNode`), show an inline summary of what changed — which nodes were added/removed/modified.

**Files:**
- Create: `apps/desktop-renderer/src/components/canvas/commander/ArtifactPreview.tsx`
- Create: `apps/desktop-renderer/src/components/canvas/commander/ArtifactPreview.test.tsx`
- Modify: `apps/desktop-renderer/src/components/canvas/commander/ToolCallCard.tsx`

**Step 1: Define the ArtifactPreview component**

The component receives a tool call result and renders a compact summary of changes.

```tsx
// apps/desktop-renderer/src/components/canvas/commander/ArtifactPreview.tsx
import { memo } from 'react';
import { Plus, Pencil, Trash2, Link2 } from 'lucide-react';

interface ArtifactChange {
  type: 'added' | 'updated' | 'removed' | 'connected';
  label: string;
  id?: string;
}

/**
 * Extract human-readable change summaries from a tool call result.
 */
export function extractChanges(
  toolName: string,
  result: unknown,
  nodeTitlesById: Record<string, string>,
): ArtifactChange[] {
  if (!result || typeof result !== 'object') return [];
  const r = result as Record<string, unknown>;

  // Tool-specific extraction
  if (toolName.includes('addNode') || toolName.includes('batchCreate') || toolName === 'canvas.addNode') {
    const nodes = Array.isArray(r.nodes) ? r.nodes : r.nodeId ? [{ id: r.nodeId }] : [];
    return nodes.map((n: Record<string, unknown>) => ({
      type: 'added' as const,
      label: nodeTitlesById[n.id as string] ?? (n.title as string) ?? (n.id as string),
      id: n.id as string,
    }));
  }

  if (toolName.includes('updateNode') || toolName.includes('Update')) {
    const ids = Array.isArray(r.nodeIds) ? r.nodeIds : r.nodeId ? [r.nodeId] : [];
    return (ids as string[]).map((id) => ({
      type: 'updated' as const,
      label: nodeTitlesById[id] ?? id,
      id,
    }));
  }

  if (toolName.includes('deleteNode') || toolName.includes('Delete')) {
    const ids = Array.isArray(r.nodeIds) ? r.nodeIds : r.nodeId ? [r.nodeId] : [];
    return (ids as string[]).map((id) => ({
      type: 'removed' as const,
      label: nodeTitlesById[id] ?? id,
      id,
    }));
  }

  if (toolName.includes('connect') || toolName.includes('addEdge')) {
    return [{ type: 'connected', label: 'Edge created' }];
  }

  // Generic: if result has a success field and node info, show it
  if (r.success && typeof r.nodeId === 'string') {
    return [{ type: 'updated', label: nodeTitlesById[r.nodeId as string] ?? (r.nodeId as string), id: r.nodeId as string }];
  }

  return [];
}

const icons = {
  added: Plus,
  updated: Pencil,
  removed: Trash2,
  connected: Link2,
};

const colors = {
  added: 'text-emerald-400',
  updated: 'text-amber-400',
  removed: 'text-destructive',
  connected: 'text-primary',
};

interface ArtifactPreviewProps {
  toolName: string;
  result: unknown;
  nodeTitlesById: Record<string, string>;
  onNodeClick?: (nodeId: string) => void;
}

export const ArtifactPreview = memo(function ArtifactPreview({
  toolName,
  result,
  nodeTitlesById,
  onNodeClick,
}: ArtifactPreviewProps) {
  const changes = extractChanges(toolName, result, nodeTitlesById);
  if (changes.length === 0) return null;

  return (
    <div className="mt-1 space-y-0.5">
      {changes.map((change, i) => {
        const Icon = icons[change.type];
        return (
          <div key={i} className="flex items-center gap-1.5 text-[10px]">
            <Icon className={`w-3 h-3 ${colors[change.type]}`} />
            {change.id && onNodeClick ? (
              <button
                type="button"
                className="text-primary underline decoration-dotted cursor-pointer hover:text-primary/80"
                onClick={() => onNodeClick(change.id!)}
              >
                {change.label}
              </button>
            ) : (
              <span className="text-muted-foreground">{change.label}</span>
            )}
          </div>
        );
      })}
    </div>
  );
});
```

**Step 2: Write tests for extractChanges**

```tsx
// apps/desktop-renderer/src/components/canvas/commander/ArtifactPreview.test.tsx
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { extractChanges } from './ArtifactPreview.js';

describe('extractChanges', () => {
  const titles: Record<string, string> = { 'n1': 'My Node', 'n2': 'Other Node' };

  it('extracts added nodes from batchCreate result', () => {
    const result = { success: true, nodes: [{ id: 'n1', title: 'My Node' }] };
    const changes = extractChanges('canvas.batchCreate', result, titles);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({ type: 'added', label: 'My Node', id: 'n1' });
  });

  it('extracts updated node from updateNodes result', () => {
    const result = { success: true, nodeIds: ['n1', 'n2'] };
    const changes = extractChanges('canvas.updateNodes', result, titles);
    expect(changes).toHaveLength(2);
    expect(changes[0].type).toBe('updated');
    expect(changes[1].label).toBe('Other Node');
  });

  it('extracts removed node from deleteNode result', () => {
    const result = { success: true, nodeId: 'n1' };
    const changes = extractChanges('canvas.deleteNode', result, titles);
    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe('removed');
  });

  it('returns empty for unrecognized tools', () => {
    expect(extractChanges('unknown.tool', { foo: 1 }, titles)).toEqual([]);
  });

  it('returns empty for null result', () => {
    expect(extractChanges('canvas.addNode', null, titles)).toEqual([]);
  });
});
```

**Step 3: Run tests**

```bash
npx vitest run apps/desktop-renderer/src/components/canvas/commander/ArtifactPreview.test.tsx
```

**Step 4: Integrate ArtifactPreview into ToolCallCard**

In `ToolCallCard.tsx`, add after the tool result display (line 101), inside the expanded section:

```tsx
import { ArtifactPreview } from './ArtifactPreview.js';

// Inside the expanded section, after the result <pre>:
{toolCall.status === 'done' && toolCall.result !== undefined && (
  <ArtifactPreview
    toolName={toolCall.name}
    result={toolCall.result}
    nodeTitlesById={nodeTitlesById}
    onNodeClick={onNodeClick}
  />
)}
```

Add `onNodeClick` to `ToolCallCardProps`:
```tsx
export interface ToolCallCardProps {
  toolCall: { ... };
  nodeTitlesById: Record<string, string>;
  t: (key: string) => string;
  onNodeClick?: (nodeId: string) => void;
}
```

Thread `onNodeClick` from `MessageList` to `ToolCallCard`.

**Step 5: Run full test suite**

```bash
npx vitest run apps/desktop-renderer/src/components/canvas/commander/
```

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: add artifact change preview in ToolCallCard after mutations"
```

---

## Task 7: Clean up old markdown.ts (deprecate)

**Files:**
- Delete: `apps/desktop-renderer/src/components/canvas/commander/markdown.ts`
- Delete: `apps/desktop-renderer/src/components/canvas/commander/markdown.test.ts`

**Step 1: Search for any remaining usages of `renderMarkdown`**

```bash
grep -r "renderMarkdown\|from.*markdown\.js" apps/desktop-renderer/src/ --include="*.ts" --include="*.tsx"
```

If any remain, replace them with `<Markdown content={...} />`.

**Step 2: Delete old files**

```bash
rm apps/desktop-renderer/src/components/canvas/commander/markdown.ts
rm apps/desktop-renderer/src/components/canvas/commander/markdown.test.ts
```

**Step 3: Run full typecheck + tests**

```bash
cd apps/desktop-renderer && npx tsc --noEmit
npx vitest run apps/desktop-renderer/
```

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove deprecated regex-based renderMarkdown"
```

---

## Summary of Changes

| Task | What | Files | Effort |
|------|------|-------|--------|
| 1 | Install react-markdown ecosystem | package.json | 5 min |
| 2 | New `<Markdown>` component | Markdown.tsx, tests | 30 min |
| 3 | Replace renderMarkdown in MessageList | MessageList.tsx | 10 min |
| 4 | Node links (`node://` protocol) | Markdown, MessageList, CommanderPanel, CanvasWorkspace, system prompt | 45 min |
| 5 | Session search in HistoryPanel | HistoryPanel.tsx | 15 min |
| 6 | Artifact change preview | ArtifactPreview.tsx, ToolCallCard.tsx, tests | 30 min |
| 7 | Clean up old markdown.ts | delete 2 files | 5 min |

**Total estimated: ~2.5 hours**
