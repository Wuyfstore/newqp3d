import { pathToFileURL } from 'node:url'

import { readEnv } from './config/env.js'
import { createPostgisRepository } from './db/pool.js'
import { createServer } from './server.js'

export * from './config/env.js'
export * from './db/pool.js'
export * from './server.js'

export async function startApi(): Promise<void> {
  const env = readEnv()
  const app = await createServer(createPostgisRepository(env))

  await app.listen({ host: env.host, port: env.port })
}

export function isDirectRun(moduleUrl: string, entryPath: string | undefined): boolean {
  return entryPath !== undefined && moduleUrl === pathToFileURL(entryPath).href
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  startApi().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
