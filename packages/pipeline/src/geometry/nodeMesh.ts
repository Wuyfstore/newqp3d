import type { Mesh } from './mesh.js'

import { computeVertexNormals, createBoxMesh } from './mesh.js'

export type NodeSymbol =
  | 'well'
  | 'rect-grate'
  | 'inlet'
  | 'reserved-outlet'
  | 'bend'
  | 'coupling'
  | 'tee'
  | 'cross'
  | 'reducer'
  | 'valve'
  | 'hydrant'
  | 'pump-station'
  | 'unknown-point'

export interface NodeMeshInput {
  featureId: number
  position: [number, number, number]
  symbol: NodeSymbol
  sizeMeters: number
}

export function createNodeMesh(input: NodeMeshInput): Mesh {
  switch (input.symbol) {
    case 'well':
      return createCylinderMesh(input.featureId, input.position, input.sizeMeters / 2, Math.max(1.6, input.sizeMeters * 0.45), 16)
    case 'rect-grate':
    case 'inlet':
    case 'reserved-outlet':
      return createBoxMesh(input.featureId, input.position, [input.sizeMeters * 1.45, input.sizeMeters * 0.7, 0.45])
    case 'bend':
      return createFittingFootprint(input.featureId, input.position, input.sizeMeters, ['+x', '+y'])
    case 'coupling':
      return createFittingFootprint(input.featureId, input.position, input.sizeMeters, ['-x', '+x'])
    case 'tee':
      return createFittingFootprint(input.featureId, input.position, input.sizeMeters, ['-x', '+x', '+y'])
    case 'cross':
      return createFittingFootprint(input.featureId, input.position, input.sizeMeters, ['-x', '+x', '-y', '+y'])
    case 'reducer':
      return createReducerMesh(input.featureId, input.position, input.sizeMeters)
    case 'valve':
      return mergeMeshes([
        createFittingFootprint(input.featureId, input.position, input.sizeMeters, ['-x', '+x']),
        createBoxMesh(input.featureId, [input.position[0], input.position[1], input.position[2] + 0.7], [input.sizeMeters * 0.55, input.sizeMeters * 0.55, 0.5]),
      ])
    case 'hydrant':
      return mergeMeshes([
        createCylinderMesh(input.featureId, input.position, input.sizeMeters * 0.22, input.sizeMeters * 0.9, 10),
        createBoxMesh(input.featureId, [input.position[0], input.position[1], input.position[2] + input.sizeMeters * 0.75], [input.sizeMeters * 0.8, input.sizeMeters * 0.22, input.sizeMeters * 0.2]),
      ])
    case 'pump-station':
      return createBoxMesh(input.featureId, input.position, [input.sizeMeters * 1.4, input.sizeMeters * 1.1, Math.max(1.8, input.sizeMeters * 0.8)])
    case 'unknown-point':
    default:
      return createCylinderMesh(input.featureId, input.position, input.sizeMeters * 0.35, Math.max(1.2, input.sizeMeters * 0.4), 8)
  }
}

function createFittingFootprint(
  featureId: number,
  position: [number, number, number],
  sizeMeters: number,
  arms: Array<'-x' | '+x' | '-y' | '+y'>,
): Mesh {
  const armLength = sizeMeters * 0.5
  const armWidth = Math.max(sizeMeters * 0.24, 0.7)
  const height = Math.max(sizeMeters * 0.28, 0.8)
  const meshes = [
    createBoxMesh(featureId, position, [armWidth, armWidth, height]),
  ]

  for (const arm of arms) {
    if (arm === '-x')
      meshes.push(createBoxMesh(featureId, [position[0] - armLength / 2, position[1], position[2]], [armLength, armWidth, height]))
    if (arm === '+x')
      meshes.push(createBoxMesh(featureId, [position[0] + armLength / 2, position[1], position[2]], [armLength, armWidth, height]))
    if (arm === '-y')
      meshes.push(createBoxMesh(featureId, [position[0], position[1] - armLength / 2, position[2]], [armWidth, armLength, height]))
    if (arm === '+y')
      meshes.push(createBoxMesh(featureId, [position[0], position[1] + armLength / 2, position[2]], [armWidth, armLength, height]))
  }

  return mergeMeshes(meshes)
}

function createReducerMesh(featureId: number, position: [number, number, number], sizeMeters: number): Mesh {
  return mergeMeshes([
    createBoxMesh(featureId, [position[0] - sizeMeters * 0.18, position[1], position[2]], [sizeMeters * 0.55, sizeMeters * 0.42, sizeMeters * 0.32]),
    createBoxMesh(featureId, [position[0] + sizeMeters * 0.22, position[1], position[2]], [sizeMeters * 0.45, sizeMeters * 0.25, sizeMeters * 0.24]),
  ])
}

function createCylinderMesh(
  featureId: number,
  center: [number, number, number],
  radius: number,
  height: number,
  segments: number,
): Mesh {
  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  const featureIds: number[] = []
  const [cx, cy, cz] = center
  const bottomCenterIndex = pushCylinderVertex(positions, normals, featureIds, featureId, [cx, cy, cz], [0, 0, -1])
  const topCenterIndex = pushCylinderVertex(positions, normals, featureIds, featureId, [cx, cy, cz + height], [0, 0, 1])
  const bottomCapRing: number[] = []
  const topCapRing: number[] = []
  const sideBottomRing: number[] = []
  const sideTopRing: number[] = []

  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2
    const normal: [number, number, number] = [Math.cos(angle), Math.sin(angle), 0]
    const x = cx + normal[0] * radius
    const y = cy + normal[1] * radius
    bottomCapRing.push(pushCylinderVertex(positions, normals, featureIds, featureId, [x, y, cz], [0, 0, -1]))
    topCapRing.push(pushCylinderVertex(positions, normals, featureIds, featureId, [x, y, cz + height], [0, 0, 1]))
    sideBottomRing.push(pushCylinderVertex(positions, normals, featureIds, featureId, [x, y, cz], normal))
    sideTopRing.push(pushCylinderVertex(positions, normals, featureIds, featureId, [x, y, cz + height], normal))
  }

  for (let index = 0; index < segments; index += 1) {
    const next = (index + 1) % segments
    const bottom = bottomCapRing[index] ?? 0
    const top = topCapRing[index] ?? 0
    const nextBottom = bottomCapRing[next] ?? 0
    const nextTop = topCapRing[next] ?? 0
    const sideBottom = sideBottomRing[index] ?? 0
    const sideTop = sideTopRing[index] ?? 0
    const nextSideBottom = sideBottomRing[next] ?? 0
    const nextSideTop = sideTopRing[next] ?? 0

    indices.push(bottomCenterIndex, nextBottom, bottom)
    indices.push(topCenterIndex, top, nextTop)
    indices.push(sideBottom, nextSideBottom, sideTop)
    indices.push(sideTop, nextSideBottom, nextSideTop)
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    featureIds: new Uint32Array(featureIds),
  }
}

function pushCylinderVertex(
  positions: number[],
  normals: number[],
  featureIds: number[],
  featureId: number,
  position: [number, number, number],
  normal: [number, number, number],
): number {
  const vertexIndex = positions.length / 3
  positions.push(...position)
  normals.push(...normal)
  featureIds.push(featureId)
  return vertexIndex
}

function mergeMeshes(meshes: Mesh[]): Mesh {
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
    for (let index = 0; index < mesh.indices.length; index += 1)
      indices[indexOffset + index] = (mesh.indices[index] ?? 0) + vertexOffset

    positionOffset += mesh.positions.length
    indexOffset += mesh.indices.length
    featureIdOffset += mesh.featureIds.length
    vertexOffset += mesh.positions.length / 3
  }

  return {
    positions,
    normals: computeVertexNormals(positions, indices),
    indices,
    featureIds,
  }
}
