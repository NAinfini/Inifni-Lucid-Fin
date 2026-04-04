import type * as Monaco from 'monaco-editor';

export const FOUNTAIN_LANGUAGE_ID = 'fountain';

export function registerFountainLanguage(monaco: typeof Monaco): void {
  // Register the language
  monaco.languages.register({ id: FOUNTAIN_LANGUAGE_ID });

  // Set the tokenizer
  monaco.languages.setMonarchTokensProvider(FOUNTAIN_LANGUAGE_ID, {
    tokenizer: {
      root: [
        // Scene headings: INT. / EXT. / INT./EXT. at line start
        [/^(INT\.|EXT\.|INT\.\/EXT\.|I\/E\.).*$/m, 'keyword.scene'],
        // Transitions: TO: at end of line or > TRANSITION
        [/^>.*$/, 'keyword.transition'],
        [/^.*TO:$/m, 'keyword.transition'],
        // Character names: ALL CAPS line (before dialogue)
        [/^[A-Z][A-Z0-9 .\-']+(\s*\(.*\))?$/m, 'type.character'],
        // Parentheticals: (text in parens)
        [/^\(.*\)$/m, 'comment.parenthetical'],
        // Title page: Key: Value at start
        [/^(Title|Credit|Author|Source|Draft date|Contact|Copyright):.*$/m, 'annotation'],
        // Section headers: # ## ###
        [/^#{1,3}\s.*$/m, 'markup.heading'],
        // Synopsis: = text
        [/^=\s.*$/m, 'comment'],
        // Notes: [[text]]
        [/\[\[.*?\]\]/, 'comment.note'],
        // Emphasis: *italic* **bold** ***bold italic*** _underline_
        [/\*\*\*[^*]+\*\*\*/, 'markup.bold.italic'],
        [/\*\*[^*]+\*\*/, 'markup.bold'],
        [/\*[^*]+\*/, 'markup.italic'],
        [/_[^_]+_/, 'markup.underline'],
        // Page breaks
        [/^={3,}$/, 'delimiter'],
        // Centered: >text<
        [/^>.*<$/, 'string.centered'],
      ],
    },
  });

  // Define Fountain theme tokens for dark mode
  monaco.editor.defineTheme('fountain-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword.scene', foreground: '60A5FA', fontStyle: 'bold' }, // blue-400
      { token: 'keyword.transition', foreground: '818CF8', fontStyle: 'italic' }, // indigo-400
      { token: 'type.character', foreground: 'FBBF24', fontStyle: 'bold' }, // amber-400
      { token: 'comment.parenthetical', foreground: '94A3B8' }, // slate-400
      { token: 'annotation', foreground: '34D399' }, // emerald-400
      { token: 'markup.heading', foreground: 'F472B6', fontStyle: 'bold' }, // pink-400
      { token: 'comment', foreground: '6B7280', fontStyle: 'italic' }, // gray-500
      { token: 'comment.note', foreground: '6B7280', fontStyle: 'italic' },
      { token: 'markup.bold.italic', fontStyle: 'bold italic' },
      { token: 'markup.bold', fontStyle: 'bold' },
      { token: 'markup.italic', fontStyle: 'italic' },
      { token: 'markup.underline', fontStyle: 'underline' },
      { token: 'delimiter', foreground: '4B5563' },
      { token: 'string.centered', foreground: 'A78BFA' },
    ],
    colors: {
      'editor.background': '#0a0a0a',
      'editor.foreground': '#f2f2f2',
    },
  });
}
