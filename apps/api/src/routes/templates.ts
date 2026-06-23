import type { FastifyInstance, FastifyReply } from 'fastify'
import type { BuildTemplate } from '@new-qp3d/shared'
import type { BuildTemplateStore } from '../server.js'
import {
  TemplateConflictError,
  TemplateNotFoundError,
  TemplateValidationError,
} from '../templates/fileTemplateStore.js'

export async function registerTemplateRoutes(app: FastifyInstance, store: BuildTemplateStore): Promise<void> {
  app.get('/api/build-templates', async () => {
    return { templates: await store.list() }
  })

  app.get('/api/build-templates/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const template = await store.get(id)

    if (template == null) {
      return reply.code(404).send({ error: 'Build template not found' })
    }

    return template
  })

  app.post('/api/build-templates', async (request, reply) => {
    try {
      const template = await store.create(request.body as BuildTemplate)
      return reply.code(201).send(template)
    } catch (error) {
      return sendTemplateError(reply, error)
    }
  })

  app.put('/api/build-templates/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      return await store.update(id, request.body as BuildTemplate)
    } catch (error) {
      return sendTemplateError(reply, error)
    }
  })

  app.post('/api/build-templates/:id/duplicate', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = (request.body ?? {}) as { id?: string; name?: string }
    try {
      const duplicateOptions: { id: string; name?: string } = {
        id: String(body.id ?? ''),
      }
      if (body.name !== undefined) {
        duplicateOptions.name = body.name
      }

      const template = await store.duplicate(id, duplicateOptions)
      return reply.code(201).send(template)
    } catch (error) {
      return sendTemplateError(reply, error)
    }
  })

  app.get('/api/build-templates/:id/export', async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      return await store.export(id)
    } catch (error) {
      return sendTemplateError(reply, error)
    }
  })

  app.post('/api/build-templates/import', async (request, reply) => {
    const body = (request.body ?? {}) as { dataSourceId?: unknown }
    try {
      const template = await store.import(
        request.body,
        typeof body.dataSourceId === 'string' && body.dataSourceId.trim()
          ? { dataSourceId: body.dataSourceId.trim() }
          : undefined,
      )
      return reply.code(201).send(template)
    } catch (error) {
      return sendTemplateError(reply, error)
    }
  })
}

function sendTemplateError(reply: FastifyReply, error: unknown) {
  if (error instanceof TemplateValidationError) {
    return reply.code(400).send({
      error: error.message,
      validationErrors: error.validationErrors,
    })
  }

  if (error instanceof TemplateNotFoundError) {
    return reply.code(404).send({ error: 'Build template not found' })
  }

  if (error instanceof TemplateConflictError) {
    return reply.code(409).send({ error: error.message })
  }

  throw error
}
