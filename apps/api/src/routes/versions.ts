import type { FastifyInstance } from 'fastify'

import type { ApiRepository } from '../server.js'

export async function registerVersionRoutes(app: FastifyInstance, repository: ApiRepository): Promise<void> {
  app.get('/api/versions/latest', async (_request, reply) => {
    const latest = await repository.getLatestVersion()

    if (latest == null) {
      return reply.code(404).send({ error: 'Latest version not found' })
    }

    return latest
  })
}
