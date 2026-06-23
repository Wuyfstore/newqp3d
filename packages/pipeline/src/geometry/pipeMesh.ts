import type { PipeSpec } from '@new-qp3d/shared'
import type { Mesh } from './mesh.js'

import { createEmptyMesh } from './mesh.js'

export interface PipeMeshInput {
  featureId: number
  coordinates: Array<[number, number, number]>
  spec: PipeSpec
  radialSegments: number
  flowDirection?: 'qdbm-to-zdbm' | 'zdbm-to-qdbm'
  flowColor?: [number, number, number]
}

interface RingPoint {
  yOffset: number
  zOffset: number
}

interface RingFrame {
  side: [number, number, number]
  up: [number, number, number]
}

const MIN_RING_SEGMENTS = 4
const WORLD_UP: [number, number, number] = [0, 0, 1]
const DEFAULT_FLOW_COLOR: [number, number, number] = [0.54, 0.56, 0.6]

export function createPipeMesh(input: PipeMeshInput): Mesh {
  if (input.coordinates.length < 2)
    return emptyMesh()

  const ring = createRing(input.spec, input.radialSegments)
  const ringVertexCount = ring.length
  const vertexCount = input.coordinates.length * ringVertexCount
  const positions = new Float32Array(vertexCount * 3)
  const texcoords = new Float32Array(vertexCount * 2)
  const colors = new Float32Array(vertexCount * 4)
  const normals = new Float32Array(vertexCount * 3)
  const featureIds = new Uint32Array(vertexCount)
  const distances = cumulativeDistances(input.coordinates)
  const totalDistance = distances.at(-1) ?? 0
  const frames = createFrames(input.coordinates)

  featureIds.fill(input.featureId)
  writePositions(positions, input.coordinates, ring, frames)
  writeNormals(normals, input.coordinates, ring, frames)
  writeFlowAttributes(
    texcoords,
    colors,
    input.coordinates,
    ring,
    ringVertexCount,
    distances,
    totalDistance,
    input.flowDirection,
    input.flowColor ?? DEFAULT_FLOW_COLOR,
  )
  const indices = createIndices(input.coordinates.length, ringVertexCount)

  return {
    positions,
    normals,
    texcoords,
    colors,
    indices,
    featureIds,
  }
}

function writeNormals(
  normals: Float32Array,
  coordinates: Array<[number, number, number]>,
  ring: RingPoint[],
  frames: RingFrame[],
): void {
  const ringVertexCount = ring.length

  for (let coordinateIndex = 0; coordinateIndex < coordinates.length; coordinateIndex += 1) {
    const frame = frames[coordinateIndex] ?? defaultFrame()

    for (let ringIndex = 0; ringIndex < ringVertexCount; ringIndex += 1) {
      const vertexIndex = coordinateIndex * ringVertexCount + ringIndex
      const normalIndex = vertexIndex * 3
      const ringPoint = ring[ringIndex]
      if (!ringPoint)
        continue

      const normal = normalize([
        frame.side[0] * ringPoint.yOffset + frame.up[0] * ringPoint.zOffset,
        frame.side[1] * ringPoint.yOffset + frame.up[1] * ringPoint.zOffset,
        frame.side[2] * ringPoint.yOffset + frame.up[2] * ringPoint.zOffset,
      ])
      normals[normalIndex] = normal[0]
      normals[normalIndex + 1] = normal[1]
      normals[normalIndex + 2] = normal[2]
    }
  }
}

function emptyMesh(): Mesh {
  return createEmptyMesh()
}

function createRing(spec: PipeSpec, radialSegments: number): RingPoint[] {
  if (spec.kind === 'box')
    return createBoxRing(spec.widthMm / 2000, spec.heightMm / 2000)

  return createRoundRing(spec.diameterMm / 2000, Math.max(MIN_RING_SEGMENTS, Math.floor(radialSegments)))
}

function createRoundRing(radiusMeters: number, radialSegments: number): RingPoint[] {
  const ring = new Array<RingPoint>(radialSegments)
  for (let index = 0; index < radialSegments; index += 1) {
    const angle = (index / radialSegments) * Math.PI * 2
    ring[index] = {
      yOffset: Math.cos(angle) * radiusMeters,
      zOffset: Math.sin(angle) * radiusMeters,
    }
  }
  return ring
}

function createBoxRing(halfWidthMeters: number, halfHeightMeters: number): RingPoint[] {
  return [
    { yOffset: -halfWidthMeters, zOffset: -halfHeightMeters },
    { yOffset: halfWidthMeters, zOffset: -halfHeightMeters },
    { yOffset: halfWidthMeters, zOffset: halfHeightMeters },
    { yOffset: -halfWidthMeters, zOffset: halfHeightMeters },
  ]
}

function writePositions(
  positions: Float32Array,
  coordinates: Array<[number, number, number]>,
  ring: RingPoint[],
  frames: RingFrame[],
): void {
  const ringVertexCount = ring.length

  for (let coordinateIndex = 0; coordinateIndex < coordinates.length; coordinateIndex += 1) {
    const coordinate = coordinates[coordinateIndex]
    if (!coordinate)
      continue

    for (let ringIndex = 0; ringIndex < ringVertexCount; ringIndex += 1) {
      const vertexIndex = coordinateIndex * ringVertexCount + ringIndex
      const positionIndex = vertexIndex * 3
      const ringPoint = ring[ringIndex]
      if (!ringPoint)
        continue

      const frame = frames[coordinateIndex] ?? defaultFrame()
      positions[positionIndex] = coordinate[0]
        + frame.side[0] * ringPoint.yOffset
        + frame.up[0] * ringPoint.zOffset
      positions[positionIndex + 1] = coordinate[1]
        + frame.side[1] * ringPoint.yOffset
        + frame.up[1] * ringPoint.zOffset
      positions[positionIndex + 2] = coordinate[2]
        + frame.side[2] * ringPoint.yOffset
        + frame.up[2] * ringPoint.zOffset
    }
  }
}

function writeFlowAttributes(
  texcoords: Float32Array,
  colors: Float32Array,
  coordinates: Array<[number, number, number]>,
  ring: RingPoint[],
  ringVertexCount: number,
  distances: number[],
  totalDistance: number,
  flowDirection: PipeMeshInput['flowDirection'],
  color: [number, number, number],
): void {
  const radialStrengths = createRadialStrengths(ring)
  const flowDisabledSentinel = -1

  for (let coordinateIndex = 0; coordinateIndex < coordinates.length; coordinateIndex += 1) {
    const forwardAlong = totalDistance > 0 ? (distances[coordinateIndex] ?? 0) / totalDistance : 0
    const along = flowDirection === 'zdbm-to-qdbm' ? 1 - forwardAlong : forwardAlong

    for (let ringIndex = 0; ringIndex < ringVertexCount; ringIndex += 1) {
      const vertexIndex = coordinateIndex * ringVertexCount + ringIndex
      const texcoordIndex = vertexIndex * 2
      const colorIndex = vertexIndex * 4

      texcoords[texcoordIndex] = along
      texcoords[texcoordIndex + 1] = flowDirection ? (radialStrengths[ringIndex] ?? 0) : flowDisabledSentinel
      colors[colorIndex] = color[0]
      colors[colorIndex + 1] = color[1]
      colors[colorIndex + 2] = color[2]
      colors[colorIndex + 3] = 1
    }
  }
}

function createRadialStrengths(ring: RingPoint[]): number[] {
  const zOffsets = ring.map(point => point.zOffset)
  const minZ = Math.min(...zOffsets)
  const maxZ = Math.max(...zOffsets)
  const range = maxZ - minZ

  if (!Number.isFinite(range) || range <= 0)
    return ring.map(() => 1)

  return ring.map(point => (point.zOffset - minZ) / range)
}

function cumulativeDistances(coordinates: Array<[number, number, number]>): number[] {
  const distances = new Array<number>(coordinates.length)
  distances[0] = 0

  for (let index = 1; index < coordinates.length; index += 1) {
    const previous = coordinates[index - 1]
    const current = coordinates[index]
    distances[index] = (distances[index - 1] ?? 0) + (previous && current ? length(subtract(current, previous)) : 0)
  }

  return distances
}

function createFrames(coordinates: Array<[number, number, number]>): RingFrame[] {
  return coordinates.map((_, index) => frameFromTangent(pointTangent(coordinates, index)))
}

function pointTangent(coordinates: Array<[number, number, number]>, index: number): [number, number, number] {
  const previous = coordinates[index - 1]
  const current = coordinates[index]
  const next = coordinates[index + 1]
  if (!current)
    return [1, 0, 0]

  const before = previous ? normalize(subtract(current, previous)) : undefined
  const after = next ? normalize(subtract(next, current)) : undefined

  if (before && after) {
    const averaged = normalize(add(before, after))
    if (length(averaged) > 0)
      return averaged
  }

  return after ?? before ?? [1, 0, 0]
}

function frameFromTangent(tangent: [number, number, number]): RingFrame {
  const normalizedTangent = normalize(tangent)
  let side = cross(WORLD_UP, normalizedTangent)

  if (length(side) < 0.000001)
    side = [1, 0, 0]

  side = normalize(side)
  const up = normalize(cross(normalizedTangent, side))
  return { side, up }
}

function defaultFrame(): RingFrame {
  return { side: [0, 1, 0], up: [0, 0, 1] }
}

function createIndices(coordinateCount: number, ringVertexCount: number): Uint32Array {
  const segmentCount = coordinateCount - 1
  const indices = new Uint32Array(segmentCount * ringVertexCount * 6)
  let writeIndex = 0

  for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
    const currentRingStart = segmentIndex * ringVertexCount
    const nextRingStart = (segmentIndex + 1) * ringVertexCount

    for (let ringIndex = 0; ringIndex < ringVertexCount; ringIndex += 1) {
      const nextRingIndex = (ringIndex + 1) % ringVertexCount
      const a = currentRingStart + ringIndex
      const b = currentRingStart + nextRingIndex
      const c = nextRingStart + ringIndex
      const d = nextRingStart + nextRingIndex

      indices[writeIndex++] = a
      indices[writeIndex++] = b
      indices[writeIndex++] = c
      indices[writeIndex++] = b
      indices[writeIndex++] = d
      indices[writeIndex++] = c
    }
  }

  return indices
}

function add(left: [number, number, number], right: [number, number, number]): [number, number, number] {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]]
}

function subtract(left: [number, number, number], right: [number, number, number]): [number, number, number] {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]]
}

function cross(left: [number, number, number], right: [number, number, number]): [number, number, number] {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ]
}

function normalize(vector: [number, number, number]): [number, number, number] {
  const vectorLength = length(vector)
  if (vectorLength === 0)
    return [0, 0, 0]

  return [
    vector[0] / vectorLength,
    vector[1] / vectorLength,
    vector[2] / vectorLength,
  ]
}

function length(vector: [number, number, number]): number {
  return Math.hypot(vector[0], vector[1], vector[2])
}
