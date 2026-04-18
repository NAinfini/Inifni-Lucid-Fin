import { memo, useMemo, type ComponentPropsWithoutRef } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

const BLOCKED_PROTOCOLS = ['javascript:', 'data:', 'vbscript:', 'blob:'];

// Strip raw HTML tags that LLMs sometimes emit instead of Markdown.
const htmlTagRe = /<\/?[a-z][a-z0-9]*(?:\s[^>]*)?\/?>/gi;

// DeepSeek R1 reasoning traces: <think>...</think>
const thinkBlockRe = /<think>([\s\S]*?)<\/think>/gi;

// Allow node:// protocol in addition to react-markdown's default safe protocols.
function urlTransform(url: string): string {
  if (url.startsWith('node://')) return url;
  return defaultUrlTransform(url);
}

function preprocess(raw: string): { content: string; thinkBlocks: string[] } {
  const thinkBlocks: string[] = [];
  let content = raw.replace(thinkBlockRe, (_m, inner: string) => {
    thinkBlocks.push(inner.trim());
    return '';
  });
  content = content.replace(htmlTagRe, '');
  // Normalize literal escape sequences that come from JSX string attributes
  // (e.g. content="...\n..." passes backslash-n, not a real newline).
  content = content.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
  return { content: content.trim(), thinkBlocks };
}

function DefaultLinkRenderer({ href, children, ...props }: ComponentPropsWithoutRef<'a'>) {
  if (href) {
    const trimmed = href.trim().toLowerCase();
    if (BLOCKED_PROTOCOLS.some((p) => trimmed.startsWith(p))) {
      return <span>{children}</span>;
    }
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline" {...props}>
      {children}
    </a>
  );
}

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeKatex];

const baseComponents = {
  a: DefaultLinkRenderer,
  pre: (props: ComponentPropsWithoutRef<'pre'>) => (
    <pre className="commander-codeblock my-2 overflow-x-auto rounded-md bg-muted/50 p-3 text-xs" {...props} />
  ),
  code: ({ className, children, ...props }: ComponentPropsWithoutRef<'code'>) => {
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
  onNodeClick?: (nodeId: string) => void;
}

export default memo(function Markdown({ content, onNodeClick }: MarkdownProps) {
  const dynamicComponents = useMemo(() => {
    const nodeAwareLink = function NodeAwareLink({ href, children, ...props }: ComponentPropsWithoutRef<'a'>) {
      if (href?.startsWith('node://')) {
        const nodeId = href.slice(7);
        return (
          <button
            type="button"
            data-node-id={nodeId}
            className="text-primary underline decoration-dotted cursor-pointer hover:text-primary/80"
            onClick={() => onNodeClick?.(nodeId)}
          >
            {children}
          </button>
        );
      }
      return <DefaultLinkRenderer href={href} {...props}>{children}</DefaultLinkRenderer>;
    };
    return { ...baseComponents, a: nodeAwareLink };
  }, [onNodeClick]);

  if (!content) return null;

  const { content: cleaned, thinkBlocks } = preprocess(content);

  if (!cleaned && thinkBlocks.length === 0) return null;

  return (
    <div data-testid="markdown" className="commander-markdown min-w-0 break-words">
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
          urlTransform={urlTransform}
          components={dynamicComponents}
        >
          {cleaned}
        </ReactMarkdown>
      )}
    </div>
  );
});
