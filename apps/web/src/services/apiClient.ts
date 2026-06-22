import type { VersionManifest } from '../cesium/layers'

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

export interface ApiClient {
  search(query: string): Promise<SearchResult[]>
  getLine(guid: string): Promise<PipeLineDetail>
  getPoint(gdbm: string): Promise<PipePointDetail>
  getLatestVersion(): Promise<VersionManifest>
  getLatestQuality(): Promise<QualityReport>
}

export type ApiFetcher = (input: string) => Promise<Response>

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
