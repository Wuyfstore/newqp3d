import type { FastifyInstance } from 'fastify'

import type { AccessControl } from '../accessControl.js'
import type { ApiRepository } from '../server.js'

export async function registerQualityRoutes(
  app: FastifyInstance,
  repository: ApiRepository,
  accessControl: AccessControl,
): Promise<void> {
  app.get(
    '/api/quality/latest',
    { preHandler: accessControl.requireCapability('versionReport') },
    async (_request, reply) => {
    const quality = await repository.getLatestQuality()

    if (quality == null) {
      return reply.code(404).send({ error: 'Latest quality report not found' })
    }

    return quality
    },
  )
}
