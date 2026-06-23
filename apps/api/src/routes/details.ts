import type { FastifyInstance } from 'fastify'

import type { AccessControl } from '../accessControl.js'
import type { ApiRepository } from '../server.js'

export async function registerDetailsRoutes(
  app: FastifyInstance,
  repository: ApiRepository,
  accessControl: AccessControl,
): Promise<void> {
  const requireNetworkQuery = accessControl.requireCapability('networkQuery')

  app.get('/api/lines/:guid', { preHandler: requireNetworkQuery }, async (request, reply) => {
    const { guid } = request.params as { guid: string }
    const detail = await repository.getLine(guid)

    if (detail == null) {
      return reply.code(404).send({ error: 'Line not found' })
    }

    return detail
  })

  app.get('/api/points/:gdbm', { preHandler: requireNetworkQuery }, async (request, reply) => {
    const { gdbm } = request.params as { gdbm: string }
    const detail = await repository.getPoint(gdbm)

    if (detail == null) {
      return reply.code(404).send({ error: 'Point not found' })
    }

    return detail
  })
}
