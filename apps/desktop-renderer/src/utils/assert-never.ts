export function assertNever(value: never, context?: string): never {
  throw new Error(
    `assertNever${context ? ` [${context}]` : ''}: unhandled variant: ${JSON.stringify(value)}`,
  );
}
