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
    getVersion: async () => null,
    getQualityReport: async () => null,
    getAdaptationReport: async () => null,
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

  it('returns version-specific quality and adaptation reports from the repository', async () => {
    const app = await createServer(createRepository({
      getQualityReport: async version => ({
        versionId: version,
        templateId: 'template-1',
        templateVersion: '1.0.0',
        recordCount: 14,
        successCount: 12,
        failureCount: 2,
        tileStats: { count: 3, maxBytes: 4096, averageBytes: 2048 },
      }),
      getAdaptationReport: async version => ({
        versionId: version,
        totalPoints: 4,
        matchedPoints: 3,
        sourceCounts: {
          pointType: { 'topology-degree': 2 },
          pointSize: { 'adjacent-line': 2 },
          elevation: { 'line-endpoint': 1 },
        },
        examples: [{ pointId: 'P-1', connectedLineIds: ['L-1'], sources: { pointType: 'topology-degree' } }],
      }),
    }))

    try {
      const qualityResponse = await app.inject({
        method: 'GET',
        url: '/api/versions/network-20260623-0817/quality-report',
      })
      const adaptationResponse = await app.inject({
        method: 'GET',
        url: '/api/versions/network-20260623-0817/adaptation-report',
      })

      expect(qualityResponse.statusCode).toBe(200)
      expect(qualityResponse.json()).toMatchObject({
        versionId: 'network-20260623-0817',
        templateId: 'template-1',
        tileStats: { count: 3 },
      })
      expect(adaptationResponse.statusCode).toBe(200)
      expect(adaptationResponse.json()).toMatchObject({
        versionId: 'network-20260623-0817',
        matchedPoints: 3,
        examples: [expect.objectContaining({ pointId: 'P-1' })],
      })
    } finally {
      await app.close()
    }
  })

  it('rejects unsafe version report paths', async () => {
    const app = await createServer(createRepository({
      getQualityReport: async () => ({ versionId: 'should-not-read' }),
      getAdaptationReport: async () => ({ versionId: 'should-not-read' }),
    }))

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/versions/..%2Fsecret/quality-report',
      })

      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ error: 'Invalid version id' })
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
    await writeFile(join(outputRoot, 'network-20260621-1500', 'adaptation-report.json'), JSON.stringify({
      versionId: 'network-20260621-1500',
      matchedPoints: 1,
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
    await expect(repository.getQualityReport('network-20260621-1500')).resolves.toEqual({
      versionId: 'network-20260621-1500',
      totalLines: 1,
    })
    await expect(repository.getAdaptationReport('network-20260621-1500')).resolves.toEqual({
      versionId: 'network-20260621-1500',
      matchedPoints: 1,
    })
    await expect(repository.getQualityReport('../secret')).rejects.toThrow('Invalid version id')
  })
})

async function makeTempDir(prefix: string): Promise<string> {
  const path = join(tmpdir(), `${prefix}${randomUUID()}`)
  await mkdir(path, { recursive: true })
  return path
}
