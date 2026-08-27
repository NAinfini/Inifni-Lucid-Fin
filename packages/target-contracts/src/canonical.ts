import { z, type ZodRawShape } from 'zod';
import { canonicalParse, isCanonicalPlainObject } from './canonical-json.js';

export { z };

export { canonicalJson } from './canonical-json.js';

const PlainObjectSchema = z.custom<{ [key: string]: unknown }>(isCanonicalPlainObject, {
  message: 'Expected a plain object',
});

export function strictObject<const Shape extends ZodRawShape>(shape: Shape) {
  return PlainObjectSchema.pipe(z.strictObject(shape));
}

export function parseCanonical<Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
): z.output<Schema> {
  return canonicalParse(input, (value) => schema.parse(value)) as z.output<Schema>;
}
