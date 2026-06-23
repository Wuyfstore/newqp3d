import type { FastifyInstance } from 'fastify'

import type { AccessControl } from '../accessControl.js'
import type { ApiRepository } from '../server.js'

export async function registerSearchRoutes(
  app: FastifyInstance,
  repository: ApiRepository,
  accessControl: AccessControl,
): Promise<void> {
  app.get('/api/search', { preHandler: accessControl.requireCapability('networkQuery') }, async request => {
    const query = String((request.query as { q?: string }).q ?? '').trim()
    if (!query) {
      return { results: [] }
    }

    return { results: await repository.search(query) }
  })
}
