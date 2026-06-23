#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import type { PipeLineRawRow, PointFacilityRawRow } from '@new-qp3d/shared'
import type { Mesh } from './geometry/mesh.js'
import type { SridCount } from './datasource/postgis.js'
import type { QualityReportInput, SridValidationReport } from './quality/report.js'
import type { PipelineConfig } from './config.js'
import type { BoundingVolumeBox, FeatureMetadata, TilesetChildInput } from './tiles/tilesetWriter.js'

import { getPipeColor } from '@new-qp3d/shared'
import { loadPipelineConfig } from './config.js'
import { PostgisDataSource } from './datasource/postgis.js'
import { createGeoReference, sourceCoordinateToWgs84, type GeoReference, type Wgs84Position } from './geometry/georeference.js'
import { computeVertexNormals, createEmptyMesh } from './geometry/mesh.js'
import { createNodeMesh } from './geometry/nodeMesh.js'
import { createPipeMesh } from './geometry/pipeMesh.js'
import { parseWkbGeometry } from './geometry/wkb.js'
import { computePipeCenterHeights } from './normalize/height.js'
import { parsePipeSpec } from './normalize/spec.js'
import { publishVersion, validatePublishedVersion } from './publish/versionStore.js'
import { createQualityReport } from './quality/report.js'
import { writeFeatureMetadataSidecar, writeGlb } from './tiles/glbWriter.js'
import { writeTileset } from './tiles/tilesetWriter.js'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
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
  tileOptions?: Partial<TileBuildOptions>
}

interface BuildFeature {
  metadata: FeatureMetadata
  mesh: Mesh
  kind: 'line' | 'point'
}

interface TileBuildOptions {
  maxFeaturesPerTile: number
  maxDepth: number
  maxTileBytes: number
}

interface FeatureBounds {
  minX: number
  minY: number
  minZ: number
  maxX: number
  maxY: number
  maxZ: number
}

interface FeatureTile {
  id: string
  depth: number
  bounds: FeatureBounds
  features: BuildFeature[]
}

interface TiledFeatureFiles {
  files: Record<string, string | Uint8Array>
  children: TilesetChildInput[]
  boundingVolume: BoundingVolumeBox
}

interface ParsedLineFeature {
  metadata: FeatureMetadata
  coordinates: Wgs84Position[]
  spec: ReturnType<typeof parsePipeSpec>
  flags: string[]
}

interface ParsedPointFeature {
  metadata: FeatureMetadata
  position: Wgs84Position
  flags: string[]
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
  const config = loadPipelineConfig()
  const inspection = await new PostgisDataSource(config).inspect()
  console.log(JSON.stringify(inspection, null, 2))
}

async function build(options: Record<string, string | boolean>): Promise<void> {
  const source = stringOption(options, 'source') ?? 'sample'
  const outputOption = stringOption(options, 'output')
  const outputRoot = outputOption ?? process.env.QP3D_OUTPUT_ROOT ?? 'data/tiles'

  if (source === 'postgis') {
    const config = loadPipelineConfig(outputOption === undefined ? {} : { QP3D_OUTPUT_ROOT: outputOption })
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
  const fixtureRoot = resolve(REPO_ROOT, 'fixtures/pipeline')
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
  const parsedLines: ParsedLineFeature[] = []
  const parsedPoints: ParsedPointFeature[] = []
  const flags: Array<{ featureId: string, flag: string }> = []
  let totalLines = 0
  let totalPoints = 0

  for await (const line of input.dataSource.readLines(input.limit)) {
    totalLines += 1
    try {
      const result = parseLineFeature(line, parsedLines.length + parsedPoints.length + 1, input.expectedSrid)
      parsedLines.push(result)
      flags.push(...result.flags.map(flag => ({ featureId: line.guid, flag })))
    } catch {
      flags.push({ featureId: line.guid || `line-${totalLines}`, flag: 'invalid-geometry' })
    }
  }

  for await (const point of input.dataSource.readPoints(input.limit)) {
    totalPoints += 1
    try {
      const result = parsePointFeature(point, parsedLines.length + parsedPoints.length + 1, totalPoints, input.expectedSrid)
      parsedPoints.push(result)
      flags.push(...result.flags.map(flag => ({ featureId: result.metadata.businessId, flag })))
    } catch {
      flags.push({ featureId: point.gdbm ?? `point-${totalPoints}`, flag: 'invalid-geometry' })
    }
  }

  const geoReference = createBuildGeoReference(parsedLines, parsedPoints)
  const features = [
    ...parsedLines.map(line => buildLineFeature(line, geoReference)),
    ...parsedPoints.map(point => buildPointFeature(point, geoReference)),
  ]
  const metadata = features.map(({ metadata }) => metadata)
  const tiledFeatures = createTiledFeatureFiles(features, normalizeTileBuildOptions(input.tileOptions))
  const tilesetInput = {
    assetVersion: '1.1',
    geometricError: 500,
    boundingVolume: tiledFeatures.boundingVolume,
    children: tiledFeatures.children,
  }
  const tileset = writeTileset(geoReference
    ? { ...tilesetInput, transform: geoReference.transform }
    : tilesetInput)
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
      'root.glb': writeGlb(createEmptyMesh(), []),
      'metadata.json': `${JSON.stringify(writeFeatureMetadataSidecar(metadata), null, 2)}\n`,
      'quality-report.json': `${JSON.stringify(qualityReport, null, 2)}\n`,
      '.flow-mode': 'embedded\n',
      ...tiledFeatures.files,
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

function parseLineFeature(line: PipeLineRawRow, featureId: number, expectedSrid = 3857): ParsedLineFeature {
  const geometry = parseWkbGeometry(line.geomWkbHex)
  if (geometry.type !== 'LineString' || geometry.coordinates.length < 2)
    throw new Error('Line row does not contain a valid LineString')

  const spec = parsePipeSpec(line.gg)
  const heights = computePipeCenterHeights({
    spec,
    qdndbg: finiteOrNull(line.qdndbg),
    zdndbg: finiteOrNull(line.zdndbg),
    qdms: finiteOrNull(line.qdms),
    zdms: finiteOrNull(line.zdms),
    groundElevation: 0,
    defaultDepthMeters: 2.5,
  })
  const coordinates = geometry.coordinates.map((coordinate, index) => {
    if (!Number.isFinite(coordinate[0]) || !Number.isFinite(coordinate[1]))
      throw new Error('Line row contains non-finite coordinates')

    return sourceCoordinateToWgs84([
      coordinate[0],
      coordinate[1],
      index === 0 ? heights.startCenterZ : heights.endCenterZ,
    ], geometry.srid ?? expectedSrid)
  })
  const flags = [
    ...(geometry.srid != null && geometry.srid !== expectedSrid ? ['srid-mismatch'] : []),
    ...(spec.quality === 'defaulted' ? ['spec-defaulted'] : []),
    ...(heights.quality === 'defaulted' ? ['height-defaulted'] : []),
    ...(!line.qdbm || !line.zdbm ? ['endpoint-unmatched'] : []),
  ]
  const qualityStatus = flags.length > 0 ? 'abnormal' : 'normal'

  return {
    coordinates,
    spec,
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
        lx: line.lx,
        flowDirection: lineFlowDirection(line.lx),
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
    flags,
  }
}

function parsePointFeature(
  point: PointFacilityRawRow,
  featureId: number,
  ordinal: number,
  expectedSrid = 3857,
): ParsedPointFeature {
  const geometry = parseWkbGeometry(point.geomWkbHex)
  if (geometry.type !== 'Point')
    throw new Error('Point row does not contain a valid Point')

  const businessId = point.gdbm ?? `postgis-point-${ordinal}`
  if (!Number.isFinite(geometry.coordinates[0]) || !Number.isFinite(geometry.coordinates[1]))
    throw new Error('Point row contains non-finite coordinates')

  const flags = [
    ...(geometry.srid != null && geometry.srid !== expectedSrid ? ['srid-mismatch'] : []),
    ...(!point.gdbm ? ['missing-code'] : []),
  ]
  const qualityStatus = flags.length > 0 ? 'abnormal' : 'normal'

  return {
    position: sourceCoordinateToWgs84([
      geometry.coordinates[0],
      geometry.coordinates[1],
      finiteOrNull(point.dmbg) ?? 0,
    ], geometry.srid ?? expectedSrid),
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
    flags,
  }
}

function lineFlowDirection(lx: unknown): 'qdbm-to-zdbm' | 'zdbm-to-qdbm' {
  return String(lx ?? '').trim() === '1' ? 'qdbm-to-zdbm' : 'zdbm-to-qdbm'
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function createBuildGeoReference(
  lines: ParsedLineFeature[],
  points: ParsedPointFeature[],
): GeoReference | undefined {
  let longitudeSum = 0
  let latitudeSum = 0
  let heightSum = 0
  let count = 0

  for (const line of lines) {
    for (const coordinate of line.coordinates) {
      longitudeSum += coordinate.longitude
      latitudeSum += coordinate.latitude
      heightSum += coordinate.height
      count += 1
    }
  }

  for (const point of points) {
    longitudeSum += point.position.longitude
    latitudeSum += point.position.latitude
    heightSum += point.position.height
    count += 1
  }

  if (count === 0) {
    return undefined
  }

  return createGeoReference({
    longitude: longitudeSum / count,
    latitude: latitudeSum / count,
    height: heightSum / count,
  })
}

function buildLineFeature(line: ParsedLineFeature, geoReference: GeoReference | undefined): BuildFeature {
  const direction = line.metadata.properties.flowDirection === 'qdbm-to-zdbm'
    ? 'qdbm-to-zdbm'
    : 'zdbm-to-qdbm'

  return {
    kind: 'line',
    mesh: createPipeMesh({
      featureId: line.metadata.featureId,
      coordinates: line.coordinates.map(coordinate => toMeshCoordinate(coordinate, geoReference)),
      spec: line.spec,
      radialSegments: 12,
      flowDirection: direction,
      flowColor: pipeTypeColor(line.metadata.properties.pipeType),
    }),
    metadata: line.metadata,
  }
}

function pipeTypeColor(pipeType: unknown): [number, number, number] {
  const color = getPipeColor(typeof pipeType === 'string' ? pipeType : undefined)
  const hex = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color)
  if (!hex)
    return [0.54, 0.56, 0.6]

  return [
    Number.parseInt(hex[1] ?? '8A', 16) / 255,
    Number.parseInt(hex[2] ?? '8F', 16) / 255,
    Number.parseInt(hex[3] ?? '98', 16) / 255,
  ]
}

function buildPointFeature(point: ParsedPointFeature, geoReference: GeoReference | undefined): BuildFeature {
  const symbol = pointSymbol(point.metadata.properties.pointType)
  const sizeMeters = pointSymbolSizeMeters(symbol)

  return {
    kind: 'point',
    mesh: withStaticVertexAttributes(createNodeMesh({
      featureId: point.metadata.featureId,
      position: toMeshCoordinate(point.position, geoReference),
      symbol,
      sizeMeters,
    })),
    metadata: point.metadata,
  }
}

function pointSymbol(value: unknown): Parameters<typeof createNodeMesh>[0]['symbol'] {
  const type = typeof value === 'string' ? value : ''
  if (type.includes('四通'))
    return 'cross'
  if (type.includes('三通'))
    return 'tee'
  if (type.includes('双通'))
    return 'coupling'
  if (type.includes('弯头'))
    return 'bend'
  if (type.includes('变径'))
    return 'reducer'
  if (type.includes('闸门') || type.includes('阀门'))
    return 'valve'
  if (type.includes('消防栓'))
    return 'hydrant'
  if (type.includes('泵站'))
    return 'pump-station'
  if (type.includes('篦') || type.includes('雨水口'))
    return 'rect-grate'
  if (type.includes('井'))
    return 'well'
  if (type.includes('进水口'))
    return 'inlet'
  if (type.includes('排放口'))
    return 'reserved-outlet'
  return 'unknown-point'
}

function pointSymbolSizeMeters(symbol: Parameters<typeof createNodeMesh>[0]['symbol']): number {
  switch (symbol) {
    case 'well':
      return 4
    case 'bend':
    case 'coupling':
    case 'tee':
    case 'cross':
    case 'reducer':
    case 'valve':
      return 4
    case 'hydrant':
      return 3
    case 'pump-station':
      return 5
    case 'rect-grate':
    case 'inlet':
    case 'reserved-outlet':
      return 3
    case 'unknown-point':
    default:
      return 3.2
  }
}

function toMeshCoordinate(position: Wgs84Position, geoReference: GeoReference | undefined): [number, number, number] {
  return geoReference
    ? geoReference.toLocal(position)
    : [position.longitude, position.latitude, position.height]
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
        lx: undefined,
        flowDirection: 'zdbm-to-qdbm',
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

  const positionArray = new Float32Array(positions)
  const indexArray = new Uint32Array(indices)
  return {
    positions: positionArray,
    normals: computeVertexNormals(positionArray, indexArray),
    indices: indexArray,
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

  const positionArray = new Float32Array(positions)
  const indexArray = new Uint32Array(indices)
  return {
    positions: positionArray,
    normals: computeVertexNormals(positionArray, indexArray),
    indices: indexArray,
    featureIds: new Uint32Array(featureIds),
  }
}

function normalizeTileBuildOptions(options: Partial<TileBuildOptions> | undefined): TileBuildOptions {
  return {
    maxFeaturesPerTile: Math.max(1, Math.floor(options?.maxFeaturesPerTile ?? 2_000)),
    maxDepth: Math.max(0, Math.floor(options?.maxDepth ?? 8)),
    maxTileBytes: Math.max(1, Math.floor(options?.maxTileBytes ?? 4 * 1024 * 1024)),
  }
}

function createTiledFeatureFiles(features: BuildFeature[], options: TileBuildOptions): TiledFeatureFiles {
  const rootBounds = mergeFeatureBounds(features.map(featureBounds))
  const leaves = splitFeatureTile({
    id: 'root',
    depth: 0,
    bounds: rootBounds,
    features,
  }, options)
  const files: Record<string, string | Uint8Array> = {}
  const children: TilesetChildInput[] = []

  for (const leaf of leaves) {
    const mesh = combineMeshes(leaf.features.map(({ mesh }) => mesh))
    const metadata = leaf.features.map(({ metadata }) => metadata)
    const glbPath = `tiles/${leaf.id}.glb`
    const metadataPath = `tiles/${leaf.id}.metadata.json`

    files[glbPath] = writeGlb(mesh, metadata)
    files[metadataPath] = `${JSON.stringify(writeFeatureMetadataSidecar(metadata), null, 2)}\n`
    children.push({
      boundingVolume: createBoundingVolume(mesh),
      geometricError: 0,
      contentUri: glbPath,
      metadataUri: metadataPath,
    })
  }

  return {
    files,
    children,
    boundingVolume: boundsToBoundingVolume(rootBounds),
  }
}

function splitFeatureTile(tile: FeatureTile, options: TileBuildOptions): FeatureTile[] {
  if (tile.features.length === 0)
    return []

  if (
    tile.depth >= options.maxDepth
    || (
      tile.features.length <= options.maxFeaturesPerTile
      && estimatedTileBytes(tile.features) <= options.maxTileBytes
    )
  ) {
    return [tile]
  }

  const childBounds = splitBoundsXY(tile.bounds)
  const childFeatures = childBounds.map(() => new Array<BuildFeature>())
  for (const feature of tile.features) {
    const center = boundsCenter(featureBounds(feature))
    const index = childIndexForCenter(center, tile.bounds)
    childFeatures[index]?.push(feature)
  }

  const children = childFeatures.flatMap((features, index) => {
    if (features.length === 0)
      return []

    const child: FeatureTile = {
      id: `${tile.id}-${index}`,
      depth: tile.depth + 1,
      bounds: mergeFeatureBounds(features.map(featureBounds)),
      features,
    }
    if (features.length === tile.features.length)
      return [child]

    return splitFeatureTile(child, options)
  })

  return children.length > 0 ? children : [tile]
}

function estimatedTileBytes(features: BuildFeature[]): number {
  return features.reduce((sum, { mesh }) => sum
    + mesh.positions.byteLength
    + mesh.normals.byteLength
    + (mesh.texcoords?.byteLength ?? 0)
    + (mesh.colors?.byteLength ?? 0)
    + mesh.featureIds.byteLength
    + mesh.indices.byteLength, 0)
}

function childIndexForCenter(
  center: [number, number, number],
  bounds: FeatureBounds,
): number {
  const midX = (bounds.minX + bounds.maxX) / 2
  const midY = (bounds.minY + bounds.maxY) / 2
  const east = center[0] >= midX ? 1 : 0
  const north = center[1] >= midY ? 2 : 0
  return east + north
}

function splitBoundsXY(bounds: FeatureBounds): FeatureBounds[] {
  const midX = (bounds.minX + bounds.maxX) / 2
  const midY = (bounds.minY + bounds.maxY) / 2

  return [
    { ...bounds, maxX: midX, maxY: midY },
    { ...bounds, minX: midX, maxY: midY },
    { ...bounds, maxX: midX, minY: midY },
    { ...bounds, minX: midX, minY: midY },
  ]
}

function featureBounds(feature: BuildFeature): FeatureBounds {
  return meshBounds(feature.mesh)
}

function meshBounds(mesh: Mesh): FeatureBounds {
  if (mesh.positions.length === 0) {
    return {
      minX: 0,
      minY: 0,
      minZ: 0,
      maxX: 0,
      maxY: 0,
      maxZ: 0,
    }
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

  return { minX, minY, minZ, maxX, maxY, maxZ }
}

function mergeFeatureBounds(boundsList: FeatureBounds[]): FeatureBounds {
  if (boundsList.length === 0) {
    return {
      minX: 0,
      minY: 0,
      minZ: 0,
      maxX: 0,
      maxY: 0,
      maxZ: 0,
    }
  }

  const [first] = boundsList
  const merged: FeatureBounds = { ...first! }
  for (const bounds of boundsList.slice(1)) {
    merged.minX = Math.min(merged.minX, bounds.minX)
    merged.minY = Math.min(merged.minY, bounds.minY)
    merged.minZ = Math.min(merged.minZ, bounds.minZ)
    merged.maxX = Math.max(merged.maxX, bounds.maxX)
    merged.maxY = Math.max(merged.maxY, bounds.maxY)
    merged.maxZ = Math.max(merged.maxZ, bounds.maxZ)
  }
  return merged
}

function boundsCenter(bounds: FeatureBounds): [number, number, number] {
  return [
    (bounds.minX + bounds.maxX) / 2,
    (bounds.minY + bounds.maxY) / 2,
    (bounds.minZ + bounds.maxZ) / 2,
  ]
}

function boundsToBoundingVolume(bounds: FeatureBounds): BoundingVolumeBox {
  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerY = (bounds.minY + bounds.maxY) / 2
  const centerZ = (bounds.minZ + bounds.maxZ) / 2
  const halfX = Math.max((bounds.maxX - bounds.minX) / 2, 1)
  const halfY = Math.max((bounds.maxY - bounds.minY) / 2, 1)
  const halfZ = Math.max((bounds.maxZ - bounds.minZ) / 2, 1)
  return { box: [centerX, centerY, centerZ, halfX, 0, 0, 0, halfY, 0, 0, 0, halfZ] }
}

function combineMeshes(meshes: Mesh[]): Mesh {
  const totalPositionCount = meshes.reduce((sum, mesh) => sum + mesh.positions.length, 0)
  const totalIndexCount = meshes.reduce((sum, mesh) => sum + mesh.indices.length, 0)
  const totalFeatureIdCount = meshes.reduce((sum, mesh) => sum + mesh.featureIds.length, 0)
  const includesTexcoords = meshes.some(mesh => mesh.texcoords !== undefined)
  const totalTexcoordCount = includesTexcoords
    ? meshes.reduce((sum, mesh) => sum + (mesh.positions.length / 3) * 2, 0)
    : 0
  const includesColors = meshes.some(mesh => mesh.colors !== undefined)
  const totalColorCount = includesColors
    ? meshes.reduce((sum, mesh) => sum + (mesh.positions.length / 3) * 4, 0)
    : 0
  const positions = new Float32Array(totalPositionCount)
  const normals = new Float32Array(totalPositionCount)
  const texcoords = includesTexcoords ? new Float32Array(totalTexcoordCount) : undefined
  const colors = includesColors ? new Float32Array(totalColorCount) : undefined
  const indices = new Uint32Array(totalIndexCount)
  const featureIds = new Uint32Array(totalFeatureIdCount)
  let positionOffset = 0
  let texcoordOffset = 0
  let colorOffset = 0
  let indexOffset = 0
  let featureIdOffset = 0
  let vertexOffset = 0

  for (const mesh of meshes) {
    positions.set(mesh.positions, positionOffset)
    normals.set(mesh.normals, positionOffset)
    if (texcoords) {
      if (mesh.texcoords)
        texcoords.set(mesh.texcoords, texcoordOffset)
      else
        fillVertexTexcoords(texcoords, texcoordOffset, mesh.positions.length / 3, [0, -1])
      texcoordOffset += (mesh.positions.length / 3) * 2
    }
    if (colors) {
      if (mesh.colors)
        colors.set(mesh.colors, colorOffset)
      else
        fillVertexColors(colors, colorOffset, mesh.positions.length / 3, [1, 1, 1, 1])
      colorOffset += (mesh.positions.length / 3) * 4
    }
    featureIds.set(mesh.featureIds, featureIdOffset)
    for (let index = 0; index < mesh.indices.length; index += 1) {
      indices[indexOffset + index] = (mesh.indices[index] ?? 0) + vertexOffset
    }

    positionOffset += mesh.positions.length
    featureIdOffset += mesh.featureIds.length
    indexOffset += mesh.indices.length
    vertexOffset += mesh.positions.length / 3
  }

  const combined: Mesh = { positions, normals, indices, featureIds }
  if (texcoords)
    combined.texcoords = texcoords
  if (colors)
    combined.colors = colors
  return combined
}

function withStaticVertexAttributes(mesh: Mesh): Mesh {
  const vertexCount = mesh.positions.length / 3
  const texcoords = new Float32Array(vertexCount * 2)
  const colors = new Float32Array(vertexCount * 4)
  fillVertexTexcoords(texcoords, 0, vertexCount, [0, -1])
  fillVertexColors(colors, 0, vertexCount, [1, 1, 1, 1])
  return { ...mesh, texcoords, colors }
}

function fillVertexTexcoords(
  texcoords: Float32Array,
  offset: number,
  vertexCount: number,
  texcoord: [number, number],
): void {
  for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
    const texcoordIndex = offset + vertexIndex * 2
    texcoords[texcoordIndex] = texcoord[0]
    texcoords[texcoordIndex + 1] = texcoord[1]
  }
}

function fillVertexColors(
  colors: Float32Array,
  offset: number,
  vertexCount: number,
  color: [number, number, number, number],
): void {
  for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
    const colorIndex = offset + vertexIndex * 4
    colors[colorIndex] = color[0]
    colors[colorIndex + 1] = color[1]
    colors[colorIndex + 2] = color[2]
    colors[colorIndex + 3] = color[3]
  }
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
