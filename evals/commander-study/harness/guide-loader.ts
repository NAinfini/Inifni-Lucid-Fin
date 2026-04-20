/**
 * Loads the same built-in prompt guides the renderer bundles via Vite ?raw
 * imports, but by reading the markdown off disk. Mirrors the BUILT_IN_SEEDS
 * table in `apps/desktop-renderer/src/store/slices/skillDefinitions.ts` —
 * keep the two in sync when seeds change (there is no CI check enforcing
 * this; the tradeoff is the harness stays Node-only, no Vite needed).
 *
 * Returns the shape that `commander-tool-deps.registerAllTools` wants:
 *   { id, name, content }[]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// harness/ -> commander-study/ -> scripts/ -> repo root
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

export interface PromptGuide {
  id: string;
  name: string;
  content: string;
}

interface SeedSpec {
  id: string;
  name: string;
  relPath: string;
}

const GUIDE_DIR = 'docs/ai-video-prompt-guide';
const SKILLS_DIR = 'docs/ai-skills/skills';
const WORKFLOWS_DIR = 'docs/ai-skills/workflows';

const BUILT_IN_SEEDS: SeedSpec[] = [
  // promptTemplate cohort
  { id: 'meta-prompt', name: 'Meta-Prompt (AI Instructor)', relPath: `${GUIDE_DIR}/00-meta-prompt.md` },
  { id: 'prompt-structure', name: 'Prompt Structure & Fundamentals', relPath: `${GUIDE_DIR}/01-prompt-structure.md` },
  { id: 'camera-composition', name: 'Camera & Composition', relPath: `${GUIDE_DIR}/02-camera-and-composition.md` },
  { id: 'lighting-atmosphere', name: 'Lighting & Atmosphere', relPath: `${GUIDE_DIR}/03-lighting-and-atmosphere.md` },
  { id: 'motion-emotion', name: 'Motion & Emotion', relPath: `${GUIDE_DIR}/04-motion-and-emotion.md` },
  { id: 'style-aesthetics', name: 'Style & Aesthetics', relPath: `${GUIDE_DIR}/05-style-and-aesthetics.md` },
  { id: 'workflow-methods', name: 'Workflow Methods', relPath: `${GUIDE_DIR}/06-workflow-methods.md` },
  { id: 'model-adaptation', name: 'Model-Specific Adaptation', relPath: `${GUIDE_DIR}/07-model-specific-adaptation.md` },
  { id: 'audio-prompting', name: 'Audio Prompting', relPath: `${GUIDE_DIR}/08-audio-prompting.md` },
  { id: 'style-transfer', name: 'Style Transfer', relPath: `${GUIDE_DIR}/09-style-transfer.md` },
  { id: 'shot-list-from-script', name: 'Shot List from Script', relPath: `${GUIDE_DIR}/10-shot-list-from-script.md` },
  { id: 'batch-re-prompt', name: 'Batch Re-Prompt', relPath: `${GUIDE_DIR}/11-batch-re-prompt.md` },
  { id: 'continuity-check', name: 'Continuity Check', relPath: `${GUIDE_DIR}/12-continuity-check.md` },
  { id: 'storyboard-export', name: 'Storyboard Export', relPath: `${GUIDE_DIR}/13-storyboard-export.md` },
  { id: 'video-clone', name: 'Video Clone & Scene Analysis', relPath: `${GUIDE_DIR}/15-video-clone.md` },
  { id: 'dual-prompt-strategy', name: 'Dual Prompt Strategy', relPath: `${GUIDE_DIR}/16-dual-prompt-strategy.md` },
  { id: 'emotion-voice-prompting', name: 'Emotion & Voice Prompting', relPath: `${GUIDE_DIR}/17-emotion-voice-prompting.md` },
  { id: 'lip-sync-workflow', name: 'Lip Sync Workflow', relPath: `${GUIDE_DIR}/18-lip-sync-workflow.md` },

  // workflowDefinitions cohort
  { id: 'wf-story-idea-to-video', name: 'Story Idea → Video', relPath: `${SKILLS_DIR}/wf-story-idea-to-video.md` },
  { id: 'wf-novel-to-video', name: 'Novel/Book → Video', relPath: `${SKILLS_DIR}/wf-novel-to-video.md` },
  { id: 'wf-video-clone', name: 'Video Clone → Remake', relPath: `${SKILLS_DIR}/wf-video-clone.md` },
  { id: 'wf-style-transfer', name: 'Style Transfer Across Shots', relPath: `${SKILLS_DIR}/wf-style-transfer.md` },
  { id: 'sk-reverse-prompt', name: 'Reverse Prompt Inference', relPath: `${SKILLS_DIR}/sk-reverse-prompt.md` },
  { id: 'sk-lip-sync', name: 'Lip Sync Video', relPath: `${SKILLS_DIR}/sk-lip-sync.md` },
  { id: 'sk-srt-import', name: 'SRT Subtitle Import', relPath: `${SKILLS_DIR}/sk-srt-import.md` },
  { id: 'sk-capcut-export', name: 'CapCut Export', relPath: `${SKILLS_DIR}/sk-capcut-export.md` },
  { id: 'sk-semantic-search', name: 'Semantic Asset Search', relPath: `${SKILLS_DIR}/sk-semantic-search.md` },
  { id: 'sk-multi-view', name: 'Multi-View Canvas Editing', relPath: `${SKILLS_DIR}/sk-multi-view.md` },

  // Commander workflow guides (Phase 4 trimmed)
  { id: 'workflow-style-transfer', name: 'Style Transfer (Commander)', relPath: `${WORKFLOWS_DIR}/style-transfer.md` },
  { id: 'workflow-shot-list', name: 'Shot List (Commander)', relPath: `${WORKFLOWS_DIR}/shot-list.md` },
  { id: 'workflow-continuity-check', name: 'Continuity Check + Batch Re-Prompt (Commander)', relPath: `${WORKFLOWS_DIR}/continuity-check.md` },
  { id: 'workflow-image-analyze', name: 'Image Analyze (Commander)', relPath: `${WORKFLOWS_DIR}/image-analyze.md` },
  { id: 'workflow-audio-production', name: 'Audio Production — Voice + Lip Sync (Commander)', relPath: `${WORKFLOWS_DIR}/audio-production.md` },
  { id: 'workflow-story-to-video', name: 'Story to Video (Commander)', relPath: `${WORKFLOWS_DIR}/story-to-video.md` },
  { id: 'workflow-style-plate', name: 'Style Plate Lock (Commander)', relPath: `${WORKFLOWS_DIR}/style-plate.md` },
];

export function loadBuiltinPromptGuides(): PromptGuide[] {
  const out: PromptGuide[] = [];
  for (const seed of BUILT_IN_SEEDS) {
    const abs = path.join(REPO_ROOT, seed.relPath);
    if (!fs.existsSync(abs)) {
      // Fail loud — a missing file means the harness is out of sync with
      // the renderer seeds (rename / refactor in docs/).
      throw new Error(`Built-in guide missing on disk: ${abs}`);
    }
    out.push({ id: seed.id, name: seed.name, content: fs.readFileSync(abs, 'utf8') });
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('guide-loader.ts')) {
  const guides = loadBuiltinPromptGuides();
  console.log(`Loaded ${guides.length} built-in guides:`);
  for (const g of guides) {
    console.log(`  ${g.id.padEnd(32)} ${g.content.length.toString().padStart(6)} chars  ${g.name}`);
  }
}
