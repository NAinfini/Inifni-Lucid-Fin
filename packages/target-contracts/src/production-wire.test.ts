import { describe, expect, it } from 'vitest';
import {
  ProductionFactSourceSchema,
  ProductionObjectViewV1Schema,
  parseCanonical,
  parseRequestV1,
  parseResponseV1,
} from './index.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const NOW = '2026-08-15T12:00:00.000Z';

const productionObject = {
  authority: 'production',
  id: 'story_1',
  projectId: 'project_1',
  revision: 3,
  contentHash: HASH_A,
  lifecycle: 'active',
  relations: [],
  protections: [],
  createdBy: { kind: 'direct_ui', actionId: 'action_1' },
  updatedBy: { kind: 'run', runId: 'run_1' },
  createdAt: NOW,
  updatedAt: NOW,
  type: 'story',
  content: {
    title: 'The Harbor',
    premise: 'A courier discovers a city hidden by the tide.',
    synopsis: 'The courier follows a signal into the drowned harbor.',
  },
} as const;

const factSource = {
  id: 'fact_source_1',
  productionObjectId: productionObject.id,
  field: 'title',
  source: {
    authority: 'production',
    id: 'direction_1',
    revision: 2,
    contentHash: HASH_B,
  },
  relation: 'supports',
  createdAt: NOW,
} as const;

const productionRef = {
  authority: 'production',
  id: productionObject.id,
  revision: productionObject.revision,
  contentHash: productionObject.contentHash,
} as const;

const storyValue = {
  objectType: 'story',
  content: productionObject.content,
} as const;

function request(input: unknown) {
  return {
    wireVersion: 1,
    kind: 'request',
    requestId: 'request_1',
    method: 'production.apply',
    input,
  } as const;
}

describe('Production public wire contract', () => {
  it('round-trips fact sources with their authoritative Production object', () => {
    expect(parseCanonical(ProductionFactSourceSchema, factSource)).toEqual(factSource);
    expect(
      parseCanonical(ProductionObjectViewV1Schema, {
        object: productionObject,
        factSources: [factSource],
      }),
    ).toEqual({ object: productionObject, factSources: [factSource] });

    expect(
      parseResponseV1({
        wireVersion: 1,
        kind: 'success',
        requestId: 'request_1',
        method: 'production.apply',
        result: { object: productionObject, factSources: [factSource] },
      }),
    ).toMatchObject({ kind: 'success', method: 'production.apply' });

    expect(() =>
      parseCanonical(ProductionObjectViewV1Schema, {
        object: productionObject,
        factSources: [{ ...factSource, productionObjectId: 'story_2' }],
      }),
    ).toThrow();
  });

  it('accepts only create, replace, and cite intents', () => {
    const create = {
      action: 'create',
      projectId: 'project_1',
      expectedProjectRevision: 4,
      value: storyValue,
      relations: [],
    } as const;
    const replace = {
      action: 'replace',
      projectId: 'project_1',
      ref: productionRef,
      lifecycle: 'active',
      value: storyValue,
      relations: [],
    } as const;
    const cite = {
      action: 'cite',
      projectId: 'project_1',
      ref: productionRef,
      field: 'title',
      source: factSource.source,
      relation: 'supports',
    } as const;

    expect(parseRequestV1(request(create))).toMatchObject({ input: create });
    expect(parseRequestV1(request(replace))).toMatchObject({ input: replace });
    expect(parseRequestV1(request(cite))).toMatchObject({ input: cite });
  });

  it('rejects caller-supplied host-owned fields and unknown fields', () => {
    const create = {
      action: 'create',
      projectId: 'project_1',
      expectedProjectRevision: 4,
      value: storyValue,
      relations: [],
    } as const;
    const forbidden = {
      id: 'story_1',
      revision: 0,
      contentHash: HASH_A,
      protections: [],
      createdBy: { kind: 'run', runId: 'run_1' },
      updatedBy: { kind: 'run', runId: 'run_1' },
      createdAt: NOW,
      updatedAt: NOW,
      legacyPrompt: 'hidden policy',
    } as const;

    for (const [field, value] of Object.entries(forbidden)) {
      expect(() => parseRequestV1(request({ ...create, [field]: value })), field).toThrow();
    }
    expect(() =>
      parseRequestV1(
        request({
          projectId: 'project_1',
          expectedRevision: null,
          object: productionObject,
        }),
      ),
    ).toThrow();
  });

  it('binds replacement and citation to one revision-and-hash Production ref', () => {
    const replace = {
      action: 'replace',
      projectId: 'project_1',
      ref: productionRef,
      lifecycle: 'archived',
      value: storyValue,
      relations: [],
    } as const;
    const cite = {
      action: 'cite',
      projectId: 'project_1',
      ref: productionRef,
      field: 'title',
      source: factSource.source,
      relation: 'contradicts',
    } as const;

    for (const input of [replace, cite]) {
      const withoutRevision = structuredClone(input) as { ref: Record<string, unknown> };
      delete withoutRevision.ref.revision;
      expect(() => parseRequestV1(request(withoutRevision))).toThrow();

      const withoutHash = structuredClone(input) as { ref: Record<string, unknown> };
      delete withoutHash.ref.contentHash;
      expect(() => parseRequestV1(request(withoutHash))).toThrow();

      expect(() =>
        parseRequestV1(
          request({
            ...input,
            expectedRevision: 3,
            expectedContentHash: productionRef.contentHash,
          }),
        ),
      ).toThrow();
    }
  });

  it('makes citation inclusion explicit on Production queries', () => {
    expect(
      parseRequestV1({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request_query_1',
        method: 'production.query',
        input: {
          projectId: 'project_1',
          ids: [],
          types: ['story'],
          includeArchived: false,
          includeFactSources: true,
          page: { cursor: null, limit: 20 },
        },
      }),
    ).toMatchObject({ method: 'production.query' });

    expect(() =>
      parseRequestV1({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request_query_2',
        method: 'production.query',
        input: {
          projectId: 'project_1',
          ids: [],
          types: ['story'],
          includeArchived: false,
          page: { cursor: null, limit: 20 },
        },
      }),
    ).toThrow();

    expect(
      parseResponseV1({
        wireVersion: 1,
        kind: 'success',
        requestId: 'request_query_1',
        method: 'production.query',
        result: {
          items: [{ object: productionObject, factSources: [factSource] }],
          nextCursor: null,
        },
      }),
    ).toMatchObject({ kind: 'success', method: 'production.query' });
  });
});
