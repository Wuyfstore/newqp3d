import { describe, expect, it } from 'vitest'

import { createGeoReference, sourceCoordinateToWgs84 } from '../src/geometry/georeference.js'

describe('georeference', () => {
  it('creates an ECEF tile transform and local ENU meter coordinates for Liyang WGS84 data', () => {
    const reference = createGeoReference({ longitude: 119.38, latitude: 31.57, height: 0 })
    const origin = reference.toLocal({ longitude: 119.38, latitude: 31.57, height: 0 })
    const eastPoint = reference.toLocal({ longitude: 119.381, latitude: 31.57, height: 0 })

    expect(reference.transform).toHaveLength(16)
    expect(Math.hypot(reference.transform[12] ?? 0, reference.transform[13] ?? 0, reference.transform[14] ?? 0))
      .toBeGreaterThan(6_000_000)
    expect(origin[0]).toBeCloseTo(0, 6)
    expect(origin[1]).toBeCloseTo(0, 6)
    expect(origin[2]).toBeCloseTo(0, 6)
    expect(eastPoint[0]).toBeGreaterThan(90)
    expect(eastPoint[0]).toBeLessThan(100)
    expect(Math.abs(eastPoint[1])).toBeLessThan(1)
  })

  it('converts Web Mercator source coordinates to WGS84 degrees before localizing', () => {
    const wgs84 = sourceCoordinateToWgs84([13_291_497.4, 3_704_148.1, 12], 3857)

    expect(wgs84.longitude).toBeCloseTo(119.4, 1)
    expect(wgs84.latitude).toBeCloseTo(31.55, 2)
    expect(wgs84.height).toBe(12)
  })
})
