/**
 * Prompt injection sanitization for user-controlled strings interpolated
 * into AI prompts.
 *
 * ---- Threat Model ----
 *
 * This is a desktop app (Electron). The primary risk is NOT web attacks
 * (XSS, CSRF) but prompt injection — user-controlled strings that, when
 * interpolated into AI prompts, could:
 *
 *   1. Override system instructions via role-marker injection
 *   2. Break template delimiter boundaries
 *   3. Confuse multi-turn prompt structure
 *   4. Use unicode tricks to bypass naive filters
 *
 * ---- Attack Surfaces (user-controlled inputs interpolated into prompts) ----
 *
 * | Surface                  | Risk   | Rationale                                |
 * |--------------------------|--------|------------------------------------------|
 * | Character names          | High   | Short strings interpolated into system   |
 * |                          |        | prompts; easy to craft                   |
 * | Character descriptions   | High   | Long free-text; full user control;       |
 * |                          |        | multi-line allows role-switching          |
 * | Character face/hair/body | Medium | Structured fields, but still free-text   |
 * | Preset names             | Medium | Short, but in template context           |
 * | Equipment/location names | Medium | Interpolated into world-building prompts |
 * | Equipment descriptions   | Medium | Free-text fields in prompt context       |
 * | Location descriptions    | Medium | Free-text fields in prompt context       |
 * | Canvas node prompt text  | High   | Direct user input, primary prompt field  |
 * | Connected text content   | High   | User-edited text nodes wired into prompt |
 * | File/asset names         | Low    | Limited interpolation points             |
 * | Style parameter values   | Low    | Usually Zod-validated before reaching    |
 * |                          |        | prompt compiler                          |
 *
 * ---- System-controlled inputs (no sanitization needed) ----
 *
 * | Input                    | Why safe                                      |
 * |--------------------------|-----------------------------------------------|
 * | Preset prompt templates  | Author-defined, not user-editable             |
 * | System prompt text       | Hardcoded in codebase                         |
 * | Layout instructions      | Hardcoded in ref-image prompt builders        |
 * | Intensity words          | Derived from numeric values                   |
 * | Direction phrases        | Enum-mapped, not user-controlled              |
 *
 * ---- Design philosophy ----
 *
 * This sanitizer is intentionally soft. It WARNS on suspicious patterns
 * but does not hard-block, because:
 *   - Users may have legitimate creative reasons for unusual text
 *   - This is a creative filmmaking tool, not a security-critical API
 *   - Over-aggressive filtering damages legitimate content
 *
 * The sanitizer:
 *   1. Strips role-switching markers that could confuse multi-turn prompts
 *   2. Escapes template delimiters that could break interpolation
 *   3. Collapses multi-line injection attempts
 *   4. Strips unicode control characters (zero-width, RTL overrides)
 *   5. Enforces a maximum length to prevent prompt stuffing
 *   6. Returns a warning flag so callers can log without blocking
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum character length for sanitized prompt segments. Generous enough
 * for detailed creative descriptions but prevents prompt-stuffing attacks
 * that try to overwhelm the model's context window.
 */
const DEFAULT_MAX_LENGTH = 2000;

/**
 * Role markers that, when found at the start of a line or after a newline,
 * could trick the AI into treating user content as a role switch.
 * Matched case-insensitively.
 */
const ROLE_MARKER_PATTERN = /(?:^|\n)\s*(?:system|user|assistant|human|ai|claude|gpt|model)\s*:/gi;

/**
 * Instruction-override patterns — phrases commonly used in prompt injection
 * to override the system prompt. Matched case-insensitively.
 */
const INSTRUCTION_OVERRIDE_PATTERNS = [
  /ignore\s+(?:all\s+)?(?:previous|prior|above|earlier)\s+instructions/gi,
  /disregard\s+(?:all\s+)?(?:previous|prior|above|earlier)\s+instructions/gi,
  /forget\s+(?:all\s+)?(?:previous|prior|above|earlier)\s+instructions/gi,
  /override\s+(?:system|safety|all)\s+(?:prompt|instructions|rules)/gi,
  /you\s+are\s+now\s+(?:a|an|in)\s+/gi,
  /new\s+(?:system\s+)?instructions?\s*:/gi,
  /\[(?:system|INST|SYS)\]/gi,
  /<<\s*(?:SYS|INST)\s*>>/gi,
  /\bBEGIN\s+(?:SYSTEM|INSTRUCTIONS?)\b/gi,
  /\bEND\s+(?:SYSTEM|INSTRUCTIONS?)\b/gi,
];

/**
 * Template delimiter patterns that could break template interpolation.
 * The prompt compiler uses `{key}` for substitution; `{{`, `}}`, `{%`, `%}`
 * are Jinja/Mustache-style delimiters used by some LLM frameworks.
 */
const TEMPLATE_DELIMITER_PATTERN = /\{\{|\}\}|\{%|%\}|\{#|#\}/g;

/**
 * Unicode control characters and formatting marks that serve no legitimate
 * purpose in creative text but can be used to bypass pattern matching.
 *
 * Includes:
 * - Zero-width space (U+200B)
 * - Zero-width non-joiner (U+200C)
 * - Zero-width joiner (U+200D)
 * - Left-to-right mark (U+200E)
 * - Right-to-left mark (U+200F)
 * - Left-to-right embedding (U+202A)
 * - Right-to-left embedding (U+202B)
 * - Pop directional formatting (U+202C)
 * - Left-to-right override (U+202D)
 * - Right-to-left override (U+202E)
 * - Word joiner (U+2060)
 * - Function application (U+2061)
 * - Invisible times (U+2062)
 * - Invisible separator (U+2063)
 * - Invisible plus (U+2064)
 * - Zero-width no-break space / BOM (U+FEFF)
 * - Soft hyphen (U+00AD)
 * - Object replacement character (U+FFFC)
 * - Interlinear annotation anchor/separator/terminator (U+FFF9-FFFB)
 * - ASCII control chars (U+0000-U+0008, U+000B, U+000C, U+000E-U+001F)
 *
 * Built with explicit unicode escapes to avoid embedding literal invisible
 * characters in source (which triggers ESLint no-irregular-whitespace).
 */
const UNICODE_CONTROL_PATTERN = buildUnicodeControlPattern();

function buildUnicodeControlPattern(): RegExp {
  // Build character class from explicit codepoint ranges to avoid
  // embedding invisible characters in source (ESLint no-irregular-whitespace).
  const ranges: Array<[number, number] | [number]> = [
    [0x200b, 0x200f], // zero-width spaces + LTR/RTL marks
    [0x202a, 0x202e], // LTR/RTL embedding/override
    [0x2060, 0x2064], // word joiner + invisible operators
    [0xfeff], // BOM / zero-width no-break space
    [0x00ad], // soft hyphen
    [0xfffc], // object replacement character
    [0xfff9, 0xfffb], // interlinear annotation
    [0x0000, 0x0008], // ASCII control (NUL-BS)
    [0x000b], // vertical tab
    [0x000c], // form feed
    [0x000e, 0x001f], // ASCII control (SO-US)
  ];
  let charClass = '';
  for (const range of ranges) {
    if (range.length === 1) {
      charClass += String.fromCodePoint(range[0]);
    } else {
      charClass += String.fromCodePoint(range[0]) + '-' + String.fromCodePoint(range[1]);
    }
  }
  return new RegExp('[' + charClass + ']', 'g');
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SanitizeResult {
  /** The sanitized string, safe for interpolation into AI prompts. */
  text: string;
  /**
   * True if any suspicious patterns were detected. Callers should log a
   * warning but should NOT block the operation — users may have legitimate
   * creative reasons for the flagged content.
   */
  wasSuspicious: boolean;
  /** Human-readable descriptions of what was detected (for logging). */
  warnings: string[];
}

export interface SanitizeOptions {
  /** Maximum character length. Defaults to 2000. */
  maxLength?: number;
  /**
   * Label for the input surface (e.g. "character name", "location description").
   * Used in warning messages for clearer logging.
   */
  label?: string;
}

// ---------------------------------------------------------------------------
// Core sanitizer
// ---------------------------------------------------------------------------

/**
 * Sanitize a user-controlled string before interpolation into an AI prompt.
 *
 * Returns the sanitized text plus diagnostic info. Does NOT throw or block.
 *
 * @example
 * ```ts
 * const result = sanitizeForPrompt(userInput, { label: 'character name' });
 * if (result.wasSuspicious) {
 *   log.warn('Suspicious prompt input detected', { warnings: result.warnings });
 * }
 * const safeText = result.text;
 * ```
 */
export function sanitizeForPrompt(input: string, options?: SanitizeOptions): SanitizeResult {
  const maxLength = options?.maxLength ?? DEFAULT_MAX_LENGTH;
  const label = options?.label ?? 'input';
  const warnings: string[] = [];
  let text = input;

  // 1. Strip unicode control characters (invisible manipulation)
  {
    UNICODE_CONTROL_PATTERN.lastIndex = 0;
    if (UNICODE_CONTROL_PATTERN.test(text)) {
      warnings.push(`${label}: unicode control characters stripped`);
      UNICODE_CONTROL_PATTERN.lastIndex = 0;
      text = text.replace(UNICODE_CONTROL_PATTERN, '');
    }
  }

  // 2. Detect and strip role-switching markers
  {
    ROLE_MARKER_PATTERN.lastIndex = 0;
    if (ROLE_MARKER_PATTERN.test(text)) {
      warnings.push(`${label}: role-switching markers detected and neutralized`);
      ROLE_MARKER_PATTERN.lastIndex = 0;
      text = text.replace(ROLE_MARKER_PATTERN, (match) => {
        // Preserve the leading whitespace/newline but replace the marker
        // with a neutralized version that won't be interpreted as a role switch.
        const leadingWs = match.match(/^[\n\s]*/)?.[0] ?? '';
        const markerContent = match.slice(leadingWs.length);
        // Remove the colon so it reads as plain text, not a role directive
        return leadingWs + markerContent.replace(/:$/, '');
      });
    }
  }

  // 3. Detect and warn on instruction-override patterns
  for (const pattern of INSTRUCTION_OVERRIDE_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      warnings.push(`${label}: instruction-override pattern detected and neutralized`);
      pattern.lastIndex = 0;
      // Insert a tilde in the middle of the match to prevent the AI from
      // interpreting it as a coherent directive, while keeping the text
      // readable for the user.
      text = text.replace(pattern, (match) => {
        const mid = Math.floor(match.length / 2);
        return match.slice(0, mid) + '~' + match.slice(mid);
      });
      break; // One warning is enough; we process all patterns
    }
  }

  // Re-check remaining patterns (the first break only skips warnings)
  for (const pattern of INSTRUCTION_OVERRIDE_PATTERNS) {
    pattern.lastIndex = 0;
    text = text.replace(pattern, (match) => {
      const mid = Math.floor(match.length / 2);
      return match.slice(0, mid) + '~' + match.slice(mid);
    });
  }

  // 4. Escape template delimiters
  //    Apply repeatedly until no more double-delimiters remain (handles
  //    nested cases like `{{{{nested}}}}`).
  {
    let hadDelimiters = false;
    let iterations = 0;
    const MAX_DELIMITER_PASSES = 5;
    while (iterations < MAX_DELIMITER_PASSES) {
      TEMPLATE_DELIMITER_PATTERN.lastIndex = 0;
      if (!TEMPLATE_DELIMITER_PATTERN.test(text)) break;
      hadDelimiters = true;
      TEMPLATE_DELIMITER_PATTERN.lastIndex = 0;
      text = text.replace(TEMPLATE_DELIMITER_PATTERN, (match) => {
        // Replace double-braces with single braces, which are harmless
        // in the prompt compiler's `{key}` substitution system.
        if (match === '{{') return '{';
        if (match === '}}') return '}';
        // Other delimiters (Jinja/Mustache) -> strip entirely
        return '';
      });
      iterations++;
    }
    if (hadDelimiters) {
      warnings.push(`${label}: template delimiters escaped`);
    }
  }

  // 5. Collapse excessive newlines (multi-line injection vector)
  // Allow up to 2 consecutive newlines (paragraph break) but collapse
  // anything beyond that. This prevents creating visual separation that
  // might trick the AI into treating content as a new section.
  {
    const before = text;
    text = text.replace(/\n{3,}/g, '\n\n');
    if (text !== before) {
      warnings.push(`${label}: excessive newlines collapsed`);
    }
  }

  // 6. Trim to maximum length
  if (text.length > maxLength) {
    warnings.push(`${label}: trimmed from ${text.length} to ${maxLength} characters`);
    text = text.slice(0, maxLength);
  }

  // 7. Final trim of leading/trailing whitespace
  text = text.trim();

  return {
    text,
    wasSuspicious: warnings.length > 0,
    warnings,
  };
}

/**
 * Convenience wrapper that returns only the sanitized string.
 * Use `sanitizeForPrompt` when you need the diagnostic warnings.
 */
export function sanitizePromptText(input: string, options?: SanitizeOptions): string {
  return sanitizeForPrompt(input, options).text;
}
