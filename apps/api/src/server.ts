import cors from '@fastify/cors'
import Fastify from 'fastify'

import { createFileTemplateStore } from './templates/fileTemplateStore.js'
import { registerBuildTaskRoutes } from './routes/buildTasks.js'
import { registerDatasourceRoutes } from './routes/datasource.js'
import { registerDetailsRoutes } from './routes/details.js'
import { registerPreflightRoutes } from './routes/preflight.js'
import { registerQualityRoutes } from './routes/quality.js'
import { registerSearchRoutes } from './routes/search.js'
import { registerTemplateRoutes } from './routes/templates.js'
import { registerVersionRoutes } from './routes/versions.js'
import { createCliBuildTaskRunner } from './tasks/buildTaskRunner.js'
import { createMemoryBuildTaskStore } from './tasks/buildTaskStore.js'
import type {
  BuildTemplate,
  BuildTemplateMigrationPackage,
  BuildTemplateStatus,
} from '@new-qp3d/shared'
import type { BuildTaskRunner, BuildTaskStore } from './tasks/buildTaskTypes.js'

export type {
  BuildTask,
  BuildTaskLogEntry,
  BuildTaskLogLevel,
  BuildTaskRunner,
  BuildTaskRunnerContext,
  BuildTaskRunnerResult,
  BuildTaskStatus,
  BuildTaskStore,
} from './tasks/buildTaskTypes.js'

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
  listVersions(): Promise<unknown[]>
  getVersion(version: string): Promise<unknown | null>
  getQualityReport(version: string): Promise<unknown | null>
  getAdaptationReport(version: string): Promise<unknown | null>
  publishVersion(version: string): Promise<unknown | null>
  rollbackVersion(version: string): Promise<unknown | null>
  listSchemas(): Promise<DataSourceSchema[]>
  listTables(schema: string): Promise<DataSourceTable[]>
  getTableProfile(schema: string, table: string): Promise<DataSourceTableProfile>
}

export interface BuildTemplateSummary {
  id: string
  name: string
  description: string
  version: string
  status: BuildTemplateStatus
  dataSourceId: string
  updatedAt: string
}

export interface BuildTemplateStore {
  list(): Promise<BuildTemplateSummary[]>
  get(id: string): Promise<BuildTemplate | null>
  create(template: BuildTemplate): Promise<BuildTemplate>
  update(id: string, template: BuildTemplate): Promise<BuildTemplate>
  duplicate(id: string, options: { id: string; name?: string }): Promise<BuildTemplate>
  export(id: string): Promise<BuildTemplateMigrationPackage>
  import(input: unknown, options?: { dataSourceId?: string }): Promise<BuildTemplate>
}

export interface CreateServerOptions {
  templateStore?: BuildTemplateStore
  buildTaskStore?: BuildTaskStore
  buildTaskRunner?: BuildTaskRunner
}

export async function createServer(repository: ApiRepository, options: CreateServerOptions = {}) {
  const app = Fastify({ logger: false })
  const templateStore = options.templateStore ?? createFileTemplateStore()
  const buildTaskStore = options.buildTaskStore ?? createMemoryBuildTaskStore()
  const buildTaskRunner = options.buildTaskRunner ?? createCliBuildTaskRunner()

  await app.register(cors, { origin: true })
  await registerDatasourceRoutes(app, repository)
  await registerPreflightRoutes(app, repository, templateStore)
  await registerTemplateRoutes(app, templateStore)
  await registerBuildTaskRoutes(app, repository, templateStore, buildTaskStore, buildTaskRunner)
  await registerSearchRoutes(app, repository)
  await registerDetailsRoutes(app, repository)
  await registerVersionRoutes(app, repository)
  await registerQualityRoutes(app, repository)

  return app
}
