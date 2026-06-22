import type { FastifyInstance } from 'fastify'

import type { ApiRepository } from '../server.js'

export async function registerQualityRoutes(app: FastifyInstance, repository: ApiRepository): Promise<void> {
  app.get('/api/quality/latest', async (_request, reply) => {
    const quality = await repository.getLatestQuality()

    if (quality == null) {
      return reply.code(404).send({ error: 'Latest quality report not found' })
    }

    return quality
  })
}
