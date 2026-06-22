import { describe, expect, it } from 'vitest'
import { computePipeCenterHeights } from '../src/normalize/height.js'

describe('computePipeCenterHeights', () => {
  it('uses inner-bottom elevations first and adds radius', () => {
    expect(computePipeCenterHeights({
      spec: { kind: 'round', diameterMm: 600, source: '600', quality: 'parsed' },
      qdndbg: 12,
      zdndbg: 13,
      qdms: 2,
      zdms: 2,
      groundElevation: 20,
      defaultDepthMeters: 2.5,
    })).toEqual({ startCenterZ: 12.3, endCenterZ: 13.3, quality: 'inner-bottom' })
  })

  it('uses depth from ground when inner-bottom is missing', () => {
    expect(computePipeCenterHeights({
      spec: { kind: 'round', diameterMm: 400, source: '400', quality: 'parsed' },
      qdndbg: null,
      zdndbg: null,
      qdms: 3,
      zdms: 4,
      groundElevation: 20,
      defaultDepthMeters: 2.5,
    })).toEqual({ startCenterZ: 17.2, endCenterZ: 16.2, quality: 'depth-estimated' })
  })

  it('uses configured default depth when height fields are missing', () => {
    expect(computePipeCenterHeights({
      spec: { kind: 'box', widthMm: 700, heightMm: 450, source: '700X450', quality: 'parsed' },
      qdndbg: null,
      zdndbg: null,
      qdms: null,
      zdms: null,
      groundElevation: 20,
      defaultDepthMeters: 2.5,
    })).toEqual({ startCenterZ: 17.725, endCenterZ: 17.725, quality: 'defaulted' })
  })
})
