import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

export default async function startTargetFixtureServer() {
  const server = await createServer({
    configFile: fileURLToPath(new URL('./vite.config.ts', import.meta.url)),
  });
  await server.listen();

  return async () => {
    await server.close();
  };
}
