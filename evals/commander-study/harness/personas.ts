/**
 * 50 persona definitions — the fake "users" the harness drives. Each persona
 * is a (archetype, goal, opener, follow-ups) quadruple.
 *
 * - archetype is a loose bucket for aggregate reporting.
 * - opener is the literal first message sent via `commander:chat`.
 * - followUps get pushed into the next user turn whenever Commander calls
 *   `commander.askUser`. If the follow-up list runs out, the harness picks
 *   a generic "You decide, I trust you." reply so the session keeps moving.
 *
 * Intentionally diverse: monolingual/bilingual (en + zh), short/long,
 * story/concept/clone/docs/ad, high-detail/hand-wave. The goal is to
 * surface mode-specific bugs: does shot-list run when opener is ambiguous?
 * Does style-plate auto-lock when user gives nothing? etc.
 */

export interface Persona {
  index: number;
  archetype: string;
  /** A short tag for the run log (also used in filenames). */
  slug: string;
  /** The literal first user message sent to Commander. */
  opener: string;
  /** FIFO queue of replies for when Commander calls `commander.askUser`. */
  followUps: string[];
}

const TEMPLATES: Array<Omit<Persona, 'index'>> = [
  // === story-first (10) ===
  { archetype: 'story', slug: 'cyberpunk-neon-short',
    opener: 'Make me a 45-second cyberpunk short: lone courier runs across neon rooftops, ends on a rooftop confrontation. 9:16 vertical. High-contrast neon.',
    followUps: ['Use Flux for images. Keep 2 characters: courier + pursuer.', 'Yes use a style-plate.', 'OK render.', 'You decide.'] },
  { archetype: 'story', slug: 'cozy-cafe-romance',
    opener: "A two-shot romance opener: couple meets in a rainy Seoul cafe. Want a 'before sunrise' vibe, warm lighting, 16:9 cinematic.",
    followUps: ['Two characters, no names yet.', 'Use a warm pastel style-plate.', 'Skip audio for now.', 'You choose.'] },
  { archetype: 'story', slug: 'kaiju-attack-trailer',
    opener: 'I want a 60s kaiju attack trailer. Tokyo skyline at dusk, monster breaches bay. Cinematic letterbox. Guide me through it.',
    followUps: ['Follow whatever workflow you suggest.', 'Yes use existing shot templates.', 'Generate stills first, videos later.', 'You decide.'] },
  { archetype: 'story', slug: 'fantasy-village-intro',
    opener: "Fantasy village intro scene. 8 shots. Establishing crane shot -> market walkabout -> villain arrival -> villagers scatter -> hero draws weapon. 16:9.",
    followUps: ['Characters: hero (young, scarred), villain (cloaked).', 'Villages medieval European.', 'Use a dark/ominous style plate.', 'You choose.'] },
  { archetype: 'story', slug: 'sci-fi-dream-sequence',
    opener: 'Surreal sci-fi dream sequence. Girl walks through corridors that bend gravity. 30 seconds. MC Escher vibe. 16:9.',
    followUps: ['One character: girl in white.', 'Yes style-plate: muted grayscale.', 'Long takes, minimal cuts.', 'You decide.'] },
  { archetype: 'story', slug: 'western-duel-climax',
    opener: 'Duel scene climax. Two gunslingers. Dusty western town. 20 seconds. Heavy close-ups on eyes, boots, hands, holster. Then wide + gunshot. 2.39:1.',
    followUps: ['Characters: grizzled veteran vs young upstart.', 'Style-plate: sergio leone.', 'Leave audio out.', 'Your call.'] },
  { archetype: 'story', slug: 'zh-horror-tale',
    opener: '做一个45秒的中式恐怖短片，废弃筒子楼，主角听见楼道脚步声，最后揭示镜子里没有倒影。9:16。',
    followUps: ['一个角色：主角。', '冷色调风格卡。', '先出分镜，稍后生成。', '你决定。'] },
  { archetype: 'story', slug: 'zh-fantasy-opener',
    opener: '我要做一个仙侠剧的开场，主角在山顶御剑而立，天雷劈下，他不躲。16:9，电影感。',
    followUps: ['两个角色：主角 + 对立面。', '用一个冷青色风格卡。', '按工作流走。', '你安排。'] },
  { archetype: 'story', slug: 'historical-documentary',
    opener: "Docu-style: Ming dynasty ship sets sail from Nanjing, 1405. Treasure fleet. 8 shots, documentary narration planned. 16:9.",
    followUps: ['One character: Zheng He.', 'Period-accurate style plate.', 'Yes add voice-over slot.', 'You pick.'] },
  { archetype: 'story', slug: 'noir-detective-open',
    opener: 'Black-and-white noir opener: detective in office, rain streaks down blinds. Venetian blind shadows. 2.39:1. Monologue planned.',
    followUps: ['One character: detective.', 'Pure B&W style plate.', 'Include voice-over slot.', 'You decide.'] },

  // === vague / exploratory (10) ===
  { archetype: 'exploratory', slug: 'i-dont-know-yet',
    opener: "I don't really know what I want yet. Can you help me brainstorm a short video idea?",
    followUps: ['Surprise me. Anything cinematic.', 'OK pick one and run with it.', 'Keep it under 60s.', 'You decide.'] },
  { archetype: 'exploratory', slug: 'first-time',
    opener: 'First time opening this app. What can I do here?',
    followUps: ['OK, a short story. Whatever you think is easy.', 'Yes, go ahead and create it.', 'Use defaults.', 'You decide.'] },
  { archetype: 'exploratory', slug: 'vague-brief',
    opener: 'Cool vibe. Futuristic but warm. ~30 seconds.',
    followUps: ['You pick the story.', 'Yes, any style.', 'Auto providers.', 'You decide.'] },
  { archetype: 'exploratory', slug: 'one-word',
    opener: 'Dragons.',
    followUps: ['Yes make a short video.', 'You pick.', 'Keep going.', 'You decide.'] },
  { archetype: 'exploratory', slug: 'emoji-only',
    opener: '🌆🚗💨✨',
    followUps: ['Interpret it however.', 'Yes go ahead.', 'Defaults fine.', 'You decide.'] },
  { archetype: 'exploratory', slug: 'zh-vague',
    opener: '帮我做点视频吧，主题随便。',
    followUps: ['你选。', '好，按工作流来。', '默认就行。', '你定。'] },
  { archetype: 'exploratory', slug: 'ask-for-menu',
    opener: 'What kinds of projects can I do here? Give me 3 options and pick the best.',
    followUps: ['Go with your top pick.', 'Yes proceed.', 'You decide details.', 'You decide.'] },
  { archetype: 'exploratory', slug: 'unsure-style',
    opener: 'I have a story idea but no visual style. Help me find one.',
    followUps: ["Story: lonely astronaut on abandoned Mars base.", 'Pick any style.', 'Lock it in.', 'You decide.'] },
  { archetype: 'exploratory', slug: 'skip-to-end',
    opener: "Skip to the end. What's the fastest way to render a 10-second video?",
    followUps: ['Any subject.', 'Yes defaults.', 'Render.', 'You decide.'] },
  { archetype: 'exploratory', slug: 'lost-in-canvas',
    opener: "I opened the canvas but I don't know what the nodes are. Explain then make one.",
    followUps: ['OK teach me by doing.', 'Any story.', 'Default providers.', 'You decide.'] },

  // === power-user / specific (10) ===
  { archetype: 'power', slug: 'shot-list-first',
    opener: "I have a 12-line shot list. Paste it in, create nodes for each shot, set a consistent style-plate, then let me review before generating.",
    followUps: ['Shot list: wide exterior dawn / tight hero face / OTS on villain / chase / crash / aftermath / eulogy / title card / flashback / memorial / walk-away / FIN.',
               'Style-plate: gritty urban realism.',
               'Yes, connect them in sequence.',
               'Hold off on generate.'] },
  { archetype: 'power', slug: 'script-to-canvas',
    opener: "I have a fountain-format script (3 scenes). I want to import it and auto-generate nodes by shot template.",
    followUps: ['Scene 1: INT. CAFE - DAY. Two characters meet. Scene 2: EXT. STREET. They argue. Scene 3: INT. APARTMENT - NIGHT. Reconciliation.',
               'Apply default shot templates.',
               'Yes one style-plate across all.',
               'Review before render.'] },
  { archetype: 'power', slug: 'batch-reprompt',
    opener: "I already have 8 image nodes but their prompts are inconsistent. Please batch re-prompt with a single style reference.",
    followUps: ['Reference node: node-0 (the first one in the chain).',
               'Apply to nodes 1-7.',
               'Diff summary before committing.',
               'Commit.'] },
  { archetype: 'power', slug: 'style-transfer-setup',
    opener: "Set up a style-transfer workflow: ref image -> 6 target nodes, all inheriting the ref's palette and lighting.",
    followUps: ['Ref node: use first node as ref.',
               'Apply to 6 new image nodes.',
               'Use the style-transfer guide.',
               'You pick providers.'] },
  { archetype: 'power', slug: 'character-lock-then-shots',
    opener: "Create 3 characters, generate ref images for each, THEN create 10 shot nodes referencing them.",
    followUps: ['Characters: Lina (courier, 28), Mara (her sister, 24), Kade (antagonist, 35).',
               'Style-plate: neon noir.',
               'Yes after refs, create 10 shots linking Lina + Kade.',
               'Skip render.'] },
  { archetype: 'power', slug: 'location-consistency',
    opener: "I'm worried about location consistency across 12 shots. Lock 2 locations with ref images, then create shots referencing them.",
    followUps: ['Locations: Neo-Tokyo alley, rooftop garden.',
               'Style-plate: rain-soaked cyberpunk.',
               'Create 12 shots distributed.',
               'Hold render.'] },
  { archetype: 'power', slug: 'zh-batch-style',
    opener: "我已经有一批镜头节点，希望统一风格。用 style-transfer 流程处理一下。",
    followUps: ['用第一个节点当参考。',
               '全部已有节点应用。',
               '先预览差异。',
               '确认。'] },
  { archetype: 'power', slug: 'continuity-audit',
    opener: "Audit my existing canvas for continuity problems. I just imported a bunch of shots and I'm sure some don't match.",
    followUps: ['Use the continuity-check workflow.',
               'Flag anything that drifts on character or lighting.',
               'Suggest fixes.',
               'Apply fixes.'] },
  { archetype: 'power', slug: 'preset-remix',
    opener: "List all shot templates + presets you have, then design a remix of 3 presets into a new one for my 'rainy noir rooftop' look.",
    followUps: ['Combine ominous + low-key-lighting + rain-atmos.',
               'Save as a new preset.',
               'Apply to a new image node.',
               'You choose provider.'] },
  { archetype: 'power', slug: 'voice-lip-pipeline',
    opener: "I want a voice + lip-sync pipeline: generate 3 audio takes, then drive lip-sync on a character video node.",
    followUps: ['Character: Lina, voice-over line "I won\'t do this again."',
               'Three tone variants: weary, defiant, resigned.',
               'Use lip-sync workflow after.',
               'You pick providers.'] },

  // === edge / abuse (10) ===
  { archetype: 'edge', slug: 'empty-opener',
    opener: '.',
    followUps: ['No project yet, just wanted to see what happens.', 'OK make something anyway.', 'You decide.', 'You decide.'] },
  { archetype: 'edge', slug: 'very-long-opener',
    opener: 'I want a deeply layered narrative about a detective investigating a series of disappearances in a small coastal town. The detective has a tragic past. The town has secrets. There is a lighthouse. There is fog. There is a mysterious stranger. There are nightmares. There are dead birds on the beach. There are whispers in the church. There are ghosts in the hotel. There are visions in the cliffs. There are confessions in the harbor. There are confrontations in the woods. There are revelations in the basement. There are endings in the sea. Make me a 3-minute teaser.',
    followUps: ['Trim to the 6 strongest shots.', 'Coastal-noir style-plate.', 'Generate stills only.', 'You decide.'] },
  { archetype: 'edge', slug: 'conflict-asks',
    opener: 'Make a 2-minute horror and a 30-second comedy, same canvas, tell me which to render first.',
    followUps: ['Let the agent decide.', 'Use separate style plates.', 'Render horror first.', 'You decide.'] },
  { archetype: 'edge', slug: 'no-time-budget',
    opener: "I have 2 minutes. What can you actually give me?",
    followUps: ['Any subject.', 'Skip custom providers.', 'Go fastest path.', 'Render.'] },
  { archetype: 'edge', slug: 'skip-style-plate',
    opener: "Build me a 5-shot sequence but don't bother with a style-plate, I don't care about consistency.",
    followUps: ['No style-plate.', 'Yes generate.', 'Skip review.', 'You pick.'] },
  { archetype: 'edge', slug: 'delete-everything',
    opener: "Wipe the canvas and start fresh with 3 new image nodes about a lonely lighthouse.",
    followUps: ['Yes wipe.', 'Lighthouse at dawn, at dusk, at storm.', 'Style-plate: weathered realism.', 'Generate.'] },
  { archetype: 'edge', slug: 'rapid-fire-changes',
    opener: "Make a fantasy scene. Actually, make it sci-fi. Actually make it a cooking video. Pick whichever, you decide.",
    followUps: ['Your pick.', 'Go.', 'Finish.', 'You decide.'] },
  { archetype: 'edge', slug: 'zh-confusing',
    opener: '先给我做3个图片节点关于一只猫，再删掉其中第二个，然后把第一个和第三个连起来。',
    followUps: ['用默认风格。', '确认。', '完成。', '你决定。'] },
  { archetype: 'edge', slug: 'ask-for-undocumented',
    opener: "Export my canvas as a CapCut project. Also import an SRT file I don't have yet.",
    followUps: ['Export whatever canvas exists.', "Skip the SRT since I don't have one.", 'Proceed.', 'You decide.'] },
  { archetype: 'edge', slug: 'refuse-everything',
    opener: "Make a short video.",
    followUps: ['No.', 'No.', 'Just do whatever.', 'You decide.'] },

  // === docs / tutorial (5) ===
  { archetype: 'docs', slug: 'explain-workflow',
    opener: "Before making anything, walk me through what the workflow-orchestration guide expects me to do.",
    followUps: ['OK now demonstrate it with a tiny project.', 'Style-plate: any.', 'Generate one shot.', 'You decide.'] },
  { archetype: 'docs', slug: 'what-is-style-plate',
    opener: "What's a style plate and why do I need one? Show me by locking one on a fresh canvas.",
    followUps: ['Lock one for a misty-forest-at-dawn look.', 'Apply to 2 new image nodes.', 'Generate.', 'You decide.'] },
  { archetype: 'docs', slug: 'tool-inventory',
    opener: "List every tool you can call and group them by category.",
    followUps: ['Now use the canvas ones to build a tiny project.', 'Style-plate: minimal.', 'Generate 1 node.', 'You decide.'] },
  { archetype: 'docs', slug: 'preset-inventory',
    opener: "List every preset + shot template and demo one of each.",
    followUps: ['Pick a cinematic preset and a wide-shot template.', 'Apply to a new node.', 'Generate.', 'You decide.'] },
  { archetype: 'docs', slug: 'what-went-wrong',
    opener: "Nothing is rendering. Can you help me diagnose what's missing?",
    followUps: ['Yes check providers.', 'Yes check logs.', 'Fix whatever you can.', 'You decide.'] },

  // === ads / marketing (5) ===
  { archetype: 'ad', slug: 'product-hero-shot',
    opener: "15-second product hero shot: luxury watch on rotating display, soft gradient backdrop, macro detail pass, end on logo.",
    followUps: ['Style: product-cinema.', '3 shots: detail, wide, logo.', 'Generate.', 'You pick.'] },
  { archetype: 'ad', slug: 'food-ad',
    opener: "Noodle bowl ad. Steam rises, chopsticks pull noodles out. Warm studio lighting. 9:16 for social.",
    followUps: ['Style: food-studio.', '4 shots: wide, close, pull, logo.', 'Generate.', 'You pick.'] },
  { archetype: 'ad', slug: 'car-commercial-teaser',
    opener: "EV teaser ad, 20 seconds. Car on empty salt flats at dawn, silent, then sudden acceleration. 16:9 cinematic.",
    followUps: ['Style: minimalist commercial.', '5 shots.', 'Generate.', 'You pick.'] },
  { archetype: 'ad', slug: 'fashion-lookbook',
    opener: "Fashion lookbook, 30 seconds. 6 outfits, fast cuts, strong color-blocking. 9:16.",
    followUps: ['Style: editorial fashion.', '6 shots.', 'Generate stills only.', 'You pick.'] },
  { archetype: 'ad', slug: 'zh-brand-ad',
    opener: "为某国产新能源汽车拍一个20秒品牌 teaser，硬派工业风，16:9。",
    followUps: ['5 shots。', '工业金属风格卡。', '生成图。', '你定。'] },
];

export function buildPersonas(): Persona[] {
  return TEMPLATES.map((t, i) => ({ index: i, ...t }));
}

// CLI: dump the persona table for eyeballing.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('personas.ts')) {
  const personas = buildPersonas();
  console.log(`${personas.length} personas:`);
  const byArch: Record<string, number> = {};
  for (const p of personas) {
    byArch[p.archetype] = (byArch[p.archetype] ?? 0) + 1;
  }
  for (const [k, n] of Object.entries(byArch)) console.log(`  ${k.padEnd(14)} ${n}`);
  console.log('');
  for (const p of personas) {
    console.log(`  [${String(p.index).padStart(2)}] ${p.archetype.padEnd(14)} ${p.slug.padEnd(26)} ${p.opener.slice(0, 60).replace(/\n/g, ' ')}${p.opener.length > 60 ? '...' : ''}`);
  }
}
