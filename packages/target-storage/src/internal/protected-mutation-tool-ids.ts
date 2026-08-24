import {
  DecisionProtectDefinition,
  DecisionRecordDefinition,
  DeliveryMutateDefinition,
  ProductionMutateDefinition,
} from '@lucid-fin/target-contracts';

export const PROTECTED_MUTATION_TOOL_IDS = Object.freeze([
  DeliveryMutateDefinition.id,
  DecisionRecordDefinition.id,
  DecisionProtectDefinition.id,
  ProductionMutateDefinition.id,
] as const);

export type ProtectedMutationToolId = (typeof PROTECTED_MUTATION_TOOL_IDS)[number];

export function isProtectedMutationTool(toolId: string): toolId is ProtectedMutationToolId {
  return (PROTECTED_MUTATION_TOOL_IDS as readonly string[]).includes(toolId);
}
