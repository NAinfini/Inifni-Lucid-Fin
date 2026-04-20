/**
 * Contract-drift lint.
 *
 * Goal: fail the build when the "Terminal commitment" prose in a workflow
 * guide (`docs/ai-skills/workflows/*.md`) disagrees with the declarative
 * contract registered under the same workflow id.
 *
 * Algorithm:
 *  1. Import every registered contract (the contract-registry barrel's
 *     side-effect imports do the heavy lifting).
 *  2. For each workflow id that has a matching guide file, extract the
 *     "## Terminal commitment" section from the guide markdown.
 *  3. Assert that every `requiredCommits[*].toolName` and
 *     `acceptableSubstitutes[*].toolName` appears literally in the guide
 *     section. (The reverse check — guide mentions ⊆ contract — is not
 *     enforced, because guides legitimately name tools in negative
 *     contexts like "never use `canvas.updateNodes` for lip-sync" or
 *     "verify via `canvas.getSettings`" that shouldn't be terminals.)
 *  4. On mismatch: print a readable diff and exit non-zero.
 *
 * Invoke via `npm run lint:contracts`. CI wires this into the main lint
 * pipeline; Phase D's commit also adds a pre-push hook note.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { contractRegistry } from '@lucid-fin/application';

// Map workflow contract id → guide file basename. Not every contract has a
// guide (info-answer is the fallback); those are skipped.
const GUIDE_BY_CONTRACT_ID: Record<string, string> = {
  'story-to-video': 'story-to-video.md',
  'style-plate': 'style-plate.md',
  'shot-list': 'shot-list.md',
  'continuity-check': 'continuity-check.md',
  'image-analyze': 'image-analyze.md',
  'audio-production': 'audio-production.md',
  'style-transfer': 'style-transfer.md',
};

interface DriftReport {
  contractId: string;
  guidePath: string;
  missingFromGuide: string[];
}

async function readTerminalCommitmentSection(guidePath: string): Promise<string | null> {
  const raw = await readFile(guidePath, 'utf-8');
  // Grab the text between `## Terminal commitment` and the next H2 (or EOF).
  // JS regex has no `\Z`; use `(?=^## |$(?![\s\S]))` to match either the next
  // H2 or end-of-string.
  const match = raw.match(
    /^## Terminal commitment\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m,
  );
  return match ? match[1] : null;
}

function extractToolNamesFromProse(section: string): Set<string> {
  const names = new Set<string>();
  // Pattern: dotted identifier like `canvas.batchCreate`. Backtick is the
  // canonical rendering in the guides.
  const reBacktick = /`([a-zA-Z]+(?:\.[a-zA-Z]+)+)`/g;
  for (let m: RegExpExecArray | null; (m = reBacktick.exec(section)); ) {
    names.add(m[1]);
  }
  return names;
}

async function main(): Promise<void> {
  const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..');
  const guideDir = path.join(repoRoot, 'docs/ai-skills/workflows');

  const reports: DriftReport[] = [];
  for (const contractId of contractRegistry.ids()) {
    const guideBasename = GUIDE_BY_CONTRACT_ID[contractId];
    if (!guideBasename) continue; // info-answer and other non-guided contracts.
    const contract = contractRegistry.get(contractId);
    if (!contract) continue;
    const guidePath = path.join(guideDir, guideBasename);
    const section = await readTerminalCommitmentSection(guidePath);
    if (!section) {
      reports.push({
        contractId,
        guidePath,
        missingFromGuide: [
          '(no "## Terminal commitment" section found in guide)',
        ],
      });
      continue;
    }

    const guideToolNames = extractToolNamesFromProse(section);
    const contractToolNames = new Set<string>();
    for (const c of contract.requiredCommits) contractToolNames.add(c.toolName);
    for (const c of contract.acceptableSubstitutes ?? []) {
      contractToolNames.add(c.toolName);
    }

    const missingFromGuide = [...contractToolNames].filter(
      (t) => !guideToolNames.has(t),
    );

    if (missingFromGuide.length > 0) {
      reports.push({
        contractId,
        guidePath,
        missingFromGuide,
      });
    }
  }

  if (reports.length === 0) {
    console.log('lint-contract-drift: OK — all contracts match their guides.');
    return;
  }

  console.error('lint-contract-drift: drift detected\n');
  for (const r of reports) {
    console.error(`- contract: ${r.contractId}`);
    console.error(`  guide:    ${path.relative(repoRoot, r.guidePath)}`);
    if (r.missingFromGuide.length > 0) {
      console.error(
        `  missing from guide prose: ${r.missingFromGuide.join(', ')}`,
      );
    }
    console.error('');
  }
  process.exitCode = 1;
}

main().catch((err) => {
  console.error('lint-contract-drift: crashed', err);
  process.exit(2);
});
