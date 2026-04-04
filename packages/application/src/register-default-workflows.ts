import { WorkflowRegistry } from './workflow-registry.js';
import { storyboardGenerateWorkflow } from './workflows/storyboard.generate.js';
import { styleExtractWorkflow } from './workflows/style.extract.js';

export function registerDefaultWorkflows(registry = new WorkflowRegistry()): WorkflowRegistry {
  registry.register(storyboardGenerateWorkflow);
  registry.register(styleExtractWorkflow);
  return registry;
}
