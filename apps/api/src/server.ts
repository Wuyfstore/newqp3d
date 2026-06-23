import cors from '@fastify/cors'
import Fastify from 'fastify'

import { registerDatasourceRoutes } from './routes/datasource.js'
import { registerDetailsRoutes } from './routes/details.js'
import { registerQualityRoutes } from './routes/quality.js'
import { registerSearchRoutes } from './routes/search.js'
import { registerVersionRoutes } from './routes/versions.js'

export interface SearchResult {
  type: 'line' | 'point'
  id: string
  label: string
  longitude: number
  latitude: number
}

export interface DataSourceSchema {
  name: string
}

export interface DataSourceTable {
  schema: string
  name: string
  type: 'table' | 'view'
  estimatedRows: number | null
}

export interface DataSourceGeometryField {
  name: string
  srid: number | null
  geometryType: string | null
}

export interface DataSourceFieldProfile {
  name: string
  dataType: string
  isNullable: boolean
  samples: unknown[]
  nullRate: number | null
  uniqueCount: number | null
  recommendedMapping?: string
}

export interface DataSourceTableProfile {
  schema: string
  table: string
  estimatedRowCount: number | null
  geometryFields: DataSourceGeometryField[]
  fields: DataSourceFieldProfile[]
  inferredTableKind: 'line' | 'point' | 'unknown'
  recommendedFieldMapping: Record<string, string>
}

export interface ApiRepository {
  search(query: string): Promise<SearchResult[]>
  getLine(guid: string): Promise<unknown | null>
  getPoint(gdbm: string): Promise<unknown | null>
  getLatestVersion(): Promise<unknown | null>
  getLatestQuality(): Promise<unknown | null>
  listSchemas(): Promise<DataSourceSchema[]>
  listTables(schema: string): Promise<DataSourceTable[]>
  getTableProfile(schema: string, table: string): Promise<DataSourceTableProfile>
}

export async function createServer(repository: ApiRepository) {
  const app = Fastify({ logger: false })

  await app.register(cors, { origin: true })
  await registerDatasourceRoutes(app, repository)
  await registerSearchRoutes(app, repository)
  await registerDetailsRoutes(app, repository)
  await registerVersionRoutes(app, repository)
  await registerQualityRoutes(app, repository)

  return app
}
