import { describe, expect, it } from 'vitest'

import { createQualityReport } from '../src/quality/report.js'

describe('createQualityReport', () => {
  it('summarizes counts and quality flags for publish validation', () => {
    const report = createQualityReport({
      versionId: 'network-20260621-1500',
      templateId: 'template-1',
      templateVersion: '1.2.3',
      buildTaskId: 'build-1',
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
      tileStats: {
        count: 3,
        maxBytes: 2048,
        averageBytes: 1024,
      },
    })

    expect(report.flagCounts).toEqual({
      'spec-defaulted': 1,
      'height-defaulted': 1,
      'endpoint-unmatched': 2,
    })
    expect(report.totalLines).toBe(5)
    expect(report.generatedLineFeatures).toBe(4)
    expect(report.templateId).toBe('template-1')
    expect(report.templateVersion).toBe('1.2.3')
    expect(report.buildTaskId).toBe('build-1')
    expect(report.tileStats).toEqual({
      count: 3,
      maxBytes: 2048,
      averageBytes: 1024,
    })
  })
})
