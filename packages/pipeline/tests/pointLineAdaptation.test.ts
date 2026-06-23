import { describe, expect, it } from 'vitest'

import { adaptPointFacilities } from '../src/adaptation/pointLineAdapter.js'

describe('adaptPointFacilities', () => {
  it('uses point fields, adjacent lines, then defaults for size and elevation sources', () => {
    const result = adaptPointFacilities({
      defaults: {
        pointSizeMeters: 1.1,
        surfaceElevationMeters: 5,
      },
      lines: [
        {
          id: 'L-1',
          startNodeId: 'P-field',
          endNodeId: 'P-adjacent',
          maxDiameterMeters: 0.8,
          startHeightMeters: 10,
          endHeightMeters: 11,
          coordinates: [[0, 0], [10, 0]],
        },
      ],
      points: [
        {
          id: 'P-field',
          code: 'P-field',
          pointType: '雨水井',
          sizeMeters: 1.6,
          elevationMeters: 22,
        },
        {
          id: 'P-adjacent',
          code: 'P-adjacent',
          pointType: null,
          sizeMeters: null,
          elevationMeters: null,
        },
        {
          id: 'P-default',
          code: 'P-default',
          pointType: null,
          sizeMeters: null,
          elevationMeters: null,
        },
      ],
    })

    expect(result.points).toEqual([
      expect.objectContaining({
        id: 'P-field',
        pointType: '雨水井',
        pointTypeSource: 'field',
        sizeMeters: 1.6,
        sizeSource: 'field',
        elevationMeters: 22,
        elevationSource: 'field',
        connectionDegree: 1,
      }),
      expect.objectContaining({
        id: 'P-adjacent',
        pointType: '端点',
        pointTypeSource: 'topology-degree',
        sizeMeters: 0.8,
        sizeSource: 'adjacent-line',
        elevationMeters: 11,
        elevationSource: 'line-endpoint',
        connectedLineIds: ['L-1'],
        connectionDegree: 1,
      }),
      expect.objectContaining({
        id: 'P-default',
        pointType: '未知',
        pointTypeSource: 'default',
        sizeMeters: 1.1,
        sizeSource: 'type-default',
        elevationMeters: 5,
        elevationSource: 'default',
        connectionDegree: 0,
      }),
    ])
    expect(result.report.sourceCounts).toEqual({
      pointType: {
        field: 1,
        'topology-degree': 1,
        default: 1,
      },
      pointSize: {
        field: 1,
        'adjacent-line': 1,
        'type-default': 1,
      },
      elevation: {
        field: 1,
        'line-endpoint': 1,
        default: 1,
      },
    })
  })

  it('infers endpoint, coupling, bend, tee, and cross candidates from connection degree and direction', () => {
    const result = adaptPointFacilities({
      defaults: {
        pointSizeMeters: 1,
        surfaceElevationMeters: 0,
      },
      lines: [
        line('endpoint-line', 'endpoint', 'outside-a', [[0, 0], [10, 0]]),
        line('straight-east', 'straight', 'east', [[0, 0], [10, 0]]),
        line('straight-west', 'straight', 'west', [[0, 0], [-10, 0]]),
        line('bend-east', 'bend', 'bend-east-node', [[0, 0], [10, 0]]),
        line('bend-north', 'bend', 'bend-north-node', [[0, 0], [0, 10]]),
        line('tee-east', 'tee', 'tee-east-node', [[0, 0], [10, 0]]),
        line('tee-west', 'tee', 'tee-west-node', [[0, 0], [-10, 0]]),
        line('tee-north', 'tee', 'tee-north-node', [[0, 0], [0, 10]]),
        line('cross-east', 'cross', 'cross-east-node', [[0, 0], [10, 0]]),
        line('cross-west', 'cross', 'cross-west-node', [[0, 0], [-10, 0]]),
        line('cross-north', 'cross', 'cross-north-node', [[0, 0], [0, 10]]),
        line('cross-south', 'cross', 'cross-south-node', [[0, 0], [0, -10]]),
      ],
      points: ['endpoint', 'straight', 'bend', 'tee', 'cross'].map(code => ({
        id: code,
        code,
        pointType: null,
        sizeMeters: null,
        elevationMeters: null,
      })),
    })

    expect(Object.fromEntries(result.points.map(point => [point.id, point.pointType]))).toEqual({
      endpoint: '端点',
      straight: '双通',
      bend: '弯头',
      tee: '三通',
      cross: '四通',
    })
    expect(result.report.connectionDegreeCounts).toEqual({
      '1': 1,
      '2': 2,
      '3': 1,
      '4': 1,
    })
    expect(result.report.inferredTypeCounts).toEqual({
      端点: 1,
      双通: 1,
      弯头: 1,
      三通: 1,
      四通: 1,
    })
  })

  it('matches unmatched line endpoints to nearby points inside the configured tolerance', () => {
    const result = adaptPointFacilities({
      defaults: {
        pointSizeMeters: 1,
        surfaceElevationMeters: 0,
      },
      nearestMatch: {
        toleranceMeters: 1,
      },
      lines: [
        {
          id: 'L-near',
          startNodeId: 'missing-start',
          endNodeId: 'missing-end',
          maxDiameterMeters: 0.9,
          startHeightMeters: 12,
          endHeightMeters: 13,
          coordinates: [[0, 0], [10, 0]],
        },
      ],
      points: [
        {
          id: 'P-near-start',
          code: 'different-start-code',
          pointType: null,
          sizeMeters: null,
          elevationMeters: null,
          coordinates: [0.4, 0.3],
        },
        {
          id: 'P-near-end',
          code: null,
          pointType: null,
          sizeMeters: null,
          elevationMeters: null,
          coordinates: [10.2, 0],
        },
      ],
    })

    expect(result.points).toEqual([
      expect.objectContaining({
        id: 'P-near-start',
        connectionDegree: 1,
        connectedLineIds: ['L-near'],
        nodeMatchSource: 'node-match-nearest',
        nearestMatchDistanceMeters: expect.closeTo(0.5, 5),
        elevationMeters: 12,
      }),
      expect.objectContaining({
        id: 'P-near-end',
        connectionDegree: 1,
        connectedLineIds: ['L-near'],
        nodeMatchSource: 'node-match-nearest',
        nearestMatchDistanceMeters: expect.closeTo(0.2, 5),
        elevationMeters: 13,
      }),
    ])
    expect(result.report.matchSourceCounts).toEqual({
      'node-match-nearest': 2,
    })
    expect(result.report.nearestMatchConflicts).toEqual([])
  })

  it('reports nearest-match conflicts without connecting ambiguous candidates', () => {
    const result = adaptPointFacilities({
      defaults: {
        pointSizeMeters: 1,
        surfaceElevationMeters: 0,
      },
      nearestMatch: {
        toleranceMeters: 1,
      },
      lines: [
        line('L-conflict', 'missing-start', 'outside', [[0, 0], [10, 0]]),
      ],
      points: [
        {
          id: 'P-a',
          code: null,
          pointType: null,
          sizeMeters: null,
          elevationMeters: null,
          coordinates: [0.2, 0],
        },
        {
          id: 'P-b',
          code: null,
          pointType: null,
          sizeMeters: null,
          elevationMeters: null,
          coordinates: [0.4, 0],
        },
      ],
    })

    expect(result.points.map(point => point.connectionDegree)).toEqual([0, 0])
    expect(result.report.matchSourceCounts).toEqual({})
    expect(result.report.nearestMatchConflicts).toEqual([
      {
        lineId: 'L-conflict',
        endpoint: 'start',
        candidatePointIds: ['P-a', 'P-b'],
        toleranceMeters: 1,
      },
    ])
  })
})

function line(
  id: string,
  startNodeId: string,
  endNodeId: string,
  coordinates: Array<[number, number]>,
) {
  return {
    id,
    startNodeId,
    endNodeId,
    maxDiameterMeters: 0.6,
    startHeightMeters: 10,
    endHeightMeters: 10,
    coordinates,
  }
}
