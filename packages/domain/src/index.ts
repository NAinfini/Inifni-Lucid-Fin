// Domain layer — re-export contracts types + business rules
export type {
  Character,
  StyleGuide,
  ScriptDocument,
  ParsedScene,
  DialogueLine,
} from '@lucid-fin/contracts';

// Script parsing
export { parseScript, parseFountain, parsePlaintext } from './script-parser.js';

// Cascade update engine
export {
  DependencyGraph,
  type DependencyNode,
  type CascadeEvent,
  type EntityType,
} from './cascade.js';
