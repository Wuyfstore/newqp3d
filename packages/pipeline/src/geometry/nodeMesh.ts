import type { Mesh } from './pipeMesh.js'

export interface NodeMeshInput {
  featureId: number
  position: [number, number, number]
  symbol: 'well' | 'rect-grate' | 'inlet' | 'reserved-outlet' | 'unknown-point'
  sizeMeters: number
}

export function createNodeMesh(input: NodeMeshInput): Mesh {
  const halfSize = input.sizeMeters / 2
  const [x, y, z] = input.position

  return {
    positions: new Float32Array([
      x - halfSize,
      y - halfSize,
      z,
      x + halfSize,
      y - halfSize,
      z,
      x + halfSize,
      y + halfSize,
      z,
      x - halfSize,
      y + halfSize,
      z,
    ]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    featureIds: new Uint32Array([input.featureId, input.featureId, input.featureId, input.featureId]),
  }
}
