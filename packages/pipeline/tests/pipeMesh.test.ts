import { describe, expect, it } from 'vitest'
import { createBoxMesh } from '../src/geometry/mesh.js'
import { createNodeMesh } from '../src/geometry/nodeMesh.js'
import { createPipeMesh } from '../src/geometry/pipeMesh.js'

function componentValues(positions: Float32Array, component: 0 | 1 | 2): number[] {
  const values: number[] = []
  for (let index = component; index < positions.length; index += 3) {
    values.push(positions[index])
  }
  return values
}

describe('createPipeMesh', () => {
  it('creates round pipe rings with meter offsets and feature ids', () => {
    const mesh = createPipeMesh({
      featureId: 7,
      coordinates: [[0, 0, 10], [10, 0, 10]],
      spec: { kind: 'round', diameterMm: 1000, source: '1000', quality: 'parsed' },
      radialSegments: 8,
    })

    expect(mesh.positions.length).toBeGreaterThan(0)
    expect(mesh.indices.length).toBeGreaterThan(0)
    expect(mesh.normals.length).toBe(mesh.positions.length)
    expect(new Set(mesh.featureIds)).toEqual(new Set([7]))

    const yValues = componentValues(mesh.positions, 1)
    const zValues = componentValues(mesh.positions, 2)
    expect(Math.min(...yValues)).toBeCloseTo(-0.5)
    expect(Math.max(...yValues)).toBeCloseTo(0.5)
    expect(Math.min(...zValues)).toBeCloseTo(9.5)
    expect(Math.max(...zValues)).toBeCloseTo(10.5)
    expect(allNormalLengthsAreUnit(mesh.normals)).toBe(true)
  })

  it('keeps round pipe normals pointing outward from the pipe centerline', () => {
    const mesh = createPipeMesh({
      featureId: 14,
      coordinates: [[0, 0, 10], [10, 0, 10]],
      spec: { kind: 'round', diameterMm: 1000, source: '1000', quality: 'parsed' },
      radialSegments: 8,
    })

    expect(allNormalsPointOutwardFromCenterline(mesh, [[0, 0, 10], [10, 0, 10]], 8)).toBe(true)
  })

  it('creates rectangular box pipe rings with meter offsets and feature ids', () => {
    const mesh = createPipeMesh({
      featureId: 9,
      coordinates: [[0, 0, 10], [10, 0, 11]],
      spec: { kind: 'box', widthMm: 700, heightMm: 450, source: '700X450', quality: 'parsed' },
      radialSegments: 4,
    })

    expect(mesh.positions.length).toBeGreaterThan(0)
    expect(mesh.indices.length).toBeGreaterThan(0)
    expect(mesh.normals.length).toBe(mesh.positions.length)
    expect(new Set(mesh.featureIds)).toEqual(new Set([9]))

    const yValues = componentValues(mesh.positions, 1)
    const zValues = componentValues(mesh.positions, 2)
    expect(Math.min(...yValues)).toBeCloseTo(-0.35)
    expect(Math.max(...yValues)).toBeCloseTo(0.35)
    expect(Math.min(...zValues)).toBeCloseTo(9.775)
    expect(Math.max(...zValues)).toBeCloseTo(11.225)
  })

  it('keeps rectangular pipe normals pointing outward from the pipe centerline', () => {
    const coordinates: Array<[number, number, number]> = [[0, 0, 10], [10, 0, 10]]
    const mesh = createPipeMesh({
      featureId: 15,
      coordinates,
      spec: { kind: 'box', widthMm: 700, heightMm: 450, source: '700X450', quality: 'parsed' },
      radialSegments: 4,
    })

    expect(allNormalsPointOutwardFromCenterline(mesh, coordinates, 4)).toBe(true)
  })

  it('orients pipe rings perpendicular to diagonal pipe direction', () => {
    const mesh = createPipeMesh({
      featureId: 11,
      coordinates: [[0, 0, 10], [10, 10, 10]],
      spec: { kind: 'round', diameterMm: 1000, source: '1000', quality: 'parsed' },
      radialSegments: 8,
    })
    const tangent = normalize([10, 10, 0])
    const center = [0, 0, 10]

    for (let vertexIndex = 0; vertexIndex < 8; vertexIndex += 1) {
      const offset = [
        mesh.positions[vertexIndex * 3] - center[0],
        mesh.positions[vertexIndex * 3 + 1] - center[1],
        mesh.positions[vertexIndex * 3 + 2] - center[2],
      ]

      expect(Math.abs(dot(offset, tangent))).toBeLessThan(0.001)
    }
  })

  it('uses radial normals at bent pipe rings instead of averaged triangle normals', () => {
    const coordinates: Array<[number, number, number]> = [
      [0, 0, 10],
      [10, 0, 10],
      [10, 10, 10],
    ]
    const mesh = createPipeMesh({
      featureId: 16,
      coordinates,
      spec: { kind: 'round', diameterMm: 1000, source: '1000', quality: 'parsed' },
      radialSegments: 8,
    })

    const ringVertexCount = 8
    const bentRingStart = ringVertexCount
    const bentCenter = coordinates[1]

    for (let ringIndex = 0; ringIndex < ringVertexCount; ringIndex += 1) {
      const vertexIndex = bentRingStart + ringIndex
      const positionIndex = vertexIndex * 3
      const radial = normalize([
        (mesh.positions[positionIndex] ?? 0) - bentCenter[0],
        (mesh.positions[positionIndex + 1] ?? 0) - bentCenter[1],
        (mesh.positions[positionIndex + 2] ?? 0) - bentCenter[2],
      ])
      const normal = [
        mesh.normals[positionIndex] ?? 0,
        mesh.normals[positionIndex + 1] ?? 0,
        mesh.normals[positionIndex + 2] ?? 0,
      ]

      expect(dot(radial, normal)).toBeGreaterThan(0.999)
    }
  })

  it('embeds normalized flow coordinates, radial flow strength, and pipe color on pipe vertices', () => {
    const mesh = createPipeMesh({
      featureId: 12,
      coordinates: [[0, 0, 0], [10, 0, 0]],
      spec: { kind: 'round', diameterMm: 1000, source: '1000', quality: 'parsed' },
      radialSegments: 4,
      flowDirection: 'qdbm-to-zdbm',
      flowColor: [0, 0.66, 0.81],
    })

    expect(mesh.texcoords?.length).toBe((mesh.positions.length / 3) * 2)
    expect(mesh.texcoords?.[0]).toBe(0)
    expect(mesh.texcoords?.[1]).toBeCloseTo(0.5)
    expect(mesh.texcoords?.[3]).toBeCloseTo(1)
    expect(mesh.texcoords?.[5]).toBeCloseTo(0.5)
    expect(mesh.texcoords?.[7]).toBeCloseTo(0)
    expect(mesh.texcoords?.[8]).toBeCloseTo(1)
    expect(mesh.texcoords?.[9]).toBeCloseTo(0.5)
    expect(mesh.colors?.length).toBe((mesh.positions.length / 3) * 4)
    expect(mesh.colors?.[0]).toBeCloseTo(0)
    expect(mesh.colors?.[1]).toBeCloseTo(0.66)
    expect(mesh.colors?.[2]).toBeCloseTo(0.81)
    expect(mesh.colors?.[3]).toBeCloseTo(1)
  })

  it('uses a negative radial sentinel when pipe flow is disabled', () => {
    const mesh = createPipeMesh({
      featureId: 17,
      coordinates: [[0, 0, 0], [10, 0, 0]],
      spec: { kind: 'round', diameterMm: 1000, source: '1000', quality: 'parsed' },
      radialSegments: 4,
    })

    expect(mesh.texcoords?.[0]).toBe(0)
    expect(mesh.texcoords?.[1]).toBeLessThan(0)
    expect(mesh.texcoords?.[8]).toBeCloseTo(1)
    expect(mesh.texcoords?.[9]).toBeLessThan(0)
  })

  it('reverses embedded flow coordinates without changing pipe geometry order', () => {
    const mesh = createPipeMesh({
      featureId: 13,
      coordinates: [[0, 0, 0], [10, 0, 0]],
      spec: { kind: 'round', diameterMm: 1000, source: '1000', quality: 'parsed' },
      radialSegments: 4,
      flowDirection: 'zdbm-to-qdbm',
      flowColor: [0.64, 0.23, 0.45],
    })

    expect(mesh.texcoords?.[0]).toBeCloseTo(1)
    expect(mesh.texcoords?.[8]).toBeCloseTo(0)
    expect(averageRingX(mesh.positions, 0, 4)).toBeLessThan(averageRingX(mesh.positions, 1, 4))
  })
})

describe('createNodeMesh', () => {
  it('creates a visible circular well mesh with feature ids and normals', () => {
    const mesh = createNodeMesh({
      featureId: 21,
      position: [5, 6, 7],
      symbol: 'well',
      sizeMeters: 4,
    })

    expect(mesh.positions.length).toBeGreaterThan(72)
    expect(mesh.indices.length).toBeGreaterThan(6)
    expect(mesh.normals.length).toBe(mesh.positions.length)
    expect(new Set(mesh.featureIds)).toEqual(new Set([21]))

    const xValues = componentValues(mesh.positions, 0)
    const yValues = componentValues(mesh.positions, 1)
    const zValues = componentValues(mesh.positions, 2)
    expect(Math.max(...xValues) - Math.min(...xValues)).toBeCloseTo(4)
    expect(Math.max(...yValues) - Math.min(...yValues)).toBeCloseTo(4)
    expect(Math.max(...zValues) - Math.min(...zValues)).toBeGreaterThan(1)
    expect(allNormalLengthsAreUnit(mesh.normals)).toBe(true)
  })

  it('keeps well cap normals vertical and side normals horizontal', () => {
    const mesh = createNodeMesh({
      featureId: 26,
      position: [0, 0, 0],
      symbol: 'well',
      sizeMeters: 4,
    })
    const zValues = componentValues(mesh.positions, 2)
    const maxZ = Math.max(...zValues)

    expect(countVertices(mesh, ({ z, normal }) => z === maxZ && normal[2] > 0.99)).toBeGreaterThan(2)
    expect(countVertices(mesh, ({ z, normal }) => z === maxZ && Math.abs(normal[2]) < 0.001)).toBeGreaterThan(2)
  })

  it('creates a low rectangular grate marker', () => {
    const mesh = createNodeMesh({
      featureId: 22,
      position: [0, 0, 0],
      symbol: 'rect-grate',
      sizeMeters: 3,
    })

    expect(featureBounds(mesh).width).toBeGreaterThan(featureBounds(mesh).depth)
    expect(featureBounds(mesh).height).toBeLessThan(0.8)
  })

  it('creates recognizable bend, tee, and cross fitting footprints', () => {
    const bend = createNodeMesh({ featureId: 23, position: [0, 0, 0], symbol: 'bend', sizeMeters: 4 })
    const tee = createNodeMesh({ featureId: 24, position: [0, 0, 0], symbol: 'tee', sizeMeters: 4 })
    const cross = createNodeMesh({ featureId: 25, position: [0, 0, 0], symbol: 'cross', sizeMeters: 4 })

    expect(occupiedQuadrants(bend.positions)).toEqual(new Set(['+x', '+y']))
    expect(occupiedQuadrants(tee.positions)).toEqual(new Set(['-x', '+x', '+y']))
    expect(occupiedQuadrants(cross.positions)).toEqual(new Set(['-x', '+x', '-y', '+y']))
  })
})

describe('createBoxMesh', () => {
  it('keeps triangle winding consistent with declared outward normals', () => {
    const mesh = createBoxMesh(31, [0, 0, 0], [2, 4, 6])

    for (let index = 0; index < mesh.indices.length; index += 3) {
      const a = mesh.indices[index] ?? 0
      const b = mesh.indices[index + 1] ?? 0
      const c = mesh.indices[index + 2] ?? 0
      const faceNormal = normalize(triangleNormal(mesh.positions, a, b, c))
      const declaredNormal = [
        mesh.normals[a * 3] ?? 0,
        mesh.normals[a * 3 + 1] ?? 0,
        mesh.normals[a * 3 + 2] ?? 0,
      ]

      expect(dot(faceNormal, declaredNormal)).toBeGreaterThan(0.999)
    }
  })
})

function allNormalLengthsAreUnit(normals: Float32Array): boolean {
  for (let index = 0; index < normals.length; index += 3) {
    const length = Math.hypot(normals[index] ?? 0, normals[index + 1] ?? 0, normals[index + 2] ?? 0)
    if (Math.abs(length - 1) > 0.001)
      return false
  }
  return true
}

function triangleNormal(positions: Float32Array, a: number, b: number, c: number): [number, number, number] {
  const ax = positions[a * 3] ?? 0
  const ay = positions[a * 3 + 1] ?? 0
  const az = positions[a * 3 + 2] ?? 0
  const bx = positions[b * 3] ?? 0
  const by = positions[b * 3 + 1] ?? 0
  const bz = positions[b * 3 + 2] ?? 0
  const cx = positions[c * 3] ?? 0
  const cy = positions[c * 3 + 1] ?? 0
  const cz = positions[c * 3 + 2] ?? 0
  const ab = [bx - ax, by - ay, bz - az] as [number, number, number]
  const ac = [cx - ax, cy - ay, cz - az] as [number, number, number]
  return [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ]
}

function normalize(vector: [number, number, number]): [number, number, number] {
  const length = Math.hypot(vector[0], vector[1], vector[2])
  return [vector[0] / length, vector[1] / length, vector[2] / length]
}

function dot(left: number[], right: number[]): number {
  return (left[0] ?? 0) * (right[0] ?? 0)
    + (left[1] ?? 0) * (right[1] ?? 0)
    + (left[2] ?? 0) * (right[2] ?? 0)
}

function featureBounds(mesh: { positions: Float32Array }): { width: number, depth: number, height: number } {
  const xValues = componentValues(mesh.positions, 0)
  const yValues = componentValues(mesh.positions, 1)
  const zValues = componentValues(mesh.positions, 2)
  return {
    width: Math.max(...xValues) - Math.min(...xValues),
    depth: Math.max(...yValues) - Math.min(...yValues),
    height: Math.max(...zValues) - Math.min(...zValues),
  }
}

function occupiedQuadrants(positions: Float32Array): Set<string> {
  const quadrants = new Set<string>()
  const armThreshold = 0.9
  for (let index = 0; index < positions.length; index += 3) {
    const x = positions[index] ?? 0
    const y = positions[index + 1] ?? 0
    if (x > armThreshold)
      quadrants.add('+x')
    if (x < -armThreshold)
      quadrants.add('-x')
    if (y > armThreshold)
      quadrants.add('+y')
    if (y < -armThreshold)
      quadrants.add('-y')
  }
  return quadrants
}

function averageRingX(positions: Float32Array, ringIndex: number, ringVertexCount: number): number {
  let sum = 0
  for (let index = 0; index < ringVertexCount; index += 1)
    sum += positions[(ringIndex * ringVertexCount + index) * 3] ?? 0
  return sum / ringVertexCount
}

function countVertices(
  mesh: { positions: Float32Array, normals: Float32Array },
  predicate: (vertex: { z: number, normal: [number, number, number] }) => boolean,
): number {
  let count = 0
  for (let index = 0; index < mesh.positions.length; index += 3) {
    const vertex = {
      z: mesh.positions[index + 2] ?? 0,
      normal: [
        mesh.normals[index] ?? 0,
        mesh.normals[index + 1] ?? 0,
        mesh.normals[index + 2] ?? 0,
      ] as [number, number, number],
    }
    if (predicate(vertex))
      count += 1
  }
  return count
}

function allNormalsPointOutwardFromCenterline(
  mesh: { positions: Float32Array, normals: Float32Array },
  coordinates: Array<[number, number, number]>,
  ringVertexCount: number,
): boolean {
  for (let coordinateIndex = 0; coordinateIndex < coordinates.length; coordinateIndex += 1) {
    const center = coordinates[coordinateIndex]
    if (!center)
      continue

    for (let ringIndex = 0; ringIndex < ringVertexCount; ringIndex += 1) {
      const vertexIndex = coordinateIndex * ringVertexCount + ringIndex
      const positionIndex = vertexIndex * 3
      const radial = [
        (mesh.positions[positionIndex] ?? 0) - center[0],
        (mesh.positions[positionIndex + 1] ?? 0) - center[1],
        (mesh.positions[positionIndex + 2] ?? 0) - center[2],
      ]
      const normal = [
        mesh.normals[positionIndex] ?? 0,
        mesh.normals[positionIndex + 1] ?? 0,
        mesh.normals[positionIndex + 2] ?? 0,
      ]

      if (dot(radial, normal) <= 0)
        return false
    }
  }
  return true
}
