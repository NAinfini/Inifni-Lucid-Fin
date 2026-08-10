import { WorkflowRegistry } from './workflow-registry.js';
import { characterGenerateReferencesWorkflow } from './workflows/character.generate-references.js';
import { locationGenerateReferencesWorkflow } from './workflows/location.generate-references.js';
import { styleExtractWorkflow } from './workflows/style.extract.js';
import { movieProductionWorkflow } from './workflows/movie.production.v2.js';

export function registerDefaultWorkflows(registry = new WorkflowRegistry()): WorkflowRegistry {
  registry.register(styleExtractWorkflow);
  registry.register(characterGenerateReferencesWorkflow);
  registry.register(locationGenerateReferencesWorkflow);
  registry.register(movieProductionWorkflow);
  return registry;
}
