import type { FastifyInstance } from 'fastify'

import type { AccessControl } from '../accessControl.js'
import type { ApiRepository } from '../server.js'

export async function registerDatasourceRoutes(
  app: FastifyInstance,
  repository: ApiRepository,
  accessControl: AccessControl,
): Promise<void> {
  const requireDatasourceAdmin = accessControl.requireCapability('datasourceAdmin')

  app.get('/api/datasource/schemas', { preHandler: requireDatasourceAdmin }, async () => {
    return { schemas: await repository.listSchemas() }
  })

  app.get('/api/datasource/tables', { preHandler: requireDatasourceAdmin }, async request => {
    const schema = String((request.query as { schema?: string }).schema ?? '').trim()
    return { tables: await repository.listTables(schema) }
  })

  app.get(
    '/api/datasource/tables/:schema/:table/profile',
    { preHandler: requireDatasourceAdmin },
    async request => {
    const { schema, table } = request.params as { schema: string; table: string }
    return repository.getTableProfile(schema, table)
    },
  )
}
