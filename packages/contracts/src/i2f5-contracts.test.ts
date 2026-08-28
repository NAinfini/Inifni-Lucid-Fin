import { describe, expect, it } from 'vitest';
import { EvaluationSuccessSchema } from './generation.js';
import { ProjectSearchSourceV1Schema } from './history-memory.js';
import { ProjectSearchDefinition } from './tools/context-tools.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const NOW = '2026-08-16T12:00:00.000Z';
const NON_SUCCEEDED_STATES = [
  'prepared',
  'running',
  'submitted',
  'unknown',
  'failed',
  'cancelled',
] as const;

const subjectRef = {
  authority: 'generated_result',
  id: 'result.1',
  revision: 0,
  contentHash: HASH_A,
} as const;

function assessment() {
  return {
    kind: 'coverage' as const,
    subjects: [{ role: 'subject' as const, ref: subjectRef }],
    findings: [],
    limitations: [],
    recommendations: ['Keep the selected coverage.'],
    artifacts: [],
    createdAt: NOW,
    assessmentHash: HASH_B,
  };
}

function evaluationResult() {
  return {
    operation: {
      id: 'operation.assessment.1',
      revision: 1,
      kind: 'result_assessment' as const,
      ownerRef: {
        authority: 'result_assessment_attempt' as const,
        id: 'assessment.1',
        revision: 1,
        contentHash: HASH_A,
      },
    },
    assessmentId: 'assessment.1',
    state: 'succeeded' as const,
    assessment: assessment(),
  };
}

describe('I2-F5 evaluation result contracts', () => {
  it('requires null assessment for every non-succeeded Attempt state', () => {
    for (const state of NON_SUCCEEDED_STATES) {
      expect(
        EvaluationSuccessSchema.safeParse({
          ...evaluationResult(),
          state,
          assessment: null,
        }).success,
        state,
      ).toBe(true);
      expect(
        EvaluationSuccessSchema.safeParse({ ...evaluationResult(), state }).success,
        state,
      ).toBe(false);
    }
  });

  it('requires a hash-valid strict FinalAssessment when succeeded', () => {
    const valid = evaluationResult();
    expect(EvaluationSuccessSchema.parse(valid)).toEqual(valid);
    expect(
      EvaluationSuccessSchema.safeParse({
        ...valid,
        assessment: { ...valid.assessment, assessmentHash: 'not-a-sha256' },
      }).success,
    ).toBe(false);
    expect(
      EvaluationSuccessSchema.safeParse({
        ...valid,
        assessment: { ...valid.assessment, unexpected: true },
      }).success,
    ).toBe(false);
    expect(EvaluationSuccessSchema.safeParse({ ...valid, assessmentHash: HASH_B }).success).toBe(
      false,
    );
  });

  it('binds the result-assessment Operation owner to assessmentId', () => {
    const valid = evaluationResult();
    expect(
      EvaluationSuccessSchema.safeParse({
        ...valid,
        operation: {
          ...valid.operation,
          kind: 'generation_attempt',
          ownerRef: { ...valid.operation.ownerRef, authority: 'generation_attempt' },
        },
      }).success,
    ).toBe(false);
    expect(
      EvaluationSuccessSchema.safeParse({
        ...valid,
        operation: {
          ...valid.operation,
          ownerRef: { ...valid.operation.ownerRef, id: 'assessment.2' },
        },
      }).success,
    ).toBe(false);
    expect(EvaluationSuccessSchema.safeParse({ ...valid, unexpected: true }).success).toBe(false);
  });
});

describe('I2-F5 result assessment search contracts', () => {
  const source = {
    kind: 'result_assessment',
    ref: {
      authority: 'result_assessment_attempt',
      id: 'assessment.1',
      revision: 1,
      contentHash: HASH_A,
    },
  } as const;

  it('accepts the exact sixth project.search kind and source authority', () => {
    expect(ProjectSearchSourceV1Schema.parse(source)).toEqual(source);
    expect(() =>
      ProjectSearchDefinition.parseInput({
        query: 'continuity assessment',
        kinds: [
          'production',
          'project_media_ref',
          'delivery',
          'message',
          'generated_result',
          'result_assessment',
        ],
        state: 'any',
        page: { cursor: null, limit: 20 },
      }),
    ).not.toThrow();
  });

  it('rejects an inexact source authority or search kind', () => {
    expect(
      ProjectSearchSourceV1Schema.safeParse({
        ...source,
        ref: { ...source.ref, authority: 'generated_result' },
      }).success,
    ).toBe(false);
    expect(ProjectSearchSourceV1Schema.safeParse({ ...source, unexpected: true }).success).toBe(
      false,
    );
    expect(() =>
      ProjectSearchDefinition.parseInput({
        query: 'continuity assessment',
        kinds: ['assessment'],
        state: 'any',
        page: { cursor: null, limit: 20 },
      }),
    ).toThrow();
  });
});
