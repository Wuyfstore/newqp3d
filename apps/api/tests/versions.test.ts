import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createPostgisRepository } from '../src/db/pool.js'
import type { ApiRepository } from '../src/server.js'
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

describe('version and quality routes', () => {
  it('returns the latest version manifest from the repository', async () => {
    const latest = {
      version: 'network-20260621-1500',
      tilesetUrl: '/tiles/network-20260621-1500/tileset.json',
      qualityReportUrl: '/tiles/network-20260621-1500/quality-report.json',
    }
    const app = await createServer(createRepository({
      getLatestVersion: async () => latest,
    }))

    try {
      const response = await app.inject({ method: 'GET', url: '/api/versions/latest' })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual(latest)
    } finally {
      await app.close()
    }
  })

  it('returns the latest quality report from the repository', async () => {
    const quality = {
      versionId: 'network-20260621-1500',
      totalLines: 10,
      totalPoints: 4,
      flags: [],
      flagCounts: {},
    }
    const app = await createServer(createRepository({
      getLatestQuality: async () => quality,
    }))

    try {
      const response = await app.inject({ method: 'GET', url: '/api/quality/latest' })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual(quality)
    } finally {
      await app.close()
    }
  })

  it('returns 404 when no latest version or quality report exists', async () => {
    const app = await createServer(createRepository())

    try {
      const versionResponse = await app.inject({ method: 'GET', url: '/api/versions/latest' })
      const qualityResponse = await app.inject({ method: 'GET', url: '/api/quality/latest' })

      expect(versionResponse.statusCode).toBe(404)
      expect(qualityResponse.statusCode).toBe(404)
    } finally {
      await app.close()
    }
  })

  it('reads the quality report for the version named by latest manifest', async () => {
    const outputRoot = await makeTempDir('qp3d-api-quality-')
    await mkdir(join(outputRoot, 'network-20260621-1500'), { recursive: true })
    await writeFile(join(outputRoot, 'latest.json'), JSON.stringify({
      version: 'network-20260621-1500',
      tilesetUrl: '/tiles/network-20260621-1500/tileset.json',
      qualityReportUrl: '/tiles/network-20260621-1500/quality-report.json',
    }))
    await writeFile(join(outputRoot, 'network-20260621-1500', 'quality-report.json'), JSON.stringify({
      versionId: 'network-20260621-1500',
      totalLines: 1,
    }))

    const repository = createPostgisRepository({
      databaseUrl: 'postgres://example.invalid/qp3d',
      lineTable: 'public.lines',
      pointTable: 'public.points',
      outputRoot,
    })

    await expect(repository.getLatestQuality()).resolves.toEqual({
      versionId: 'network-20260621-1500',
      totalLines: 1,
    })
  })
})

async function makeTempDir(prefix: string): Promise<string> {
  const path = join(tmpdir(), `${prefix}${randomUUID()}`)
  await mkdir(path, { recursive: true })
  return path
}
