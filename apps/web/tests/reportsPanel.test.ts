import { describe, expect, it } from 'vitest'

import { renderBuildReportsPanel } from '../src/ui/panels'

describe('build reports panel', () => {
  it('renders quality stats, tile stats, adaptation source counts, and examples', () => {
    const panel = renderBuildReportsPanel({
      quality: {
        versionId: 'network-g9',
        templateId: 'template-1',
        templateVersion: '1.0.0',
        buildTaskId: 'build-1',
        recordCount: 14,
        successCount: 12,
        failureCount: 2,
        totalLines: 10,
        totalPoints: 4,
        specParsingStats: { parsed: 9, defaulted: 1 },
        elevationSourceStats: { field: 2, 'line-endpoint': 1 },
        pointSizeSourceStats: { field: 1, 'adjacent-line': 3 },
        pointLineMatchStats: { matched: 3, unmatched: 1 },
        tileStats: { count: 3, maxBytes: 4096, averageBytes: 2048 },
        flags: [],
        flagCounts: { 'height-defaulted': 2 },
      },
      adaptation: {
        versionId: 'network-g9',
        totalPoints: 4,
        matchedPoints: 3,
        sourceCounts: {
          pointType: { 'topology-degree': 2 },
          pointSize: { 'adjacent-line': 3 },
          elevation: { 'line-endpoint': 1 },
        },
        examples: [
          {
            pointId: 'P-1',
            connectedLineIds: ['L-1'],
            sources: {
              pointType: 'topology-degree',
              pointSize: 'adjacent-line',
              elevation: 'line-endpoint',
            },
          },
        ],
      },
    })

    expect(panel.textContent).toContain('构建报告')
    expect(panel.textContent).toContain('network-g9')
    expect(panel.textContent).toContain('template-1')
    expect(panel.textContent).toContain('记录数')
    expect(panel.textContent).toContain('14')
    expect(panel.textContent).toContain('失败数')
    expect(panel.textContent).toContain('2')
    expect(panel.textContent).toContain('Tile 数')
    expect(panel.textContent).toContain('4096')
    expect(panel.textContent).toContain('规格解析')
    expect(panel.textContent).toContain('pointSize')
    expect(panel.textContent).toContain('P-1')
    expect(panel.textContent).toContain('L-1')
  })
})
