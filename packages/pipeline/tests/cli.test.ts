import { mkdtemp, readFile, readdir } from 'node:fs/promises'
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
          qdndbg: Number.NaN,
          zdndbg: Number.NaN,
          gwlx: '雨水管',
          gs: '市政',
          msfs: null,
          lx: '1',
          gdsx: null,
          gdcd: null,
          geomWkbHex: lineStringEwkb([[119.38, 31.57], [119.381, 31.57]], 4326),
        }
      },
      async *readPoints(limit?: number): AsyncIterable<PointFacilityRawRow> {
        receivedLimits.push({ kind: 'point', limit })
        yield {
          gdbm: 'point-1',
          hzb: null,
          zzb: null,
          lbmc: '检查井',
          dmbg: Number.NaN,
          kj: null,
          js: null,
          ms: null,
          gg: null,
          jgcz: null,
          jgxz: null,
          jgcc: null,
          tag: null,
          geomWkbHex: pointEwkb([119.3805, 31.5705], 4326),
        }
      },
    }

    const published = await buildPostgisOverview({
      outputRoot,
      version: 'network-test-postgis',
      dataSource,
      tileOptions: {
        maxFeaturesPerTile: 1,
        maxDepth: 2,
      },
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
    const latest = JSON.parse(await readFile(join(outputRoot, 'latest.json'), 'utf8')) as {
      version: string
      flowMode?: string
      flowTilesetUrl?: string
    }
    expect(latest.version).toBe('network-test-postgis')
    expect(latest.flowMode).toBe('embedded')
    expect(latest.flowTilesetUrl).toBeUndefined()
    const tileset = JSON.parse(
      await readFile(join(outputRoot, 'network-test-postgis', 'tileset.json'), 'utf8'),
    ) as {
      root: {
        transform?: number[]
        boundingVolume: { box: number[] }
        content?: { uri: string }
        extras?: { featureMetadata?: unknown[] }
        children: Array<{
          content?: { uri: string }
          extras?: { metadataUri?: string }
        }>
      }
    }
    expect(tileset.root.transform).toHaveLength(16)
    expect([...tileset.root.transform ?? [], ...tileset.root.boundingVolume.box].every(Number.isFinite)).toBe(true)
    expect(Math.hypot(tileset.root.transform?.[12] ?? 0, tileset.root.transform?.[13] ?? 0, tileset.root.transform?.[14] ?? 0))
      .toBeGreaterThan(6_000_000)
    expect(Math.abs(tileset.root.boundingVolume.box[0])).toBeLessThan(1_000)
    expect(Math.abs(tileset.root.boundingVolume.box[1])).toBeLessThan(1_000)
    expect((await readFile(join(outputRoot, 'network-test-postgis', 'root.glb'))).byteLength).toBeGreaterThan(20)
    const tileNames = await readdir(join(outputRoot, 'network-test-postgis', 'tiles'))
    expect(tileNames.filter(name => name.endsWith('.glb')).length).toBeGreaterThanOrEqual(2)
    expect(tileNames.filter(name => name.endsWith('.metadata.json')).length).toBeGreaterThanOrEqual(2)
    expect(tileset.root.content).toBeUndefined()
    expect(tileset.root.children).toEqual(expect.arrayContaining([
      expect.objectContaining({
        content: expect.objectContaining({ uri: expect.stringMatching(/^tiles\/root-/) }),
        extras: expect.objectContaining({ metadataUri: expect.stringMatching(/^tiles\/root-/) }),
      }),
    ]))
    expect(tileset.root.extras?.featureMetadata).toBeUndefined()
    const childTileUris = tileset.root.children
      .map(child => child.content?.uri)
      .filter((uri): uri is string => uri !== undefined)
    expect(childTileUris.length).toBeGreaterThanOrEqual(2)
    const childMeshes = await Promise.all(
      childTileUris.map(async uri => readGlbMesh(await readFile(join(outputRoot, 'network-test-postgis', uri)))),
    )
    for (const childMesh of childMeshes) {
      expect(childMesh.normals.length).toBe(childMesh.positions.length)
      expect(childMesh.texcoords?.length).toBe((childMesh.positions.length / 3) * 2)
      expect(childMesh.colors?.length).toBe((childMesh.positions.length / 3) * 4)
    }
    const metadataUris = tileset.root.children
      .map(child => child.extras?.metadataUri)
      .filter((uri): uri is string => uri !== undefined)
    expect(metadataUris.length).toBeGreaterThanOrEqual(2)
    const tiledMetadataFeatures = (await Promise.all(
      metadataUris.map(async uri => (
        JSON.parse(await readFile(join(outputRoot, 'network-test-postgis', uri), 'utf8')) as {
          features: Array<{ businessId: string, featureId: number }>
        }
      ).features),
    )).flat()
    expect(tiledMetadataFeatures.map(feature => feature.businessId).sort()).toEqual(['line-1', 'point-1'])
    const lineMesh = childMeshes.find(mesh => totalTriangleArea(mesh) > 0 && featureVertexCount(mesh, 0) > 0)
    if (!lineMesh)
      throw new Error('Expected at least one non-empty child tile mesh')
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
          lx: '1',
          flowDirection: 'qdbm-to-zdbm',
          qualityStatus: 'abnormal',
          heightQuality: 'defaulted',
        }),
      }),
      expect.objectContaining({
        businessId: 'point-1',
        properties: expect.objectContaining({
          gdbm: 'point-1',
          pointType: '检查井',
          qualityStatus: 'abnormal',
        }),
      }),
    ])
    expect(qualityReport.totalLines).toBe(1)
    expect(qualityReport.totalPoints).toBe(1)
    expect(qualityReport.generatedLineFeatures).toBe(1)
    expect(qualityReport.generatedPointFeatures).toBe(1)
    expect(qualityReport.flagCounts['postgis-placeholder-geometry']).toBeUndefined()
    expect(qualityReport.flagCounts['srid-mismatch']).toBe(2)
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
    expect(totalTriangleArea(lineMesh)).toBeGreaterThan(0)
  })

  it('splits child tiles by estimated mesh payload even when feature count is low', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'qp3d-postgis-byte-split-'))
    const dataSource = {
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
      },
      async *readPoints(): AsyncIterable<PointFacilityRawRow> {},
    }

    await buildPostgisOverview({
      outputRoot,
      version: 'network-byte-split',
      dataSource,
      tileOptions: {
        maxFeaturesPerTile: 100,
        maxDepth: 2,
        maxTileBytes: 1,
      },
    })

    const tileset = JSON.parse(
      await readFile(join(outputRoot, 'network-byte-split', 'tileset.json'), 'utf8'),
    ) as {
      root: {
        children: Array<{ content?: { uri: string } }>
      }
    }

    expect(tileset.root.children.length).toBeGreaterThan(1)
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

function featureVertexCount(mesh: Mesh, featureId: number): number {
  return mesh.featureIds.filter(id => id === featureId).length
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

function pointEwkb(coordinate: [number, number], srid = 3857): string {
  const buffer = Buffer.alloc(1 + 4 + 4 + 16)
  let offset = 0
  buffer.writeUInt8(1, offset)
  offset += 1
  buffer.writeUInt32LE(0x20000001, offset)
  offset += 4
  buffer.writeUInt32LE(srid, offset)
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
    accessors: Array<{ bufferView: number, count: number }>
    meshes: Array<{ primitives: Array<{ attributes: { POSITION: number, NORMAL?: number, TEXCOORD_0?: number, COLOR_0?: number, _FEATURE_ID_0: number }, indices: number }> }>
  }
  const binOffset = 20 + jsonLength + 8
  const primitive = json.meshes[0]?.primitives[0]
  if (!primitive)
    throw new Error('Missing GLB primitive')

  const positionAccessorIndex = primitive.attributes.POSITION
  const normalAccessorIndex = primitive.attributes.NORMAL
  const featureAccessorIndex = primitive.attributes._FEATURE_ID_0
  const texcoordAccessorIndex = primitive.attributes.TEXCOORD_0
  const colorAccessorIndex = primitive.attributes.COLOR_0
  const indexAccessorIndex = primitive.indices
  const positionAccessor = json.accessors[positionAccessorIndex]
  const normalAccessor = normalAccessorIndex === undefined ? undefined : json.accessors[normalAccessorIndex]
  const featureAccessor = json.accessors[featureAccessorIndex]
  const indexAccessor = json.accessors[indexAccessorIndex]
  const positionView = json.bufferViews[positionAccessor?.bufferView ?? 0]
  const normalView = normalAccessor === undefined ? undefined : json.bufferViews[normalAccessor.bufferView]
  const featureView = json.bufferViews[featureAccessor?.bufferView ?? 0]
  const texcoordAccessor = texcoordAccessorIndex === undefined ? undefined : json.accessors[texcoordAccessorIndex]
  const texcoordView = texcoordAccessor === undefined ? undefined : json.bufferViews[texcoordAccessor.bufferView]
  const colorAccessor = colorAccessorIndex === undefined ? undefined : json.accessors[colorAccessorIndex]
  const colorView = colorAccessor === undefined ? undefined : json.bufferViews[colorAccessor.bufferView]
  const indexView = json.bufferViews[indexAccessor?.bufferView ?? 0]
  if (!positionAccessor || !featureAccessor || !indexAccessor || !positionView || !featureView || !indexView)
    throw new Error('Missing GLB mesh buffer views')

  return {
    positions: new Float32Array(
      glb.buffer,
      glb.byteOffset + binOffset + (positionView.byteOffset ?? 0),
      positionAccessor.count * 3,
    ),
    normals: normalView
      ? new Float32Array(
          glb.buffer,
          glb.byteOffset + binOffset + (normalView.byteOffset ?? 0),
          (normalAccessor?.count ?? 0) * 3,
        )
      : new Float32Array(),
    texcoords: texcoordView
      ? new Float32Array(
          glb.buffer,
          glb.byteOffset + binOffset + (texcoordView.byteOffset ?? 0),
          (texcoordAccessor?.count ?? 0) * 2,
        )
      : undefined,
    colors: colorView
      ? normalizedColorBytesToFloat32(new Uint8Array(
          glb.buffer,
          glb.byteOffset + binOffset + (colorView.byteOffset ?? 0),
          (colorAccessor?.count ?? 0) * 4,
        ))
      : undefined,
    indices: new Uint32Array(
      glb.buffer,
      glb.byteOffset + binOffset + (indexView.byteOffset ?? 0),
      indexAccessor.count,
    ),
    featureIds: new Uint32Array(
      glb.buffer,
      glb.byteOffset + binOffset + (featureView.byteOffset ?? 0),
      featureAccessor.count,
    ),
  }
}

function normalizedColorBytesToFloat32(colors: Uint8Array): Float32Array {
  const result = new Float32Array(colors.length)
  for (let index = 0; index < colors.length; index += 1)
    result[index] = (colors[index] ?? 0) / 255
  return result
}
