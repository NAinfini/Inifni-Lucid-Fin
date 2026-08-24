/** Remove provider reasoning traces before any Markdown fallback or renderer sees them. */
export function publicMarkdownContent(raw: string): string {
  const withoutClosedBlocks = raw.replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/gi, '');
  const unfinishedBlock = withoutClosedBlocks.search(/<think\b[^>]*>/i);
  return unfinishedBlock >= 0 ? withoutClosedBlocks.slice(0, unfinishedBlock) : withoutClosedBlocks;
}
