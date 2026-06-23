import type { FastifyInstance } from 'fastify'

import {
  BuildTemplatePreflightValidationError,
  runBuildTemplatePreflight,
} from '../preflight/buildTemplatePreflight.js'
import type { ApiRepository, BuildTemplateStore } from '../server.js'

export async function registerPreflightRoutes(
  app: FastifyInstance,
  repository: ApiRepository,
  templateStore: BuildTemplateStore,
): Promise<void> {
  app.post('/api/build-templates/preflight', async (request, reply) => {
    try {
      return await runBuildTemplatePreflight(repository, request.body)
    } catch (error) {
      if (error instanceof BuildTemplatePreflightValidationError) {
        return reply.code(400).send({
          error: error.message,
          validationErrors: error.validationErrors,
        })
      }

      throw error
    }
  })

  app.post('/api/build-templates/:id/preflight', async (request, reply) => {
    const { id } = request.params as { id: string }
    const template = await templateStore.get(id)
    if (template == null) {
      return reply.code(404).send({ error: 'Build template not found' })
    }

    return runBuildTemplatePreflight(repository, template)
  })
}
