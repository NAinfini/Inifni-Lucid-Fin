/**
 * NLE Export — generates XML (FCP) and EDL (CMX 3600)
 * from the Lucid Fin timeline data model.
 */

export interface NLEClip {
  id: string;
  trackIndex: number;
  trackType: 'video' | 'audio' | 'subtitle';
  assetPath: string;
  startTime: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  speed: number;
}

export interface NLEProject {
  name: string;
  fps: number;
  width: number;
  height: number;
  clips: NLEClip[];
}

// --- FCP XML (Final Cut Pro 7 compatible) ---

export function exportFCPXML(project: NLEProject): string {
  const { name, fps, width, height, clips } = project;
  const totalDuration = clips.reduce((max, c) => Math.max(max, c.startTime + c.duration), 0);
  const totalFrames = Math.ceil(totalDuration * fps);

  const videoClips = clips.filter((c) => c.trackType === 'video');
  const audioClips = clips.filter((c) => c.trackType === 'audio');

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<!DOCTYPE xmeml>\n<xmeml version="5">\n<sequence>\n`;
  xml += `  <name>${escapeXml(name)}</name>\n`;
  xml += `  <duration>${totalFrames}</duration>\n`;
  xml += `  <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>\n`;
  xml += `  <media>\n`;

  // Video tracks
  xml += `    <video>\n`;
  xml += `      <format><samplecharacteristics><width>${width}</width><height>${height}</height></samplecharacteristics></format>\n`;
  for (const clip of videoClips) {
    xml += clipToFCPXml(clip, fps);
  }
  xml += `    </video>\n`;

  // Audio tracks
  xml += `    <audio>\n`;
  for (const clip of audioClips) {
    xml += clipToFCPXml(clip, fps);
  }
  xml += `    </audio>\n`;

  xml += `  </media>\n</sequence>\n</xmeml>`;
  return xml;
}

function clipToFCPXml(clip: NLEClip, fps: number): string {
  const startFrame = Math.round(clip.startTime * fps);
  const endFrame = Math.round((clip.startTime + clip.duration) * fps);
  const inFrame = Math.round(clip.inPoint * fps);
  const outFrame = Math.round(clip.outPoint * fps);
  const filePath = clip.assetPath.replace(/\\/g, '/');
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');

  return `      <track><clipitem id="${escapeXml(clip.id)}">
        <name>${escapeXml(clip.id)}</name>
        <start>${startFrame}</start><end>${endFrame}</end>
        <in>${inFrame}</in><out>${outFrame}</out>
        <file><pathurl>file://localhost/${encodedPath}</pathurl></file>
      </clipitem></track>\n`;
}

// --- EDL (CMX 3600) ---

export function exportEDL(project: NLEProject): string {
  const { name, fps, clips } = project;
  const videoClips = clips
    .filter((c) => c.trackType === 'video')
    .sort((a, b) => a.startTime - b.startTime);

  let edl = `TITLE: ${sanitizeEDL(name)}\nFCM: NON-DROP FRAME\n\n`;

  videoClips.forEach((clip, i) => {
    const num = String(i + 1).padStart(3, '0');
    const srcIn = framesToTC(Math.round(clip.inPoint * fps), fps);
    const srcOut = framesToTC(Math.round(clip.outPoint * fps), fps);
    const recIn = framesToTC(Math.round(clip.startTime * fps), fps);
    const recOut = framesToTC(Math.round((clip.startTime + clip.duration) * fps), fps);

    edl += `${num}  AX       V     C        ${srcIn} ${srcOut} ${recIn} ${recOut}\n`;
    edl += `* FROM CLIP NAME: ${sanitizeEDL(clip.assetPath)}\n\n`;
  });

  return edl;
}

function framesToTC(frames: number, fps: number): string {
  const h = Math.floor(frames / (fps * 3600));
  const m = Math.floor((frames % (fps * 3600)) / (fps * 60));
  const s = Math.floor((frames % (fps * 60)) / fps);
  const f = frames % fps;
  return `${p2(h)}:${p2(m)}:${p2(s)}:${p2(f)}`;
}

function p2(n: number): string {
  return String(n).padStart(2, '0');
}
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
/** Strip control chars and newlines that would break EDL format */
function sanitizeEDL(s: string): string {
  // eslint-disable-next-line no-control-regex -- intentionally stripping control characters
  return s.replace(/[\r\n\x00-\x1f]/g, '');
}
