#!/usr/bin/env node
import { pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import type { PipeLineRawRow, PointFacilityRawRow } from '@new-qp3d/shared'
import type { Mesh } from './geometry/pipeMesh.js'
import type { SridCount } from './datasource/postgis.js'
import type { QualityReportInput, SridValidationReport } from './quality/report.js'
import type { PipelineConfig } from './config.js'
import type { BoundingVolumeBox, FeatureMetadata } from './tiles/tilesetWriter.js'

import { loadPipelineConfig } from './config.js'
import { PostgisDataSource } from './datasource/postgis.js'
import { createNodeMesh } from './geometry/nodeMesh.js'
import { createPipeMesh } from './geometry/pipeMesh.js'
import { parseWkbGeometry } from './geometry/wkb.js'
import { computePipeCenterHeights } from './normalize/height.js'
import { parsePipeSpec } from './normalize/spec.js'
import { publishVersion, validatePublishedVersion } from './publish/versionStore.js'
import { createQualityReport } from './quality/report.js'
import { writeFeatureMetadataSidecar, writeGlb } from './tiles/glbWriter.js'
import { writeTileset } from './tiles/tilesetWriter.js'

interface SampleLine {
  guid: string
  qdbm?: string
  zdbm?: string
  gwlx?: string
  gs?: string
  cz?: string
  gg?: string
  coordinates: Array<[number, number]>
}

interface SamplePoint {
  guid: string
  code?: string
  type?: string
  gwlx?: string
  gs?: string
  coordinates: [number, number]
}

interface ParsedArgs {
  command: string | undefined
  options: Record<string, string | boolean>
}

interface PostgisOverviewDataSource {
  inspect?(): Promise<{ lineSrids: SridCount[], pointSrids: SridCount[] }>
  readLines(limit?: number): AsyncIterable<PipeLineRawRow>
  readPoints(limit?: number): AsyncIterable<PointFacilityRawRow>
}

interface BuildPostgisOverviewInput {
  outputRoot: string
  version?: string
  dataSource: PostgisOverviewDataSource
  limit?: number
  expectedSrid?: number
}

interface BuildFeature {
  metadata: FeatureMetadata
  mesh: Mesh
  kind: 'line' | 'point'
}

interface LineBuildResult {
  feature: BuildFeature
  flags: string[]
}

interface PointBuildResult {
  feature: BuildFeature
  flags: string[]
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const parsed = parseArgs(argv)

  switch (parsed.command) {
    case 'inspect-db':
      await inspectDb()
      break
    case 'build':
      await build(parsed.options)
      break
    case 'validate':
      await validate(parsed.options)
      break
    default:
      printUsage()
      process.exitCode = parsed.command ? 1 : 0
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv
  const options: Record<string, string | boolean> = {}

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]
    if (!arg?.startsWith('--')) {
      continue
    }

    const key = arg.slice(2)
    const value = rest[index + 1]
    if (value && !value.startsWith('--')) {
      options[key] = value
      index += 1
    } else {
      options[key] = true
    }
  }

  return { command, options }
}

async function inspectDb(): Promise<void> {
  const config = loadPipelineConfig(process.env)
  const inspection = await new PostgisDataSource(config).inspect()
  console.log(JSON.stringify(inspection, null, 2))
}

async function build(options: Record<string, string | boolean>): Promise<void> {
  const source = stringOption(options, 'source') ?? 'sample'
  const outputRoot = stringOption(options, 'output') ?? process.env.QP3D_OUTPUT_ROOT ?? 'data/tiles'

  if (source === 'postgis') {
    const config = loadPipelineConfig({ ...process.env, QP3D_OUTPUT_ROOT: outputRoot })
    const published = await buildPostgis(config)
    console.log(JSON.stringify(published.latest, null, 2))
    return
  }

  if (source !== 'sample') {
    throw new Error(`Unsupported build source: ${source}`)
  }

  const published = await buildSample(resolve(outputRoot))
  console.log(JSON.stringify(published.latest, null, 2))
}

async function buildPostgis(config: PipelineConfig) {
  return buildPostgisOverview({
    outputRoot: resolve(config.outputRoot),
    dataSource: new PostgisDataSource(config),
    expectedSrid: config.expectedSrid,
  })
}

async function validate(options: Record<string, string | boolean>): Promise<void> {
  const version = requiredStringOption(options, 'version')
  const outputRoot = stringOption(options, 'output') ?? process.env.QP3D_OUTPUT_ROOT ?? 'data/tiles'
  await validatePublishedVersion(resolve(outputRoot), version)
  console.log(`Validated ${version}`)
}

export async function buildSample(outputRoot: string) {
  const version = `network-${formatVersionDate(new Date())}`
  const fixtureRoot = resolve('fixtures/pipeline')
  const lines = await readJson<SampleLine[]>(join(fixtureRoot, 'sample-lines.json'))
  const points = await readJson<SamplePoint[]>(join(fixtureRoot, 'sample-points.json'))
  const metadata = createMetadata(lines, points)
  const mesh = createSampleMesh(lines)
  const tileset = writeTileset({
    assetVersion: '1.1',
    geometricError: 500,
    rootUri: 'root.glb',
    boundingVolume: { box: [10, 5, 0, 20, 0, 0, 0, 10, 0, 0, 0, 20] },
    metadata,
  })
  const qualityReport = createQualityReport({
    versionId: version,
    totalLines: lines.length,
    totalPoints: points.length,
    generatedLineFeatures: lines.length,
    generatedPointFeatures: points.length,
    flags: [],
    groupCounts: {
      gwlx: countBy([...lines, ...points], 'gwlx'),
      gs: countBy([...lines, ...points], 'gs'),
    },
  })

  return publishVersion({
    outputRoot,
    version,
    files: {
      'tileset.json': `${JSON.stringify(tileset, null, 2)}\n`,
      'root.glb': writeGlb(mesh, metadata),
      'metadata.json': `${JSON.stringify(writeFeatureMetadataSidecar(metadata), null, 2)}\n`,
      'quality-report.json': `${JSON.stringify(qualityReport, null, 2)}\n`,
    },
  })
}

export async function buildPostgisOverview(input: BuildPostgisOverviewInput) {
  const version = input.version ?? `network-${formatVersionDate(new Date())}`
  const expectedSrid = input.expectedSrid ?? 3857
  const sridValidation = await createSridValidation(input.dataSource, expectedSrid)
  const features: BuildFeature[] = []
  const flags: Array<{ featureId: string, flag: string }> = []
  let totalLines = 0
  let totalPoints = 0

  for await (const line of input.dataSource.readLines(input.limit)) {
    totalLines += 1
    try {
      const result = buildLineFeature(line, features.length + 1, input.expectedSrid)
      features.push(result.feature)
      flags.push(...result.flags.map(flag => ({ featureId: line.guid, flag })))
    } catch {
      flags.push({ featureId: line.guid || `line-${totalLines}`, flag: 'invalid-geometry' })
    }
  }

  for await (const point of input.dataSource.readPoints(input.limit)) {
    totalPoints += 1
    try {
      const result = buildPointFeature(point, features.length + 1, totalPoints, input.expectedSrid)
      features.push(result.feature)
      flags.push(...result.flags.map(flag => ({ featureId: result.feature.metadata.businessId, flag })))
    } catch {
      flags.push({ featureId: point.gdbm ?? `point-${totalPoints}`, flag: 'invalid-geometry' })
    }
  }

  const metadata = features.map(({ metadata }) => metadata)
  const mesh = combineMeshes(features.map(({ mesh }) => mesh))
  const tileset = writeTileset({
    assetVersion: '1.1',
    geometricError: 500,
    rootUri: 'root.glb',
    boundingVolume: createBoundingVolume(mesh),
    metadata,
  })
  const qualityReportInput: QualityReportInput = {
    versionId: version,
    totalLines,
    totalPoints,
    generatedLineFeatures: features.filter(({ kind }) => kind === 'line').length,
    generatedPointFeatures: features.filter(({ kind }) => kind === 'point').length,
    flags,
    groupCounts: {
      gwlx: countBy(metadata.map(({ properties }) => properties), 'pipeType'),
      gs: countBy(metadata.map(({ properties }) => properties), 'owner'),
    },
  }
  if (input.limit !== undefined)
    qualityReportInput.rowLimit = input.limit
  if (sridValidation !== undefined)
    qualityReportInput.sridValidation = sridValidation
  const qualityReport = createQualityReport(qualityReportInput)

  return publishVersion({
    outputRoot: input.outputRoot,
    version,
    files: {
      'tileset.json': `${JSON.stringify(tileset, null, 2)}\n`,
      'root.glb': writeGlb(mesh, metadata),
      'metadata.json': `${JSON.stringify(writeFeatureMetadataSidecar(metadata), null, 2)}\n`,
      'quality-report.json': `${JSON.stringify(qualityReport, null, 2)}\n`,
    },
  })
}

async function createSridValidation(
  dataSource: PostgisOverviewDataSource,
  expectedSrid: number,
): Promise<SridValidationReport | undefined> {
  if (!dataSource.inspect) {
    return undefined
  }

  const inspection = await dataSource.inspect()
  const lineUnexpectedSrids = inspection.lineSrids.filter(({ srid }) => srid !== expectedSrid)
  const pointUnexpectedSrids = inspection.pointSrids.filter(({ srid }) => srid !== expectedSrid)
  return {
    expectedSrid,
    lineSrids: inspection.lineSrids,
    pointSrids: inspection.pointSrids,
    lineUnexpectedSrids,
    pointUnexpectedSrids,
    lineMismatchCount: countSridRows(lineUnexpectedSrids),
    pointMismatchCount: countSridRows(pointUnexpectedSrids),
  }
}

function countSridRows(counts: SridCount[]): number {
  return counts.reduce((sum, { count }) => sum + count, 0)
}

function buildLineFeature(line: PipeLineRawRow, featureId: number, expectedSrid = 3857): LineBuildResult {
  const geometry = parseWkbGeometry(line.geomWkbHex)
  if (geometry.type !== 'LineString' || geometry.coordinates.length < 2)
    throw new Error('Line row does not contain a valid LineString')

  const spec = parsePipeSpec(line.gg)
  const heights = computePipeCenterHeights({
    spec,
    qdndbg: line.qdndbg,
    zdndbg: line.zdndbg,
    qdms: line.qdms,
    zdms: line.zdms,
    groundElevation: 0,
    defaultDepthMeters: 2.5,
  })
  const coordinates3d = geometry.coordinates.map((coordinate, index): [number, number, number] => [
    coordinate[0],
    coordinate[1],
    index === 0 ? heights.startCenterZ : heights.endCenterZ,
  ])
  const flags = [
    ...(geometry.srid != null && geometry.srid !== expectedSrid ? ['srid-mismatch'] : []),
    ...(spec.quality === 'defaulted' ? ['spec-defaulted'] : []),
    ...(heights.quality === 'defaulted' ? ['height-defaulted'] : []),
    ...(!line.qdbm || !line.zdbm ? ['endpoint-unmatched'] : []),
  ]
  const qualityStatus = flags.length > 0 ? 'abnormal' : 'normal'

  return {
    feature: {
      kind: 'line',
      mesh: createPipeMesh({
        featureId,
        coordinates: coordinates3d,
        spec,
        radialSegments: 8,
      }),
      metadata: {
        featureId,
        businessId: line.guid,
        properties: {
          guid: line.guid,
          id: line.guid,
          type: 'line',
          featureType: 'line',
          qdbm: line.qdbm,
          zdbm: line.zdbm,
          pipeType: line.gwlx ?? '未知',
          owner: line.gs ?? '未知',
          qualityStatus,
          cz: line.cz,
          gg: line.gg,
          gdcd: line.gdcd,
          qdms: line.qdms,
          zdms: line.zdms,
          qdndbg: line.qdndbg,
          zdndbg: line.zdndbg,
          heightQuality: heights.quality,
        },
      },
    },
    flags,
  }
}

function buildPointFeature(
  point: PointFacilityRawRow,
  featureId: number,
  ordinal: number,
  expectedSrid = 3857,
): PointBuildResult {
  const geometry = parseWkbGeometry(point.geomWkbHex)
  if (geometry.type !== 'Point')
    throw new Error('Point row does not contain a valid Point')

  const businessId = point.gdbm ?? `postgis-point-${ordinal}`
  const flags = [
    ...(geometry.srid != null && geometry.srid !== expectedSrid ? ['srid-mismatch'] : []),
    ...(!point.gdbm ? ['missing-code'] : []),
  ]
  const qualityStatus = flags.length > 0 ? 'abnormal' : 'normal'

  return {
    feature: {
      kind: 'point',
      mesh: createNodeMesh({
        featureId,
        position: [geometry.coordinates[0], geometry.coordinates[1], point.dmbg ?? 0],
        symbol: 'unknown-point',
        sizeMeters: 1,
      }),
      metadata: {
        featureId,
        businessId,
        properties: {
          gdbm: point.gdbm,
          id: businessId,
          type: 'point',
          featureType: 'point',
          pointType: point.lbmc ?? '未知',
          pipeType: point.lbmc ?? '未知',
          owner: point.tag ?? '未知',
          qualityStatus,
          dmbg: point.dmbg,
          kj: point.kj,
          js: point.js,
          gg: point.gg,
          jgcz: point.jgcz,
          jgxz: point.jgxz,
          jgcc: point.jgcc,
        },
      },
    },
    flags,
  }
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

function createMetadata(lines: SampleLine[], points: SamplePoint[]): FeatureMetadata[] {
  return [
    ...lines.map((line, index) => ({
      featureId: index + 1,
      businessId: line.guid,
      properties: {
        guid: line.guid,
        id: line.guid,
        type: 'line',
        featureType: 'line',
        qdbm: line.qdbm,
        zdbm: line.zdbm,
        gwlx: line.gwlx,
        pipeType: line.gwlx ?? '未知',
        gs: line.gs,
        owner: line.gs ?? '未知',
        cz: line.cz,
        gg: line.gg,
        qualityStatus: 'normal',
      },
    })),
    ...points.map((point, index) => ({
      featureId: lines.length + index + 1,
      businessId: point.guid,
      properties: {
        gdbm: point.code,
        id: point.guid,
        code: point.code,
        type: point.type,
        featureType: 'point',
        gwlx: point.gwlx,
        pointType: point.type ?? '未知',
        pipeType: point.type ?? point.gwlx ?? '未知',
        gs: point.gs,
        owner: point.gs ?? '未知',
        qualityStatus: 'normal',
      },
    })),
  ]
}

export function createSampleMesh(lines: SampleLine[]): Mesh {
  const positions: number[] = []
  const indices: number[] = []
  const featureIds: number[] = []

  lines.forEach((line, lineIndex) => {
    const z = lineIndex * 0.2
    for (let coordinateIndex = 0; coordinateIndex < line.coordinates.length - 1; coordinateIndex += 1) {
      const start = positions.length / 3
      const current = line.coordinates[coordinateIndex]
      const next = line.coordinates[coordinateIndex + 1]
      if (!current || !next)
        continue

      const [x1, y1] = current
      const [x2, y2] = next
      const dx = x2 - x1
      const dy = y2 - y1
      const length = Math.hypot(dx, dy)
      if (length === 0)
        continue

      const halfWidth = 0.5
      const normalX = (-dy / length) * halfWidth
      const normalY = (dx / length) * halfWidth
      positions.push(
        x1 - normalX, y1 - normalY, z,
        x1 + normalX, y1 + normalY, z,
        x2 - normalX, y2 - normalY, z,
        x2 + normalX, y2 + normalY, z,
      )
      featureIds.push(lineIndex + 1, lineIndex + 1, lineIndex + 1, lineIndex + 1)
      indices.push(start, start + 2, start + 1, start + 1, start + 2, start + 3)
    }
  })

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    featureIds: new Uint32Array(featureIds),
  }
}

export function createOverviewMesh(features: BuildFeature[]): Mesh {
  const positions: number[] = []
  const indices: number[] = []
  const featureIds: number[] = []
  const columns = Math.max(1, Math.ceil(Math.sqrt(features.length || 1)))

  features.forEach(({ metadata }, index) => {
    const featureId = metadata.featureId
    const start = positions.length / 3
    const column = index % columns
    const row = Math.floor(index / columns)
    const x = column * 2
    const y = row * 2
    const z = 0

    positions.push(
      x, y, z,
      x + 1, y, z,
      x, y + 1, z,
      x + 1, y + 1, z,
    )
    featureIds.push(featureId, featureId, featureId, featureId)
    indices.push(start, start + 1, start + 2, start + 2, start + 1, start + 3)
  })

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    featureIds: new Uint32Array(featureIds),
  }
}

function combineMeshes(meshes: Mesh[]): Mesh {
  const totalPositionCount = meshes.reduce((sum, mesh) => sum + mesh.positions.length, 0)
  const totalIndexCount = meshes.reduce((sum, mesh) => sum + mesh.indices.length, 0)
  const totalFeatureIdCount = meshes.reduce((sum, mesh) => sum + mesh.featureIds.length, 0)
  const positions = new Float32Array(totalPositionCount)
  const indices = new Uint32Array(totalIndexCount)
  const featureIds = new Uint32Array(totalFeatureIdCount)
  let positionOffset = 0
  let indexOffset = 0
  let featureIdOffset = 0
  let vertexOffset = 0

  for (const mesh of meshes) {
    positions.set(mesh.positions, positionOffset)
    featureIds.set(mesh.featureIds, featureIdOffset)
    for (let index = 0; index < mesh.indices.length; index += 1) {
      indices[indexOffset + index] = (mesh.indices[index] ?? 0) + vertexOffset
    }

    positionOffset += mesh.positions.length
    featureIdOffset += mesh.featureIds.length
    indexOffset += mesh.indices.length
    vertexOffset += mesh.positions.length / 3
  }

  return { positions, indices, featureIds }
}

function createBoundingVolume(mesh: Mesh): BoundingVolumeBox {
  if (mesh.positions.length === 0) {
    return { box: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1] }
  }

  let minX = mesh.positions[0] ?? 0
  let minY = mesh.positions[1] ?? 0
  let minZ = mesh.positions[2] ?? 0
  let maxX = minX
  let maxY = minY
  let maxZ = minZ

  for (let index = 3; index < mesh.positions.length; index += 3) {
    const x = mesh.positions[index] ?? minX
    const y = mesh.positions[index + 1] ?? minY
    const z = mesh.positions[index + 2] ?? minZ
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    minZ = Math.min(minZ, z)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
    maxZ = Math.max(maxZ, z)
  }

  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  const centerZ = (minZ + maxZ) / 2
  const halfX = Math.max((maxX - minX) / 2, 1)
  const halfY = Math.max((maxY - minY) / 2, 1)
  const halfZ = Math.max((maxZ - minZ) / 2, 1)
  return { box: [centerX, centerY, centerZ, halfX, 0, 0, 0, halfY, 0, 0, 0, halfZ] }
}

function countBy<T extends object>(items: T[], key: keyof T): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const item of items) {
    const value = item[key]
    if (typeof value === 'string' && value.length > 0) {
      counts[value] = (counts[value] ?? 0) + 1
    }
  }
  return counts
}

function formatVersionDate(date: Date): string {
  const pad = (value: number) => value.toString().padStart(2, '0')
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`
}

function stringOption(options: Record<string, string | boolean>, name: string): string | undefined {
  const value = options[name]
  return typeof value === 'string' ? value : undefined
}

function requiredStringOption(options: Record<string, string | boolean>, name: string): string {
  const value = stringOption(options, name)
  if (!value) {
    throw new Error(`Missing required option: --${name}`)
  }
  return value
}

function printUsage(): void {
  console.log(`Usage:
  pipe-network inspect-db
  pipe-network build --source sample --output data/tiles
  pipe-network build --source postgis --output data/tiles
  pipe-network validate --version network-YYYYMMDD-HHmm --output data/tiles`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
