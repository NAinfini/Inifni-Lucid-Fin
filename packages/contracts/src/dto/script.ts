export interface DialogueLine {
  character: string;
  line: string;
  parenthetical?: string;
}

export interface ParsedScene {
  index: number;
  heading: string;
  location: string;
  timeOfDay: string;
  content: string;
  characters: string[];
  dialogue: DialogueLine[];
  mood?: string;
  estDuration?: number;
}

export interface ScriptDocument {
  id: string;
  projectId: string;
  content: string;
  format: 'fountain' | 'fdx' | 'plaintext';
  parsedScenes: ParsedScene[];
  createdAt: number;
  updatedAt: number;
}
