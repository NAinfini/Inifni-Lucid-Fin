/** Task-execution ID brand parsers. */

import { z } from 'zod';
import type { TaskId, TaskListId } from '@lucid-fin/contracts';
import { makeBrandParser, makeTryBrand } from '../parse.js';

const trimmedId = (label: string) =>
  z
    .string()
    .min(1)
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, { message: `${label} must be non-empty after trim` });

const TaskListIdSchema = trimmedId('taskListId');
const TaskIdSchema = trimmedId('taskId');

export const parseTaskListId = makeBrandParser<TaskListId, string>(TaskListIdSchema, 'TaskListId');
export const tryTaskListId = makeTryBrand<TaskListId, string>(TaskListIdSchema);

export const parseTaskId = makeBrandParser<TaskId, string>(TaskIdSchema, 'TaskId');
export const tryTaskId = makeTryBrand<TaskId, string>(TaskIdSchema);
