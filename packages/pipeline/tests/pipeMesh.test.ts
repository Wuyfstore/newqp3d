import { describe, expect, it } from 'vitest'
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
    expect(new Set(mesh.featureIds)).toEqual(new Set([7]))

    const yValues = componentValues(mesh.positions, 1)
    const zValues = componentValues(mesh.positions, 2)
    expect(Math.min(...yValues)).toBeCloseTo(-0.5)
    expect(Math.max(...yValues)).toBeCloseTo(0.5)
    expect(Math.min(...zValues)).toBeCloseTo(9.5)
    expect(Math.max(...zValues)).toBeCloseTo(10.5)
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
    expect(new Set(mesh.featureIds)).toEqual(new Set([9]))

    const yValues = componentValues(mesh.positions, 1)
    const zValues = componentValues(mesh.positions, 2)
    expect(Math.min(...yValues)).toBeCloseTo(-0.35)
    expect(Math.max(...yValues)).toBeCloseTo(0.35)
    expect(Math.min(...zValues)).toBeCloseTo(9.775)
    expect(Math.max(...zValues)).toBeCloseTo(11.225)
  })
})

describe('createNodeMesh', () => {
  it('creates a nonempty quad mesh with feature ids', () => {
    const mesh = createNodeMesh({
      featureId: 21,
      position: [5, 6, 7],
      symbol: 'well',
      sizeMeters: 2,
    })

    expect(mesh.positions.length).toBe(12)
    expect(mesh.indices.length).toBe(6)
    expect(new Set(mesh.featureIds)).toEqual(new Set([21]))
  })
})
