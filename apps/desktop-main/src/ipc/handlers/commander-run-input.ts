import type {
  CommanderRunAttachment,
  CommanderStartRequest,
  PublicContextFact,
} from '@lucid-fin/contracts';

const MAX_FACTS_PER_EVENT = 128;

export function buildCommanderRunInputFacts(
  request: CommanderStartRequest,
  attachments: readonly CommanderRunAttachment[],
): PublicContextFact[] {
  const facts: PublicContextFact[] = [
    { kind: 'value', key: 'request_kind', value: request.intent.kind },
    { kind: 'value', key: 'permission_mode', value: request.permissionMode ?? 'normal' },
  ];
  for (const canvasId of request.authorizedCanvasIds) {
    facts.push({
      kind: 'authority_ref',
      authority: 'canvas',
      relation: 'run_scope',
      id: canvasId,
    });
  }
  for (const selected of request.selectedNodes) {
    facts.push({
      kind: 'authority_ref',
      authority: 'canvas_node',
      relation: 'selected_input',
      id: selected.nodeId,
      scopeId: selected.canvasId,
    });
  }
  for (const attachment of attachments) {
    facts.push({
      kind: 'authority_ref',
      authority: 'cas',
      relation: 'attachment',
      id: attachment.contentHash,
      contentHash: attachment.contentHash,
    });
  }
  if (request.intent.kind === 'media_prompt_assembly') {
    facts.push(
      {
        kind: 'authority_ref',
        authority: 'task_list',
        relation: 'bound_input',
        id: request.intent.taskListId,
      },
      {
        kind: 'authority_ref',
        authority: 'prompt_assembly',
        relation: 'bound_input',
        id: request.intent.promptAssemblyId,
      },
    );
  }
  return facts;
}

export function chunkCommanderRunInputFacts(
  facts: readonly PublicContextFact[],
): PublicContextFact[][] {
  if (facts.length === 0) throw new Error('Commander run input requires at least one fact');
  const chunks: PublicContextFact[][] = [];
  for (let index = 0; index < facts.length; index += MAX_FACTS_PER_EVENT) {
    chunks.push(facts.slice(index, index + MAX_FACTS_PER_EVENT));
  }
  return chunks;
}
