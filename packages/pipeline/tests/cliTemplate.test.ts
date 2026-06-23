import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createReferenceBuildTemplate, type BuildTemplate, type PipeLineRawRow, type PointFacilityRawRow } from '@new-qp3d/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PipelineConfig } from '../src/config.js'

const dataSourceConfigs: PipelineConfig[] = []

vi.mock('../src/datasource/postgis.js', () => {
  class MockPostgisDataSource {
    constructor(private readonly config: PipelineConfig) {
      dataSourceConfigs.push(config)
    }

    async *readLines(): AsyncIterable<PipeLineRawRow> {
      for (let index = 0; index < 4; index += 1) {
        yield {
          guid: `line-${index + 1}`,
          qdbm: `A-${index}`,
          zdbm: `B-${index}`,
          cz: 'HDPE',
          dmcc: null,
          gg: 'DN300',
          qdms: null,
          zdms: null,
          qdndbg: Number.NaN,
          zdndbg: Number.NaN,
          gwlx: '雨水管',
          gs: '市政',
          msfs: null,
          lx: '1',
          gdsx: null,
          gdcd: null,
          geomWkbHex: lineStringEwkb([
            [119.38 + index * 0.001, 31.57],
            [119.3804 + index * 0.001, 31.5704],
          ], 4326),
        }
      }
    }

    async *readPoints(): AsyncIterable<PointFacilityRawRow> {}
  }

  return {
    PostgisDataSource: MockPostgisDataSource,
  }
})

describe('pipeline CLI template builds', () => {
  beforeEach(() => {
    dataSourceConfigs.length = 0
    vi.stubEnv('QP3D_DATABASE_URL', 'postgres://template-cli.example/qp3d')
    vi.stubEnv('QP3D_EXPECTED_SRID', '4326')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('loads inline build template JSON and passes template LOD into PostGIS builds', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'qp3d-cli-template-'))
    const template = createCliTemplate()

    const { main } = await import('../src/cli.js')
    await main([
      'build',
      '--source',
      'postgis',
      '--output',
      outputRoot,
      '--template',
      JSON.stringify(template),
    ])

    expect(dataSourceConfigs[0]).toMatchObject({
      databaseUrl: 'postgres://template-cli.example/qp3d',
      lineTable: 'custom.line_assets',
      pointTable: 'custom.point_assets',
      expectedSrid: 4326,
      outputRoot,
      template,
      tileOptions: {
        maxFeaturesPerTile: 100,
        maxDepth: 2,
        maxTileBytes: 1,
      },
    })

    const latest = JSON.parse(await readFile(join(outputRoot, 'latest.json'), 'utf8')) as { version: string }
    const qualityReport = JSON.parse(
      await readFile(join(outputRoot, latest.version, 'quality-report.json'), 'utf8'),
    ) as { templateId?: string, templateVersion?: string }
    const tileset = JSON.parse(await readFile(join(outputRoot, latest.version, 'tileset.json'), 'utf8')) as {
      root: { children: unknown[] }
    }
    expect(tileset.root.children.length).toBeGreaterThan(1)
    expect(qualityReport).toMatchObject({
      templateId: template.id,
      templateVersion: template.version,
    })
  })

  it('uses the requested build version for template PostGIS builds', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'qp3d-cli-template-version-'))
    const template = createCliTemplate()

    const { main } = await import('../src/cli.js')
    await main([
      'build',
      '--source',
      'postgis',
      '--output',
      outputRoot,
      '--version',
      'network-manual-template',
      '--template',
      JSON.stringify(template),
    ])

    const latest = JSON.parse(await readFile(join(outputRoot, 'latest.json'), 'utf8')) as { version: string }
    expect(latest.version).toBe('network-manual-template')
    await expect(readFile(join(outputRoot, 'network-manual-template', 'tileset.json'), 'utf8')).resolves.toContain('asset')
  })

  it('rejects invalid template JSON before constructing the datasource', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'qp3d-cli-template-invalid-'))
    const template = createCliTemplate()
    template.lod.maxDepth = 0

    const { main } = await import('../src/cli.js')
    await expect(main([
      'build',
      '--source',
      'postgis',
      '--output',
      outputRoot,
      '--template',
      JSON.stringify(template),
    ])).rejects.toThrow(/Invalid build template: .*lod\.maxDepth/)

    expect(dataSourceConfigs).toHaveLength(0)
  })
})

function createCliTemplate(): BuildTemplate {
  const template = createReferenceBuildTemplate()
  template.lineTable = {
    ...template.lineTable,
    schema: 'custom',
    table: 'line_assets',
  }
  template.pointTable = {
    ...template.pointTable,
    schema: 'custom',
    table: 'point_assets',
  }
  template.lod = {
    maxFeaturesPerTile: 100,
    maxDepth: 2,
    maxTileBytes: 1,
    radialSegments: 12,
  }
  return template
}

function lineStringEwkb(coordinates: Array<[number, number]>, srid = 3857): string {
  const buffer = Buffer.alloc(1 + 4 + 4 + 4 + coordinates.length * 16)
  let offset = 0
  buffer.writeUInt8(1, offset)
  offset += 1
  buffer.writeUInt32LE(0x20000002, offset)
  offset += 4
  buffer.writeUInt32LE(srid, offset)
  offset += 4
  buffer.writeUInt32LE(coordinates.length, offset)
  offset += 4
  for (const [x, y] of coordinates) {
    buffer.writeDoubleLE(x, offset)
    buffer.writeDoubleLE(y, offset + 8)
    offset += 16
  }
  return buffer.toString('hex')
}
