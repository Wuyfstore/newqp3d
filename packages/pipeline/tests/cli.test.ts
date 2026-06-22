import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import type { PipeLineRawRow, PointFacilityRawRow } from '@new-qp3d/shared'
import type { Mesh } from '../src/geometry/pipeMesh.js'

import { describe, expect, it } from 'vitest'
import { buildPostgisOverview, buildSample, createSampleMesh } from '../src/cli.js'

describe('createSampleMesh', () => {
  it('creates non-degenerate sample triangles with visible area', () => {
    const mesh = createSampleMesh([
      {
        guid: 'sample-line-1',
        coordinates: [
          [0, 0],
          [10, 0],
        ],
      },
    ])

    expect(mesh.indices.length).toBeGreaterThan(0)
    expect(totalTriangleArea(mesh)).toBeGreaterThan(0)
  })
})

describe('buildSample', () => {
  it('writes sample metadata with the same style contract as PostGIS builds', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'qp3d-sample-build-'))

    await buildSample(outputRoot)

    const latest = JSON.parse(await readFile(join(outputRoot, 'latest.json'), 'utf8')) as {
      version: string
      metadataUrl: string
    }
    const metadata = JSON.parse(
      await readFile(join(outputRoot, latest.version, 'metadata.json'), 'utf8'),
    ) as {
      features: Array<{
        properties: Record<string, unknown>
      }>
    }

    expect(latest.metadataUrl).toBe(`/tiles/${latest.version}/metadata.json`)
    expect(metadata.features[0]?.properties).toEqual(expect.objectContaining({
      type: 'line',
      featureType: 'line',
      pipeType: expect.any(String),
      owner: expect.any(String),
      qualityStatus: 'normal',
    }))
  })
})

describe('buildPostgisOverview', () => {
  it('publishes versioned overview files from a fake PostGIS datasource', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'qp3d-postgis-overview-'))
    const receivedLimits: Array<{ kind: 'line' | 'point', limit: number | undefined }> = []
    const dataSource = {
      async inspect() {
        return {
          lineSrids: [{ srid: 3857, count: 1 }, { srid: 4326, count: 1 }],
          pointSrids: [{ srid: 3857, count: 1 }],
        }
      },
      async *readLines(limit?: number): AsyncIterable<PipeLineRawRow> {
        receivedLimits.push({ kind: 'line', limit })
        yield {
          guid: 'line-1',
          qdbm: 'A',
          zdbm: 'B',
          cz: 'HDPE',
          dmcc: null,
          gg: 'DN300',
          qdms: null,
          zdms: null,
          qdndbg: null,
          zdndbg: null,
          gwlx: '雨水管',
          gs: '市政',
          msfs: null,
          lx: null,
          gdsx: null,
          gdcd: null,
          geomWkbHex: lineStringEwkb([[0, 0], [10, 0]], 4326),
        }
      },
      async *readPoints(limit?: number): AsyncIterable<PointFacilityRawRow> {
        receivedLimits.push({ kind: 'point', limit })
        yield {
          gdbm: 'point-1',
          hzb: null,
          zzb: null,
          lbmc: '检查井',
          dmbg: null,
          kj: null,
          js: null,
          ms: null,
          gg: null,
          jgcz: null,
          jgxz: null,
          jgcc: null,
          tag: null,
          geomWkbHex: pointEwkb([5, 5]),
        }
      },
    }

    const published = await buildPostgisOverview({
      outputRoot,
      version: 'network-test-postgis',
      dataSource,
    })

    expect(published.version).toBe('network-test-postgis')
    const qualityReport = JSON.parse(
      await readFile(join(outputRoot, 'network-test-postgis', 'quality-report.json'), 'utf8'),
    ) as {
      totalLines: number
      totalPoints: number
      generatedLineFeatures: number
      generatedPointFeatures: number
      flagCounts: Record<string, number>
      rowLimit?: number
      sridValidation?: {
        expectedSrid: number
        lineSrids: Array<{ srid: number, count: number }>
        pointSrids: Array<{ srid: number, count: number }>
        lineUnexpectedSrids: Array<{ srid: number, count: number }>
        pointUnexpectedSrids: Array<{ srid: number, count: number }>
        lineMismatchCount: number
        pointMismatchCount: number
      }
    }

    expect(receivedLimits).toEqual([
      { kind: 'line', limit: undefined },
      { kind: 'point', limit: undefined },
    ])
    expect(await readFile(join(outputRoot, 'latest.json'), 'utf8')).toContain('network-test-postgis')
    expect(await readFile(join(outputRoot, 'network-test-postgis', 'tileset.json'), 'utf8')).toContain('root.glb')
    expect((await readFile(join(outputRoot, 'network-test-postgis', 'root.glb'))).byteLength).toBeGreaterThan(20)
    const metadata = JSON.parse(
      await readFile(join(outputRoot, 'network-test-postgis', 'metadata.json'), 'utf8'),
    ) as {
      features: Array<{
        businessId: string
        properties: Record<string, unknown>
      }>
    }
    expect(metadata.features).toEqual([
      expect.objectContaining({
        businessId: 'line-1',
        properties: expect.objectContaining({
          guid: 'line-1',
          qdbm: 'A',
          zdbm: 'B',
          pipeType: '雨水管',
          owner: '市政',
          qualityStatus: 'abnormal',
          heightQuality: 'defaulted',
        }),
      }),
      expect.objectContaining({
        businessId: 'point-1',
        properties: expect.objectContaining({
          gdbm: 'point-1',
          pointType: '检查井',
          qualityStatus: 'normal',
        }),
      }),
    ])
    expect(qualityReport.totalLines).toBe(1)
    expect(qualityReport.totalPoints).toBe(1)
    expect(qualityReport.generatedLineFeatures).toBe(1)
    expect(qualityReport.generatedPointFeatures).toBe(1)
    expect(qualityReport.flagCounts['postgis-placeholder-geometry']).toBeUndefined()
    expect(qualityReport.flagCounts['srid-mismatch']).toBe(1)
    expect(qualityReport.flagCounts['height-defaulted']).toBe(1)
    expect(qualityReport.sridValidation).toEqual({
      expectedSrid: 3857,
      lineSrids: [{ srid: 3857, count: 1 }, { srid: 4326, count: 1 }],
      pointSrids: [{ srid: 3857, count: 1 }],
      lineUnexpectedSrids: [{ srid: 4326, count: 1 }],
      pointUnexpectedSrids: [],
      lineMismatchCount: 1,
      pointMismatchCount: 0,
    })
    expect(qualityReport.rowLimit).toBeUndefined()
    expect(totalTriangleArea(readGlbMesh(await readFile(join(outputRoot, 'network-test-postgis', 'root.glb'))))).toBeGreaterThan(0)
  })
})

function totalTriangleArea(mesh: Mesh): number {
  let area = 0
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const a = vertex(mesh, mesh.indices[index] ?? 0)
    const b = vertex(mesh, mesh.indices[index + 1] ?? 0)
    const c = vertex(mesh, mesh.indices[index + 2] ?? 0)
    area += triangleArea(a, b, c)
  }
  return area
}

function vertex(mesh: Mesh, index: number): [number, number, number] {
  const position = index * 3
  return [
    mesh.positions[position] ?? 0,
    mesh.positions[position + 1] ?? 0,
    mesh.positions[position + 2] ?? 0,
  ]
}

function triangleArea(a: [number, number, number], b: [number, number, number], c: [number, number, number]): number {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
  const cross = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ]
  return Math.hypot(cross[0], cross[1], cross[2]) / 2
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

function pointEwkb(coordinate: [number, number]): string {
  const buffer = Buffer.alloc(1 + 4 + 4 + 16)
  let offset = 0
  buffer.writeUInt8(1, offset)
  offset += 1
  buffer.writeUInt32LE(0x20000001, offset)
  offset += 4
  buffer.writeUInt32LE(3857, offset)
  offset += 4
  buffer.writeDoubleLE(coordinate[0], offset)
  buffer.writeDoubleLE(coordinate[1], offset + 8)
  return buffer.toString('hex')
}

function readGlbMesh(glb: Buffer): Mesh {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength)
  const jsonLength = view.getUint32(12, true)
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength)).trimEnd()) as {
    bufferViews: Array<{ byteOffset?: number, byteLength: number }>
    accessors: Array<{ count: number }>
  }
  const binOffset = 20 + jsonLength + 8
  const positionView = json.bufferViews[0]
  const indexView = json.bufferViews[2]
  if (!positionView || !indexView)
    throw new Error('Missing GLB mesh buffer views')

  return {
    positions: new Float32Array(
      glb.buffer,
      glb.byteOffset + binOffset + (positionView.byteOffset ?? 0),
      (json.accessors[0]?.count ?? 0) * 3,
    ),
    indices: new Uint32Array(
      glb.buffer,
      glb.byteOffset + binOffset + (indexView.byteOffset ?? 0),
      json.accessors[2]?.count ?? 0,
    ),
    featureIds: new Uint32Array(),
  }
}
