import { lazy, Suspense, memo } from 'react';

/**
 * Lazy-loaded Markdown wrapper.
 *
 * The actual renderer (`./MarkdownInner.tsx`) pulls in react-markdown,
 * remark-gfm, remark-math, rehype-katex, and the katex CSS — roughly
 * 500KB of transitive code that dominated the panel-commander chunk.
 * Splitting it behind `React.lazy` moves those deps into their own
 * chunk that loads on first render. Vite's chunking auto-extracts
 * markdown vendor code into a sibling chunk.
 *
 * Fallback is a simple pre-wrapped block so plain text still shows
 * during the ~tens-of-ms it takes to load the chunk from disk.
 */
const MarkdownInner = lazy(() => import('./MarkdownInner.js'));

interface MarkdownProps {
  content: string;
  onNodeClick?: (nodeId: string) => void;
}

function PlainFallback({ content }: { content: string }) {
  if (!content) return null;
  // Mirror the inner renderer's outer element (testid + wrap classes) so
  // layout tests that probe the panel while the real chunk is still
  // resolving don't flicker-fail, and so line-break/overflow styles
  // continue to apply to the fallback text.
  return (
    <div
      data-testid="markdown"
      className="commander-markdown min-w-0 break-words whitespace-pre-wrap"
    >
      {content}
    </div>
  );
}

export const Markdown = memo(function Markdown(props: MarkdownProps) {
  return (
    <Suspense fallback={<PlainFallback content={props.content} />}>
      <MarkdownInner {...props} />
    </Suspense>
  );
});
