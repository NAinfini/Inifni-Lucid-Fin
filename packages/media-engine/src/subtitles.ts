import { createCommand, runCommand } from './ffmpeg-utils.js';

export interface SubtitleCue {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
  style?: SubtitleStyle;
}

export interface SubtitleStyle {
  fontName?: string;
  fontSize?: number;
  primaryColor?: string;
  outlineColor?: string;
  bold?: boolean;
  italic?: boolean;
  alignment?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
}

// --- SRT ---

export function exportSRT(cues: SubtitleCue[]): string {
  return cues
    .sort((a, b) => a.startTime - b.startTime)
    .map((cue, i) => {
      const start = toSRTTime(cue.startTime);
      const end = toSRTTime(cue.endTime);
      return `${i + 1}\n${start} --> ${end}\n${cue.text}\n`;
    })
    .join('\n');
}

function toSRTTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${p2(h)}:${p2(m)}:${p2(s)},${String(ms).padStart(3, '0')}`;
}

// --- ASS (Advanced SubStation Alpha) ---

export function exportASS(cues: SubtitleCue[], videoWidth = 1920, videoHeight = 1080): string {
  let ass = `[Script Info]\nTitle: Lucid Fin Subtitles\nScriptType: v4.00+\n`;
  ass += `PlayResX: ${videoWidth}\nPlayResY: ${videoHeight}\n\n`;
  ass += `[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, Bold, Italic, Alignment, MarginL, MarginR, MarginV, Encoding\n`;
  ass += `Style: Default,Arial,48,&H00FFFFFF,&H00000000,0,0,2,20,20,20,1\n\n`;
  ass += `[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;

  for (const cue of cues.sort((a, b) => a.startTime - b.startTime)) {
    const start = toASSTime(cue.startTime);
    const end = toASSTime(cue.endTime);
    const styleName = cue.style ? 'Custom' : 'Default';
    const overrides = cue.style ? buildASSOverrides(cue.style) : '';
    ass += `Dialogue: 0,${start},${end},${styleName},,0,0,0,,${overrides}${cue.text.replace(/\n/g, '\\N')}\n`;
  }

  return ass;
}

function toASSTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.round((seconds % 1) * 100);
  return `${h}:${p2(m)}:${p2(s)}.${p2(cs)}`;
}

function buildASSOverrides(style: SubtitleStyle): string {
  const parts: string[] = [];
  if (style.fontName) parts.push(`\\fn${style.fontName}`);
  if (style.fontSize) parts.push(`\\fs${style.fontSize}`);
  if (style.bold) parts.push('\\b1');
  if (style.italic) parts.push('\\i1');
  if (style.alignment) parts.push(`\\an${style.alignment}`);
  if (style.primaryColor) parts.push(`\\c${style.primaryColor}`);
  if (style.outlineColor) parts.push(`\\3c${style.outlineColor}`);
  return parts.length > 0 ? `{${parts.join('')}}` : '';
}

// --- Burn-in via FFmpeg ---

export async function burnSubtitles(
  videoPath: string,
  subtitlePath: string,
  outputPath: string,
  options?: { codec?: 'h264' | 'h265'; fontDir?: string },
): Promise<void> {
  const codec = options?.codec ?? 'h264';
  const vcodec = codec === 'h265' ? 'libx265' : 'libx264';
  const subFilter = subtitlePath.endsWith('.ass')
    ? `ass='${subtitlePath.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`
    : `subtitles='${subtitlePath.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`;

  const fontsDir = options?.fontDir
    ? `:fontsdir='${options.fontDir.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`
    : '';

  const cmd = createCommand(videoPath)
    .videoCodec(vcodec)
    .addOutputOptions([`-vf ${subFilter}${fontsDir}`, '-crf 18', '-preset medium', '-c:a copy'])
    .output(outputPath);

  await runCommand(cmd);
}

function p2(n: number): string {
  return String(n).padStart(2, '0');
}
