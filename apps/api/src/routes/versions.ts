import type { FastifyInstance, FastifyReply } from 'fastify'

import type { ApiRepository } from '../server.js'

export async function registerVersionRoutes(app: FastifyInstance, repository: ApiRepository): Promise<void> {
  app.get('/api/versions/latest', async (_request, reply) => {
    const latest = await repository.getLatestVersion()

    if (latest == null) {
      return reply.code(404).send({ error: 'Latest version not found' })
    }

    return latest
  })

  app.get('/api/versions/:version', async (request, reply) => {
    const { version } = request.params as { version: string }
    const safeVersion = parseVersionParam(version, reply)
    if (safeVersion == null) {
      return reply
    }

    const manifest = await repository.getVersion(safeVersion)
    if (manifest == null) {
      return reply.code(404).send({ error: 'Version not found' })
    }

    return manifest
  })

  app.get('/api/versions/:version/quality-report', async (request, reply) => {
    const { version } = request.params as { version: string }
    const safeVersion = parseVersionParam(version, reply)
    if (safeVersion == null) {
      return reply
    }

    const report = await repository.getQualityReport(safeVersion)
    if (report == null) {
      return reply.code(404).send({ error: 'Quality report not found' })
    }

    return report
  })

  app.get('/api/versions/:version/adaptation-report', async (request, reply) => {
    const { version } = request.params as { version: string }
    const safeVersion = parseVersionParam(version, reply)
    if (safeVersion == null) {
      return reply
    }

    const report = await repository.getAdaptationReport(safeVersion)
    if (report == null) {
      return reply.code(404).send({ error: 'Adaptation report not found' })
    }

    return report
  })
}

function parseVersionParam(version: string, reply: FastifyReply): string | null {
  if (!/^[\w.-]+$/.test(version) || version.includes('..')) {
    reply.code(400).send({ error: 'Invalid version id' })
    return null
  }

  return version
}
