import type { VersionManifest } from '../cesium/layers'
import type { BuildTemplate } from '@new-qp3d/shared'

export interface SearchResult {
  type: 'line' | 'point'
  id: string
  label: string
  longitude?: number
  latitude?: number
}

export interface SearchResponse {
  results: SearchResult[]
}

export type PipeLineDetail = Record<string, unknown> & {
  guid?: string
  qdbm?: string
  zdbm?: string
}

export type PipePointDetail = Record<string, unknown> & {
  gdbm?: string
  lbmc?: string
}

export interface QualityReport {
  versionId?: string
  version?: string
  totalLines?: number
  totalPoints?: number
  flags?: unknown[]
  flagCounts?: Record<string, number>
  summary?: Record<string, unknown>
  [key: string]: unknown
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

export interface ApiClient {
  search(query: string): Promise<SearchResult[]>
  getLine(guid: string): Promise<PipeLineDetail>
  getPoint(gdbm: string): Promise<PipePointDetail>
  getLatestVersion(): Promise<VersionManifest>
  getLatestQuality(): Promise<QualityReport>
  listSchemas(): Promise<DataSourceSchema[]>
  listTables(schema: string): Promise<DataSourceTable[]>
  getTableProfile(schema: string, table: string): Promise<DataSourceTableProfile>
  createBuildTemplate(template: unknown): Promise<BuildTemplate>
}

export type ApiFetcher = (input: string, init?: RequestInit) => Promise<Response>

export function createApiClient(baseUrl: string, fetcher: ApiFetcher = input => fetch(input)): ApiClient {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '')

  return {
    async search(query) {
      const response = await getJson<SearchResponse>(
        fetcher,
        `${normalizedBaseUrl}/search?q=${encodeURIComponent(query)}`,
      )
      return response.results
    },
    getLine(guid) {
      return getJson<PipeLineDetail>(fetcher, `${normalizedBaseUrl}/lines/${encodeURIComponent(guid)}`)
    },
    getPoint(gdbm) {
      return getJson<PipePointDetail>(fetcher, `${normalizedBaseUrl}/points/${encodeURIComponent(gdbm)}`)
    },
    getLatestVersion() {
      return getJson<VersionManifest>(fetcher, `${normalizedBaseUrl}/versions/latest`)
    },
    getLatestQuality() {
      return getJson<QualityReport>(fetcher, `${normalizedBaseUrl}/quality/latest`)
    },
    async listSchemas() {
      const response = await getJson<{ schemas: DataSourceSchema[] }>(fetcher, `${normalizedBaseUrl}/datasource/schemas`)
      return response.schemas
    },
    async listTables(schema) {
      const response = await getJson<{ tables: DataSourceTable[] }>(
        fetcher,
        `${normalizedBaseUrl}/datasource/tables?schema=${encodeURIComponent(schema)}`,
      )
      return response.tables
    },
    getTableProfile(schema, table) {
      return getJson<DataSourceTableProfile>(
        fetcher,
        `${normalizedBaseUrl}/datasource/tables/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/profile`,
      )
    },
    createBuildTemplate(template) {
      return postJson<BuildTemplate>(fetcher, `${normalizedBaseUrl}/build-templates`, template)
    },
  }
}

async function getJson<T>(fetcher: ApiFetcher, url: string): Promise<T> {
  const response = await fetcher(url)
  if (!response.ok) {
    const statusText = response.statusText ? ` ${response.statusText}` : ''
    throw new Error(`GET ${url} returned ${response.status}${statusText}`)
  }

  return await response.json() as T
}

async function postJson<T>(fetcher: ApiFetcher, url: string, body: unknown): Promise<T> {
  const response = await fetcher(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const statusText = response.statusText ? ` ${response.statusText}` : ''
    throw new Error(`POST ${url} returned ${response.status}${statusText}`)
  }

  return await response.json() as T
}
