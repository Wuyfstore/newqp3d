import { describe, expect, it } from 'vitest'

import { createQualityReport } from '../src/quality/report.js'

describe('createQualityReport', () => {
  it('summarizes counts and quality flags for publish validation', () => {
    const report = createQualityReport({
      versionId: 'network-20260621-1500',
      totalLines: 5,
      totalPoints: 2,
      generatedLineFeatures: 4,
      generatedPointFeatures: 2,
      flags: [
        { featureId: 'a', flag: 'spec-defaulted' },
        { featureId: 'b', flag: 'height-defaulted' },
        { featureId: 'c', flag: 'endpoint-unmatched' },
        { featureId: 'd', flag: 'endpoint-unmatched' },
      ],
      groupCounts: {
        gwlx: { 雨水管: 3, 污水管: 2 },
        gs: { 市政: 2, 小区: 3 },
      },
    })

    expect(report.flagCounts).toEqual({
      'spec-defaulted': 1,
      'height-defaulted': 1,
      'endpoint-unmatched': 2,
    })
    expect(report.totalLines).toBe(5)
    expect(report.generatedLineFeatures).toBe(4)
  })
})
