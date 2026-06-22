import { describe, expect, it } from 'vitest'

import type { ApiRepository, SearchResult } from '../src/server.js'
import { createServer } from '../src/server.js'

function createRepository(overrides: Partial<ApiRepository> = {}): ApiRepository {
  return {
    search: async () => [],
    getLine: async () => null,
    getPoint: async () => null,
    getLatestVersion: async () => null,
    getLatestQuality: async () => null,
    ...overrides,
  }
}

describe('search route', () => {
  it('returns typed search results for guid, gdbm, qdbm, and zdbm queries', async () => {
    const seenQueries: string[] = []
    const app = await createServer(createRepository({
      search: async (query): Promise<SearchResult[]> => {
        seenQueries.push(query)
        return [
          { type: 'line', id: 'line-1', label: query, longitude: 120.1, latitude: 31.1 },
          { type: 'point', id: 'point-1', label: query, longitude: 120.2, latitude: 31.2 },
        ]
      },
    }))

    try {
      for (const query of ['GUID-1', 'GDBM-1', 'QDBM-1', 'ZDBM-1']) {
        const response = await app.inject({ method: 'GET', url: `/api/search?q=${query}` })

        expect(response.statusCode).toBe(200)
        expect(response.json()).toEqual({
          results: [
            { type: 'line', id: 'line-1', label: query, longitude: 120.1, latitude: 31.1 },
            { type: 'point', id: 'point-1', label: query, longitude: 120.2, latitude: 31.2 },
          ],
        })
      }

      expect(seenQueries).toEqual(['GUID-1', 'GDBM-1', 'QDBM-1', 'ZDBM-1'])
    } finally {
      await app.close()
    }
  })

  it('returns an empty result set without querying the repository for blank search', async () => {
    let searchCalls = 0
    const app = await createServer(createRepository({
      search: async () => {
        searchCalls += 1
        return []
      },
    }))

    try {
      const response = await app.inject({ method: 'GET', url: '/api/search?q=%20%20' })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ results: [] })
      expect(searchCalls).toBe(0)
    } finally {
      await app.close()
    }
  })
})
