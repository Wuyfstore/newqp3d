import { describe, expect, it } from 'vitest'

import type { ApiRepository } from '../src/server.js'
import { createServer } from '../src/server.js'

function createRepository(overrides: Partial<ApiRepository> = {}): ApiRepository {
  return {
    search: async () => [],
    getLine: async () => null,
    getPoint: async () => null,
    getLatestVersion: async () => null,
    getLatestQuality: async () => null,
    listVersions: async () => [],
    getVersion: async () => null,
    getQualityReport: async () => null,
    getAdaptationReport: async () => null,
    publishVersion: async () => null,
    rollbackVersion: async () => null,
    ...overrides,
  }
}

describe('detail routes', () => {
  it('returns a line detail by guid from the repository', async () => {
    const app = await createServer(createRepository({
      getLine: async guid => ({ guid, qdbm: 'Q-1', zdbm: 'Z-1' }),
    }))

    try {
      const response = await app.inject({ method: 'GET', url: '/api/lines/line-1' })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ guid: 'line-1', qdbm: 'Q-1', zdbm: 'Z-1' })
    } finally {
      await app.close()
    }
  })

  it('returns a point detail by gdbm from the repository', async () => {
    const app = await createServer(createRepository({
      getPoint: async gdbm => ({ gdbm, lbmc: 'inspection well' }),
    }))

    try {
      const response = await app.inject({ method: 'GET', url: '/api/points/point-1' })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ gdbm: 'point-1', lbmc: 'inspection well' })
    } finally {
      await app.close()
    }
  })

  it('returns 404 when a detail row is missing', async () => {
    const app = await createServer(createRepository())

    try {
      const lineResponse = await app.inject({ method: 'GET', url: '/api/lines/missing-line' })
      const pointResponse = await app.inject({ method: 'GET', url: '/api/points/missing-point' })

      expect(lineResponse.statusCode).toBe(404)
      expect(pointResponse.statusCode).toBe(404)
    } finally {
      await app.close()
    }
  })
})
