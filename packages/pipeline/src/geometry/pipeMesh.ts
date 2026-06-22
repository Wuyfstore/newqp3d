import type { PipeSpec } from '@new-qp3d/shared'

export interface Mesh {
  positions: Float32Array
  indices: Uint32Array
  featureIds: Uint32Array
}

export interface PipeMeshInput {
  featureId: number
  coordinates: Array<[number, number, number]>
  spec: PipeSpec
  radialSegments: number
}

interface RingPoint {
  yOffset: number
  zOffset: number
}

const MIN_RING_SEGMENTS = 4

export function createPipeMesh(input: PipeMeshInput): Mesh {
  if (input.coordinates.length < 2)
    return emptyMesh()

  const ring = createRing(input.spec, input.radialSegments)
  const ringVertexCount = ring.length
  const vertexCount = input.coordinates.length * ringVertexCount
  const positions = new Float32Array(vertexCount * 3)
  const featureIds = new Uint32Array(vertexCount)

  featureIds.fill(input.featureId)
  writePositions(positions, input.coordinates, ring)

  return {
    positions,
    indices: createIndices(input.coordinates.length, ringVertexCount),
    featureIds,
  }
}

function emptyMesh(): Mesh {
  return {
    positions: new Float32Array(),
    indices: new Uint32Array(),
    featureIds: new Uint32Array(),
  }
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

      positions[positionIndex] = coordinate[0]
      positions[positionIndex + 1] = coordinate[1] + ringPoint.yOffset
      positions[positionIndex + 2] = coordinate[2] + ringPoint.zOffset
    }
  }
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
      indices[writeIndex++] = c
      indices[writeIndex++] = b
      indices[writeIndex++] = b
      indices[writeIndex++] = c
      indices[writeIndex++] = d
    }
  }

  return indices
}
