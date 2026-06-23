export type PointTypeSource = 'field' | 'topology-degree' | 'default'
export type PointSizeSource = 'field' | 'adjacent-line' | 'type-default'
export type PointElevationSource = 'field' | 'line-endpoint' | 'default'

export interface AdaptationDefaults {
  pointSizeMeters: number
  surfaceElevationMeters: number
}

export interface AdaptableLine {
  id: string
  startNodeId: string | null
  endNodeId: string | null
  maxDiameterMeters: number | null
  startHeightMeters: number
  endHeightMeters: number
  coordinates: Array<[number, number]>
}

export interface AdaptablePoint {
  id: string
  code: string | null
  pointType: string | null
  sizeMeters: number | null
  elevationMeters: number | null
}

export interface AdaptedPoint {
  id: string
  code: string | null
  pointType: string
  pointTypeSource: PointTypeSource
  sizeMeters: number
  sizeSource: PointSizeSource
  elevationMeters: number
  elevationSource: PointElevationSource
  connectionDegree: number
  connectedLineIds: string[]
}

export interface PointLineAdaptationReport {
  totalPoints: number
  matchedPoints: number
  sourceCounts: {
    pointType: Record<string, number>
    pointSize: Record<string, number>
    elevation: Record<string, number>
  }
  connectionDegreeCounts: Record<string, number>
  inferredTypeCounts: Record<string, number>
  examples: Array<{
    pointId: string
    connectedLineIds: string[]
    sources: {
      pointType: PointTypeSource
      pointSize: PointSizeSource
      elevation: PointElevationSource
    }
  }>
}

export interface AdaptPointFacilitiesInput {
  defaults: AdaptationDefaults
  lines: AdaptableLine[]
  points: AdaptablePoint[]
}

interface NodeConnection {
  line: AdaptableLine
  endpoint: 'start' | 'end'
  vector: [number, number] | null
}

export function adaptPointFacilities(input: AdaptPointFacilitiesInput): {
  points: AdaptedPoint[]
  report: PointLineAdaptationReport
} {
  const connectionsByNode = buildConnectionsByNode(input.lines)
  const points = input.points.map(point => adaptPoint(point, connectionsByNode.get(point.code ?? '') ?? [], input.defaults))
  const report = createAdaptationReport(points)
  return { points, report }
}

function adaptPoint(
  point: AdaptablePoint,
  connections: NodeConnection[],
  defaults: AdaptationDefaults,
): AdaptedPoint {
  const pointType = inferPointType(point, connections)
  const size = inferPointSize(point, connections, defaults)
  const elevation = inferPointElevation(point, connections, defaults)

  return {
    id: point.id,
    code: point.code,
    pointType: pointType.value,
    pointTypeSource: pointType.source,
    sizeMeters: size.value,
    sizeSource: size.source,
    elevationMeters: elevation.value,
    elevationSource: elevation.source,
    connectionDegree: connections.length,
    connectedLineIds: connections.map(({ line }) => line.id),
  }
}

function buildConnectionsByNode(lines: AdaptableLine[]): Map<string, NodeConnection[]> {
  const connections = new Map<string, NodeConnection[]>()

  for (const line of lines) {
    appendConnection(connections, line.startNodeId, {
      line,
      endpoint: 'start',
      vector: endpointVector(line.coordinates, 'start'),
    })
    appendConnection(connections, line.endNodeId, {
      line,
      endpoint: 'end',
      vector: endpointVector(line.coordinates, 'end'),
    })
  }

  return connections
}

function appendConnection(
  connections: Map<string, NodeConnection[]>,
  nodeId: string | null,
  connection: NodeConnection,
): void {
  if (!nodeId) {
    return
  }

  const values = connections.get(nodeId) ?? []
  values.push(connection)
  connections.set(nodeId, values)
}

function inferPointType(
  point: AdaptablePoint,
  connections: NodeConnection[],
): { value: string, source: PointTypeSource } {
  if (point.pointType?.trim()) {
    return { value: point.pointType, source: 'field' }
  }

  const degree = connections.length
  if (degree === 1) {
    return { value: '端点', source: 'topology-degree' }
  }
  if (degree === 2) {
    return { value: isStraightThrough(connections) ? '双通' : '弯头', source: 'topology-degree' }
  }
  if (degree === 3) {
    return { value: '三通', source: 'topology-degree' }
  }
  if (degree >= 4) {
    return { value: '四通', source: 'topology-degree' }
  }

  return { value: '未知', source: 'default' }
}

function inferPointSize(
  point: AdaptablePoint,
  connections: NodeConnection[],
  defaults: AdaptationDefaults,
): { value: number, source: PointSizeSource } {
  if (point.sizeMeters != null && point.sizeMeters > 0) {
    return { value: point.sizeMeters, source: 'field' }
  }

  const adjacentSize = maxFinite(connections.map(({ line }) => line.maxDiameterMeters))
  if (adjacentSize != null && adjacentSize > 0) {
    return { value: adjacentSize, source: 'adjacent-line' }
  }

  return { value: defaults.pointSizeMeters, source: 'type-default' }
}

function inferPointElevation(
  point: AdaptablePoint,
  connections: NodeConnection[],
  defaults: AdaptationDefaults,
): { value: number, source: PointElevationSource } {
  if (point.elevationMeters != null && Number.isFinite(point.elevationMeters)) {
    return { value: point.elevationMeters, source: 'field' }
  }

  const lineElevation = averageFinite(connections.map(connection =>
    connection.endpoint === 'start'
      ? connection.line.startHeightMeters
      : connection.line.endHeightMeters,
  ))
  if (lineElevation != null) {
    return { value: lineElevation, source: 'line-endpoint' }
  }

  return { value: defaults.surfaceElevationMeters, source: 'default' }
}

function createAdaptationReport(points: AdaptedPoint[]): PointLineAdaptationReport {
  return {
    totalPoints: points.length,
    matchedPoints: points.filter(point => point.connectionDegree > 0).length,
    sourceCounts: {
      pointType: countBy(points.map(point => point.pointTypeSource)),
      pointSize: countBy(points.map(point => point.sizeSource)),
      elevation: countBy(points.map(point => point.elevationSource)),
    },
    connectionDegreeCounts: countBy(points.map(point => String(point.connectionDegree))),
    inferredTypeCounts: countBy(points
      .filter(point => point.pointTypeSource === 'topology-degree')
      .map(point => point.pointType)),
    examples: points
      .filter(point => (
        point.pointTypeSource !== 'field'
        || point.sizeSource !== 'field'
        || point.elevationSource !== 'field'
      ))
      .slice(0, 20)
      .map(point => ({
        pointId: point.id,
        connectedLineIds: point.connectedLineIds,
        sources: {
          pointType: point.pointTypeSource,
          pointSize: point.sizeSource,
          elevation: point.elevationSource,
        },
      })),
  }
}

function endpointVector(
  coordinates: Array<[number, number]>,
  endpoint: 'start' | 'end',
): [number, number] | null {
  if (coordinates.length < 2) {
    return null
  }

  const first = coordinates[0]
  const second = coordinates[1]
  const last = coordinates[coordinates.length - 1]
  const previous = coordinates[coordinates.length - 2]
  if (!first || !second || !last || !previous) {
    return null
  }

  const vector: [number, number] = endpoint === 'start'
    ? [second[0] - first[0], second[1] - first[1]]
    : [previous[0] - last[0], previous[1] - last[1]]
  const length = Math.hypot(vector[0], vector[1])
  if (length === 0) {
    return null
  }

  return [vector[0] / length, vector[1] / length]
}

function isStraightThrough(connections: NodeConnection[]): boolean {
  const vectors = connections.map(({ vector }) => vector).filter((vector): vector is [number, number] => vector != null)
  if (vectors.length < 2) {
    return false
  }

  const dot = vectors[0]![0] * vectors[1]![0] + vectors[0]![1] * vectors[1]![1]
  return dot < -0.75
}

function maxFinite(values: Array<number | null>): number | null {
  const finiteValues = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  return finiteValues.length > 0 ? Math.max(...finiteValues) : null
}

function averageFinite(values: number[]): number | null {
  const finiteValues = values.filter(value => Number.isFinite(value))
  if (finiteValues.length === 0) {
    return null
  }

  return finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1
  }
  return counts
}
