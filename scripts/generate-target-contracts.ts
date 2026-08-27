import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format } from 'prettier';
import { z, type ZodType } from 'zod';
import {
  CapabilityCatalogSnapshotV1Schema,
  PARSER_POLICY_VERSION,
  capabilityCatalogHashInput,
  capabilityIndexDigestInput,
  skillCatalogDigestInput,
  toolCatalogDigestInput,
  toolSchemaDigestInput,
} from '../packages/target-contracts/src/capability-catalog.js';
import { canonicalJson } from '../packages/target-contracts/src/canonical.js';
import {
  LegacySkillContentV1Schema,
  SkillDocumentSchema,
} from '../packages/target-contracts/src/index.js';
import {
  BUILT_IN_LEGACY_SKILL_COUNT,
  BUILT_IN_LEGACY_SKILL_COUNTS,
  LEGACY_SKILL_DISPOSITIONS_V1,
  LEGACY_SKILL_ORPHAN_ARTIFACTS_V1,
  buildBuiltInLegacySkills,
} from './legacy-skill-pack.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const generatedDirectory = resolve(repositoryRoot, 'packages/target-contracts/generated');
const ddlPath = resolve(repositoryRoot, 'packages/target-contracts/ddl/project-v1.sql');

export { PARSER_POLICY_VERSION };

export const SCHEMA_BINDINGS_V1 = Object.freeze([
  ['capability_catalog_snapshots.catalog_v1_json', 'CapabilityCatalogSnapshotV1'],
  ['canvas_annotations.geometry_v1_json', 'CanvasGeometryV1'],
  ['canvas_documents.viewport_v1_json', 'CanvasViewportV1'],
  ['canvas_saved_views.viewport_v1_json', 'CanvasViewportV1'],
  ['compaction_views.cited_event_sequences_v1_json', 'SequenceListV1'],
  ['context_manifests.manifest_v1_json', 'ContextManifestV1'],
  ['delivery_exports.destination_v1_json', 'DeliveryDestinationIntentV1'],
  ['delivery_manifests.created_by_v1_json', 'CausationRefV1'],
  ['delivery_manifests.format_intent_v1_json', 'DeliveryFormatIntentV1'],
  ['delivery_plans.format_intent_v1_json', 'DeliveryFormatIntentV1'],
  ['dispatch_operations.input_v1_json', 'ToolInputEnvelopeV1'],
  ['dispatch_operations.outcome_v1_json', 'RuntimeLoopOutcome'],
  ['generated_results.prompt_provenance_v1_json', 'PromptAssemblyProvenanceV1'],
  ['generated_results.provider_v1_json', 'ProviderModelV1'],
  ['generated_results.receipt_v1_json', 'ProviderReceiptV1'],
  ['generated_results.reference_bindings_v1_json', 'GenerationReferenceBindingListV1'],
  ['generated_results.technical_validation_v1_json', 'TechnicalValidationV1'],
  ['generated_results.usage_v1_json', 'ProviderUsageV1'],
  ['generation_attempts.prompt_provenance_v1_json', 'PromptAssemblyProvenanceV1'],
  ['generation_attempts.provider_v1_json', 'ProviderModelV1'],
  ['generation_attempts.quote_v1_json', 'GenerationQuoteV1'],
  ['generation_attempts.receipt_v1_json', 'ProviderReceiptV1'],
  ['generation_attempts.usage_v1_json', 'ProviderUsageV1'],
  ['generation_requests.spec_v1_json', 'GenerationSpecV1'],
  ['global_media_assets.source_v1_json', 'MediaSourceV1'],
  ['global_media_assets.tags_v1_json', 'StringListV1'],
  ['imported_history_records.public_payload_v1_json', 'ImportedHistoryPayloadV1'],
  ['imported_run_event_history.public_payload_v1_json', 'ImportedHistoryPayloadV1'],
  ['imported_run_history.source_payload_v1_json', 'ImportedHistoryPayloadV1'],
  ['imported_run_scope_history.payload_v1_json', 'ImportedHistoryPayloadV1'],
  ['imported_task_item_history.source_payload_v1_json', 'ImportedHistoryPayloadV1'],
  ['imported_task_list_history.source_payload_v1_json', 'ImportedHistoryPayloadV1'],
  ['media_blobs.technical_facts_v1_json', 'MediaTechnicalFactsV1'],
  ['media_derivation_attempts.provider_v1_json', 'ProviderModelV1'],
  ['media_derivation_attempts.receipt_v1_json', 'ProviderReceiptV1'],
  ['media_derivation_attempts.usage_v1_json', 'ProviderUsageV1'],
  ['media_derivations.transform_v1_json', 'MediaDerivationTransformV1'],
  ['message_payloads.blocks_v1_json', 'MessageBlockListV1'],
  ['model_attempts.provider_v1_json', 'ProviderModelV1'],
  ['model_attempts.request_v1_json', 'CanonicalModelRequestV1'],
  ['model_attempts.response_v1_json', 'DurableCanonicalModelResponseV1'],
  ['model_attempts.usage_v1_json', 'ModelResourceQuoteV1'],
  ['plugin_packages.manifest_v1_json', 'PluginPackageManifestV1'],
  ['production_objects.content_v1_json', 'ProductionContentV1'],
  ['project_event_payloads.payload_v1_json', 'ProjectEventPayloadV1'],
  ['project_media_refs.collections_v1_json', 'StringListV1'],
  ['project_media_refs.roles_v1_json', 'ProjectMediaRoleListV1'],
  ['project_memory_items.sources_v1_json', 'MemorySourceListV1'],
  ['project_memory_items.topics_v1_json', 'StringListV1'],
  ['project_search_documents.source_v1_json', 'ProjectSearchSourceV1'],
  ['project_settings.budget_v1_json', 'ResourceBudgetV1'],
  ['project_settings.format_policy_v1_json', 'ProjectFormatPolicyV1'],
  ['provider_profiles.configuration_v1_json', 'ProviderProfileConfigurationV1'],
  ['result_assessment_attempts.provider_v1_json', 'ProviderModelV1'],
  ['result_assessment_attempts.receipt_v1_json', 'ProviderReceiptV1'],
  ['result_assessment_attempts.request_v1_json', 'EvaluationInputV1'],
  ['result_assessment_attempts.usage_v1_json', 'ProviderUsageV1'],
  ['result_assessments.assessment_v1_json', 'FinalAssessmentV1'],
  ['review_cut_attempts.request_v1_json', 'ReviewCutRequestV1'],
  ['run_confirmations.target_v1_json', 'ConfirmationTargetV1'],
  ['run_events.causation_v1_json', 'CausationRefV1'],
  ['run_event_payloads.payload_v1_json', 'RunEventPayloadV1'],
  ['run_inbox_messages.selected_context_v1_json', 'SelectedContextRefListV1'],
  ['run_inbox_messages.export_destination_grant_v1_json', 'DeliveryDestinationGrantV1Schema'],
  ['run_inbox_messages.source_v1_json', 'RunAcceptedSourceSchema'],
  ['run_interactions.context_refs_v1_json', 'DomainObjectRefListV1'],
  ['run_interactions.options_v1_json', 'InteractionOptionListV1'],
  ['run_resource_entries.amount_v1_json', 'RunResourceAmountV1'],
  ['runs.budget_v1_json', 'ResourceBudgetV1'],
  ['task_items.child_run_ids_v1_json', 'EntityIdListV1'],
  ['user_choices.after_effect_v1_json', 'UserChoiceEffectV1'],
  ['user_choices.before_effect_v1_json', 'UserChoiceEffectV1'],
  ['user_choices.causation_v1_json', 'CausationRefV1'],
  ['user_choices.choice_v1_json', 'UserChoiceIntentV1'],
  ['user_choices.subject_v1_json', 'UserChoiceSubjectV1'],
  ['wire_command_receipts.response_v1_json', 'WireSuccessV1'],
] as const);

type GenerationMode = 'write' | 'check';
type GeneratedArtifactName =
  | 'built-in-skills.v1.json'
  | 'legacy-skill-dispositions.v1.json'
  | 'tool-catalog.v1.json'
  | 'public-wire.v1.json'
  | 'schema-bindings.v1.json'
  | 'manifest.v1.json';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function jsonDocument(value: unknown): Promise<string> {
  return format(canonicalJson(value), { parser: 'json', printWidth: 100 });
}

function jsonSchema(schema: ZodType): unknown {
  return JSON.parse(
    JSON.stringify(z.toJSONSchema(schema, { io: 'output', unrepresentable: 'throw' })),
  ) as unknown;
}

function digestDocument(value: unknown): { canonicalJson: string; sha256: string } {
  const canonicalText = canonicalJson(value);
  return { canonicalJson: canonicalText, sha256: sha256(canonicalText) };
}

export async function buildTargetContractArtifacts(): Promise<
  Readonly<Record<GeneratedArtifactName, string>>
> {
  const [{ EXACT_TOOL_IDS, TOOL_DEFINITIONS }, wire, ddl, builtInSkillValues] = await Promise.all([
    import('../packages/target-contracts/src/tools/catalog.js'),
    import('../packages/target-contracts/src/wire.js'),
    readFile(ddlPath, 'utf8'),
    buildBuiltInLegacySkills(),
  ]);
  const builtInSkills = builtInSkillValues.map((value) => SkillDocumentSchema.parse(value));
  const builtInCounts = Object.fromEntries(
    Object.keys(BUILT_IN_LEGACY_SKILL_COUNTS).map((kind) => [
      kind,
      builtInSkills.filter(
        ({ content }) => LegacySkillContentV1Schema.parse(JSON.parse(content)).source.kind === kind,
      ).length,
    ]),
  );
  if (
    builtInSkills.length !== BUILT_IN_LEGACY_SKILL_COUNT ||
    canonicalJson(builtInCounts) !== canonicalJson(BUILT_IN_LEGACY_SKILL_COUNTS) ||
    builtInSkills.some(
      (skill, index) =>
        index > 0 &&
        (builtInSkills[index - 1]!.skillId > skill.skillId ||
          (builtInSkills[index - 1]!.skillId === skill.skillId &&
            builtInSkills[index - 1]!.version >= skill.version)),
    ) ||
    builtInSkills.some(({ content, contentHash }) => sha256(content) !== contentHash)
  ) {
    throw new Error('Built-in legacy Skill artifact failed count, order, identity, or hash checks');
  }
  const builtInSkillsDocument = await jsonDocument(builtInSkills);
  const legacySkillDispositions = await jsonDocument({
    dispositions: LEGACY_SKILL_DISPOSITIONS_V1,
    orphanArtifacts: LEGACY_SKILL_ORPHAN_ARTIFACTS_V1,
    version: 1,
  });

  const definitionIds = TOOL_DEFINITIONS.map(({ id }) => id);
  if (canonicalJson(EXACT_TOOL_IDS) !== canonicalJson(definitionIds)) {
    throw new Error(
      `Target tool catalog must contain the exact ordered ${EXACT_TOOL_IDS.length} tool definitions`,
    );
  }

  const tools = TOOL_DEFINITIONS.map((definition) => {
    const inputSchema = digestDocument(jsonSchema(definition.inputSchema));
    const successSchema = digestDocument(jsonSchema(definition.successSchema));
    const outcomeSchema = digestDocument(jsonSchema(definition.outcomeSchema));
    const examples = digestDocument(definition.examples);
    return {
      description: definition.description,
      examples,
      id: definition.id,
      inputSchema,
      metadata: definition.metadata,
      metadataHash: sha256(canonicalJson(definition.metadata)),
      outcomeSchema,
      schemaDigest: sha256(
        toolSchemaDigestInput({ inputSchema, successSchema, outcomeSchema, examples }),
      ),
      successSchema,
      version: definition.version,
    };
  });
  const skills: [] = [];
  const capabilityIndex = tools.map((tool) => ({
    availability:
      tool.metadata.confirmation.mode === 'none'
        ? ('available' as const)
        : ('confirmation_required' as const),
    domain: tool.metadata.domain,
    name: tool.id,
    purpose: tool.description,
    schemaDigest: tool.schemaDigest,
    version: tool.version,
  }));
  const catalogWithoutHash = {
    capabilityIndex,
    capabilityIndexDigest: sha256(capabilityIndexDigestInput(capabilityIndex)),
    parentCatalogHash: null,
    parserPolicyVersion: PARSER_POLICY_VERSION,
    skillCatalogDigest: sha256(skillCatalogDigestInput(skills)),
    skills,
    toolCatalogDigest: sha256(toolCatalogDigestInput(tools)),
    tools,
    version: 1 as const,
  };
  const toolCatalog = await jsonDocument(
    CapabilityCatalogSnapshotV1Schema.parse({
      ...catalogWithoutHash,
      catalogHash: sha256(capabilityCatalogHashInput(catalogWithoutHash)),
    }),
  );

  const methods = Object.entries(wire.PUBLIC_WIRE_METHODS_V1).map(([method, definition]) => ({
    inputSchema: jsonSchema(definition.inputSchema),
    method,
    outputSchema: jsonSchema(definition.outputSchema),
  }));
  const publicWire = await jsonDocument({
    envelopeSchema: jsonSchema(wire.WireEnvelopeV1Schema),
    methods,
    parserPolicyVersion: PARSER_POLICY_VERSION,
    pushMethods: [
      {
        method: 'run.events.appended',
        payloadSchema: jsonSchema(wire.RunEventsAppendedPushPayloadV1Schema),
      },
    ],
    version: 1,
  });

  const schemaBindings = await jsonDocument({
    bindings: SCHEMA_BINDINGS_V1.map(([column, schema]) => ({ column, schema })),
    parserPolicyVersion: PARSER_POLICY_VERSION,
    version: 1,
  });

  const manifest = await jsonDocument({
    artifacts: {
      'built-in-skills.v1.json': sha256(builtInSkillsDocument),
      'legacy-skill-dispositions.v1.json': sha256(legacySkillDispositions),
      'project-v1.sql': sha256(ddl),
      'public-wire.v1.json': sha256(publicWire),
      'schema-bindings.v1.json': sha256(schemaBindings),
      'tool-catalog.v1.json': sha256(toolCatalog),
    },
    parserPolicyVersion: PARSER_POLICY_VERSION,
    version: 1,
  });

  return Object.freeze({
    'built-in-skills.v1.json': builtInSkillsDocument,
    'legacy-skill-dispositions.v1.json': legacySkillDispositions,
    'manifest.v1.json': manifest,
    'public-wire.v1.json': publicWire,
    'schema-bindings.v1.json': schemaBindings,
    'tool-catalog.v1.json': toolCatalog,
  });
}

export async function generateTargetContracts(mode: GenerationMode): Promise<void> {
  const artifacts = await buildTargetContractArtifacts();
  if (mode === 'write') await mkdir(generatedDirectory, { recursive: true });
  for (const [name, expected] of Object.entries(artifacts) as [GeneratedArtifactName, string][]) {
    const path = resolve(generatedDirectory, name);
    if (mode === 'write') {
      await writeFile(path, expected, 'utf8');
      continue;
    }
    const actual = await readFile(path, 'utf8').catch(() => undefined);
    if (actual !== expected) throw new Error(`Generated target contract drift: ${name}`);
  }
}

async function main(): Promise<void> {
  const flag = process.argv[2];
  if (flag !== '--write' && flag !== '--check') {
    throw new Error('Usage: tsx scripts/generate-target-contracts.ts --write|--check');
  }
  await generateTargetContracts(flag === '--write' ? 'write' : 'check');
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
