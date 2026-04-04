export { detectFfmpeg, createCommand, runCommand } from './ffmpeg-utils.js';
export { kenBurns, type KenBurnsOptions } from './ken-burns.js';
export { stitchVideos, type StitchOptions } from './stitcher.js';
export { generateProxy, type ProxyOptions } from './proxy.js';
export {
  renderTimeline,
  renderSingleSegment,
  getOutputExtension,
  type RenderOptions,
  type RenderSegment,
  type RenderCodec,
  type RenderPreset,
} from './render.js';
export { exportFCPXML, exportEDL, type NLEProject, type NLEClip } from './nle-export.js';
export {
  exportSRT,
  exportASS,
  burnSubtitles,
  type SubtitleCue,
  type SubtitleStyle,
} from './subtitles.js';
