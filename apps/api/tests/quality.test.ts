import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createPostgisRepository } from '../src/db/pool.js'

describe('latest quality repository', () => {
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
