import type { ParsedScene, DialogueLine } from '@lucid-fin/contracts';

const SCENE_HEADING = /^(INT\.|EXT\.|INT\/EXT\.|I\/E\.)[\s]+(.+?)(?:\s*[-–—]\s*(.+))?$/i;
const CHARACTER_CUE = /^([A-Z][A-Z0-9 .'-]+?)(?:\s*\((.+?)\))?$/;
const TRANSITION = /^(?:CUT TO|FADE TO|DISSOLVE TO|SMASH CUT TO|FADE OUT|FADE IN)[:\s]*.*$/i;
const PARENTHETICAL = /^\((.+)\)$/;

export function parseFountain(text: string): ParsedScene[] {
  const lines = text.split(/\r?\n/);
  const scenes: ParsedScene[] = [];
  let current: ParsedScene | null = null;
  let contentLines: string[] = [];
  let dialogueChar = '';
  let inDialogue = false;

  function flushScene() {
    if (current) {
      current.content = contentLines.join('\n').trim();
      current.characters = [...new Set(current.characters)];
      scenes.push(current);
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Scene heading
    const headingMatch = trimmed.match(SCENE_HEADING);
    if (headingMatch) {
      flushScene();
      const location = headingMatch[2].trim();
      const timeOfDay = headingMatch[3]?.trim() ?? '';
      current = {
        index: scenes.length,
        heading: trimmed,
        location,
        timeOfDay,
        content: '',
        characters: [],
        dialogue: [],
      };
      contentLines = [];
      inDialogue = false;
      continue;
    }

    if (!current) continue;

    // Transition — skip
    if (TRANSITION.test(trimmed)) {
      contentLines.push(trimmed);
      inDialogue = false;
      continue;
    }

    // Character cue (must be preceded by blank line)
    if (trimmed && !inDialogue) {
      const prevLine = i > 0 ? lines[i - 1].trim() : '';
      if (prevLine === '' && CHARACTER_CUE.test(trimmed) && !SCENE_HEADING.test(trimmed)) {
        const match = trimmed.match(CHARACTER_CUE);
        if (match) {
          dialogueChar = match[1].trim();
          current.characters.push(dialogueChar);
          inDialogue = true;
          contentLines.push(trimmed);
          continue;
        }
      }
    }

    // Parenthetical inside dialogue
    if (inDialogue && PARENTHETICAL.test(trimmed)) {
      contentLines.push(trimmed);
      continue;
    }

    // Dialogue line
    if (inDialogue && trimmed) {
      const parenthetical = PARENTHETICAL.test(lines[i - 1]?.trim() ?? '')
        ? lines[i - 1].trim().replace(/^\(|\)$/g, '')
        : undefined;
      const dl: DialogueLine = { character: dialogueChar, line: trimmed };
      if (parenthetical) dl.parenthetical = parenthetical;
      current.dialogue.push(dl);
      contentLines.push(trimmed);
      continue;
    }

    // Blank line ends dialogue
    if (inDialogue && !trimmed) {
      inDialogue = false;
    }

    contentLines.push(line);
  }

  flushScene();
  return scenes;
}

/**
 * Parse plaintext into a single scene (no Fountain structure).
 */
export function parsePlaintext(text: string): ParsedScene[] {
  if (!text.trim()) return [];
  return [
    {
      index: 0,
      heading: 'Scene 1',
      location: '',
      timeOfDay: '',
      content: text.trim(),
      characters: [],
      dialogue: [],
    },
  ];
}

/**
 * Auto-detect format and parse.
 */
export function parseScript(
  text: string,
  format: 'fountain' | 'fdx' | 'plaintext' = 'fountain',
): ParsedScene[] {
  if (format === 'plaintext') return parsePlaintext(text);
  // FDX support can be added later — for now treat as plaintext
  if (format === 'fdx') return parsePlaintext(text);
  return parseFountain(text);
}
