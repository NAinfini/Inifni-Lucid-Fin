import { TaskListRegistry } from './task-list-registry.js';
import { styleExtractTaskList } from './task-lists/style.extract.js';
import { movieProductionTaskList } from './task-lists/movie.production.v2.js';
import { audioProductionTaskList } from './task-lists/audio.production.v1.js';
import { mediaGenerationTaskList } from './task-lists/media.generation.v1.js';

export function registerDefaultTaskLists(registry = new TaskListRegistry()): TaskListRegistry {
  registry.register(styleExtractTaskList);
  registry.register(movieProductionTaskList);
  registry.register(audioProductionTaskList);
  registry.register(mediaGenerationTaskList);
  return registry;
}
