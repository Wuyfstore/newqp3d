export type PointTypeSource = 'field' | 'topology-degree' | 'default'
export type PointSizeSource = 'field' | 'adjacent-line' | 'type-default'
export type PointElevationSource = 'field' | 'line-endpoint' | 'default'
export type NodeMatchReportSource = 'node-match-code' | 'node-match-nearest'
export type NodeMatchSource = NodeMatchReportSource | 'none'
type NodeConnectionMatchSource = 'code' | 'nearest'

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
  coordinates?: [number, number]
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
  nodeMatchSource: NodeMatchSource
  nearestMatchDistanceMeters?: number
}

export interface PointLineAdaptationReport {
  totalPoints: number
  matchedPoints: number
  sourceCounts: {
    pointType: Record<string, number>
    pointSize: Record<string, number>
    elevation: Record<string, number>
  }
  matchSourceCounts: Record<string, number>
  connectionDegreeCounts: Record<string, number>
  inferredTypeCounts: Record<string, number>
  nearestMatchConflicts: Array<{
    lineId: string
    endpoint: 'start' | 'end'
    candidatePointIds: string[]
    toleranceMeters: number
  }>
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
  nearestMatch?: {
    toleranceMeters: number
  }
}

interface NodeConnection {
  line: AdaptableLine
  endpoint: 'start' | 'end'
  vector: [number, number] | null
  matchSource: NodeConnectionMatchSource
  distanceMeters?: number
}

export function adaptPointFacilities(input: AdaptPointFacilitiesInput): {
  points: AdaptedPoint[]
  report: PointLineAdaptationReport
} {
  const connectionIndex = buildConnectionIndex(input.lines, input.points, input.nearestMatch)
  const points = input.points.map(point => adaptPoint(point, connectionIndex.connectionsByPointId.get(point.id) ?? [], input.defaults))
  const report = createAdaptationReport(points, connectionIndex.conflicts)
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
    nodeMatchSource: pointNodeMatchSource(connections),
    ...nearestDistanceProperties(connections),
  }
}

function buildConnectionIndex(
  lines: AdaptableLine[],
  points: AdaptablePoint[],
  nearestMatch: AdaptPointFacilitiesInput['nearestMatch'],
): {
  connectionsByPointId: Map<string, NodeConnection[]>
  conflicts: PointLineAdaptationReport['nearestMatchConflicts']
} {
  const connectionsByPointId = new Map<string, NodeConnection[]>()
  const pointsByCode = new Map<string, AdaptablePoint[]>()
  const matchedEndpointKeys = new Set<string>()
  const conflicts: PointLineAdaptationReport['nearestMatchConflicts'] = []

  for (const point of points) {
    if (point.code) {
      const values = pointsByCode.get(point.code) ?? []
      values.push(point)
      pointsByCode.set(point.code, values)
    }
  }

  for (const line of lines) {
    const startConnection: NodeConnection = {
      line,
      endpoint: 'start',
      vector: endpointVector(line.coordinates, 'start'),
      matchSource: 'code',
    }
    const endConnection: NodeConnection = {
      line,
      endpoint: 'end',
      vector: endpointVector(line.coordinates, 'end'),
      matchSource: 'code',
    }
    if (appendCodeConnections(connectionsByPointId, pointsByCode, line.startNodeId, startConnection)) {
      matchedEndpointKeys.add(endpointKey(line.id, 'start'))
    }
    if (appendCodeConnections(connectionsByPointId, pointsByCode, line.endNodeId, endConnection)) {
      matchedEndpointKeys.add(endpointKey(line.id, 'end'))
    }
  }

  const toleranceMeters = nearestMatch?.toleranceMeters ?? 0
  if (toleranceMeters > 0) {
    for (const line of lines) {
      appendNearestConnection(connectionsByPointId, conflicts, matchedEndpointKeys, line, 'start', points, toleranceMeters)
      appendNearestConnection(connectionsByPointId, conflicts, matchedEndpointKeys, line, 'end', points, toleranceMeters)
    }
  }

  return { connectionsByPointId, conflicts }
}

function appendCodeConnections(
  connectionsByPointId: Map<string, NodeConnection[]>,
  pointsByCode: Map<string, AdaptablePoint[]>,
  nodeId: string | null,
  connection: NodeConnection,
): boolean {
  if (!nodeId) {
    return false
  }

  const points = pointsByCode.get(nodeId) ?? []
  for (const point of points) {
    appendPointConnection(connectionsByPointId, point.id, connection)
  }
  return points.length > 0
}

function appendNearestConnection(
  connectionsByPointId: Map<string, NodeConnection[]>,
  conflicts: PointLineAdaptationReport['nearestMatchConflicts'],
  matchedEndpointKeys: Set<string>,
  line: AdaptableLine,
  endpoint: 'start' | 'end',
  points: AdaptablePoint[],
  toleranceMeters: number,
): void {
  if (matchedEndpointKeys.has(endpointKey(line.id, endpoint))) {
    return
  }

  const coordinate = endpointCoordinate(line.coordinates, endpoint)
  if (!coordinate) {
    return
  }

  const candidates = points
    .filter(point => point.coordinates !== undefined)
    .map(point => ({
      point,
      distanceMeters: distance2d(coordinate, point.coordinates!),
    }))
    .filter(candidate => candidate.distanceMeters <= toleranceMeters)
    .sort((left, right) => left.distanceMeters - right.distanceMeters)

  if (candidates.length === 1) {
    const [candidate] = candidates
    appendPointConnection(connectionsByPointId, candidate!.point.id, {
      line,
      endpoint,
      vector: endpointVector(line.coordinates, endpoint),
      matchSource: 'nearest',
      distanceMeters: candidate!.distanceMeters,
    })
    return
  }

  if (candidates.length > 1) {
    conflicts.push({
      lineId: line.id,
      endpoint,
      candidatePointIds: candidates.map(candidate => candidate.point.id),
      toleranceMeters,
    })
  }
}

function appendPointConnection(
  connectionsByPointId: Map<string, NodeConnection[]>,
  pointId: string,
  connection: NodeConnection,
): void {
  const values = connectionsByPointId.get(pointId) ?? []
  values.push(connection)
  connectionsByPointId.set(pointId, values)
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

function createAdaptationReport(
  points: AdaptedPoint[],
  nearestMatchConflicts: PointLineAdaptationReport['nearestMatchConflicts'],
): PointLineAdaptationReport {
  return {
    totalPoints: points.length,
    matchedPoints: points.filter(point => point.connectionDegree > 0).length,
    sourceCounts: {
      pointType: countBy(points.map(point => point.pointTypeSource)),
      pointSize: countBy(points.map(point => point.sizeSource)),
      elevation: countBy(points.map(point => point.elevationSource)),
    },
    matchSourceCounts: countBy(points
      .filter(point => point.nodeMatchSource !== 'none')
      .map(point => point.nodeMatchSource)),
    connectionDegreeCounts: countBy(points.map(point => String(point.connectionDegree))),
    inferredTypeCounts: countBy(points
      .filter(point => point.pointTypeSource === 'topology-degree')
      .map(point => point.pointType)),
    nearestMatchConflicts,
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

function pointNodeMatchSource(connections: NodeConnection[]): NodeMatchSource {
  if (connections.length === 0) {
    return 'none'
  }

  return connections.some(connection => connection.matchSource === 'code') ? 'node-match-code' : 'node-match-nearest'
}

function nearestDistanceProperties(connections: NodeConnection[]): { nearestMatchDistanceMeters?: number } {
  const nearestDistance = averageFinite(connections
    .filter(connection => connection.matchSource === 'nearest')
    .map(connection => connection.distanceMeters ?? Number.NaN))
  return nearestDistance == null ? {} : { nearestMatchDistanceMeters: nearestDistance }
}

function endpointKey(lineId: string, endpoint: 'start' | 'end'): string {
  return `${lineId}:${endpoint}`
}

function endpointCoordinate(coordinates: Array<[number, number]>, endpoint: 'start' | 'end'): [number, number] | null {
  const coordinate = endpoint === 'start' ? coordinates[0] : coordinates[coordinates.length - 1]
  return coordinate ?? null
}

function distance2d(left: [number, number], right: [number, number]): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1])
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
