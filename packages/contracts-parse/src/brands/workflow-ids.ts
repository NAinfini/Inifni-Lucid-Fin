/**
 * Workflow-domain ID brand parsers — Phase G1-2.11.
 */

import { z } from 'zod';
import type { WorkflowRunId, WorkflowStageId, WorkflowTaskId } from '@lucid-fin/contracts';
import { makeBrandParser, makeTryBrand } from '../parse.js';

const trimmedId = (label: string) =>
  z
    .string()
    .min(1)
    .transform((v) => v.trim())
    .refine((v) => v.length > 0, { message: `${label} must be non-empty after trim` });

const WorkflowRunIdSchema = trimmedId('workflowRunId');
const WorkflowStageIdSchema = trimmedId('workflowStageId');
const WorkflowTaskIdSchema = trimmedId('workflowTaskId');

export const parseWorkflowRunId = makeBrandParser<WorkflowRunId, string>(
  WorkflowRunIdSchema,
  'WorkflowRunId',
);
export const tryWorkflowRunId = makeTryBrand<WorkflowRunId, string>(WorkflowRunIdSchema);

export const parseWorkflowStageId = makeBrandParser<WorkflowStageId, string>(
  WorkflowStageIdSchema,
  'WorkflowStageId',
);
export const tryWorkflowStageId = makeTryBrand<WorkflowStageId, string>(WorkflowStageIdSchema);

export const parseWorkflowTaskId = makeBrandParser<WorkflowTaskId, string>(
  WorkflowTaskIdSchema,
  'WorkflowTaskId',
);
export const tryWorkflowTaskId = makeTryBrand<WorkflowTaskId, string>(WorkflowTaskIdSchema);
