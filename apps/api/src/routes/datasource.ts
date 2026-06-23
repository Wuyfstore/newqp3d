import type { FastifyInstance } from 'fastify'

import type { ApiRepository } from '../server.js'

export async function registerDatasourceRoutes(app: FastifyInstance, repository: ApiRepository): Promise<void> {
  app.get('/api/datasource/schemas', async () => {
    return { schemas: await repository.listSchemas() }
  })

  app.get('/api/datasource/tables', async request => {
    const schema = String((request.query as { schema?: string }).schema ?? '').trim()
    return { tables: await repository.listTables(schema) }
  })

  app.get('/api/datasource/tables/:schema/:table/profile', async request => {
    const { schema, table } = request.params as { schema: string; table: string }
    return repository.getTableProfile(schema, table)
  })
}
