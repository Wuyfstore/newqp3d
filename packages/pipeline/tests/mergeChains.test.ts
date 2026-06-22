import { describe, expect, it } from 'vitest'

import { buildTopology } from '../src/topology/graph.js'
import { planMergeChains } from '../src/topology/mergeChains.js'

describe('planMergeChains', () => {
  it('merges same-attribute degree-2 chains and preserves original guid list', () => {
    const lines = [
      line('a', 'N1', 'N2', [[0, 0], [5, 0]], '雨水管', '小区', 'UPVC', '300'),
      line('b', 'N2', 'N3', [[5, 0], [10, 0]], '雨水管', '小区', 'UPVC', '300'),
      line('c', 'N3', 'N4', [[10, 0], [15, 0]], '雨水管', '小区', 'UPVC', '300'),
    ]

    const graph = buildTopology(lines)
    const chains = planMergeChains(lines, graph)

    expect(chains).toHaveLength(1)
    expect(chains[0]).toMatchObject({
      displayId: 'pipe-display-a-b-c',
      originalGuids: ['a', 'b', 'c'],
      gwlx: '雨水管',
      gs: '小区',
      cz: 'UPVC',
      gg: '300',
    })
    expect(chains[0].coordinates).toEqual([[0, 0], [5, 0], [10, 0], [15, 0]])
  })

  it('does not merge across material, spec, pipe type, or branching nodes', () => {
    const lines = [
      line('a', 'N1', 'N2', [[0, 0], [5, 0]], '雨水管', '小区', 'UPVC', '300'),
      line('b', 'N2', 'N3', [[5, 0], [10, 0]], '雨水管', '小区', 'PE', '300'),
      line('c', 'N2', 'N4', [[5, 0], [5, 5]], '雨水管', '小区', 'UPVC', '300'),
    ]

    const chains = planMergeChains(lines, buildTopology(lines))
    expect(chains.map(chain => chain.originalGuids)).toEqual([['a'], ['b'], ['c']])
  })

  it('orients reverse-stored segment geometry along the merged chain', () => {
    const lines = [
      line('a', 'N1', 'N2', [[0, 0], [5, 0]], '雨水管', '小区', 'UPVC', '300'),
      line('b', 'N2', 'N3', [[10, 0], [5, 0]], '雨水管', '小区', 'UPVC', '300'),
    ]

    const chains = planMergeChains(lines, buildTopology(lines))
    expect(chains[0].originalGuids).toEqual(['a', 'b'])
    expect(chains[0].coordinates).toEqual([[0, 0], [5, 0], [10, 0]])
  })

  it('orients a reverse-stored first segment along the logical chain', () => {
    const lines = [
      line('a', 'N1', 'N2', [[5, 0], [0, 0]], '雨水管', '小区', 'UPVC', '300'),
      line('b', 'N2', 'N3', [[5, 0], [10, 0]], '雨水管', '小区', 'UPVC', '300'),
    ]

    const chains = planMergeChains(lines, buildTopology(lines))
    expect(chains[0].originalGuids).toEqual(['a', 'b'])
    expect(chains[0].coordinates).toEqual([[0, 0], [5, 0], [10, 0]])
  })

  it('does not repeat guids when collecting a degree-2 cycle', () => {
    const lines = [
      line('a', 'N1', 'N2', [[0, 0], [5, 0]], '雨水管', '小区', 'UPVC', '300'),
      line('b', 'N2', 'N3', [[5, 0], [5, 5]], '雨水管', '小区', 'UPVC', '300'),
      line('c', 'N3', 'N1', [[5, 5], [0, 0]], '雨水管', '小区', 'UPVC', '300'),
    ]

    const chains = planMergeChains(lines, buildTopology(lines))
    expect(chains).toHaveLength(1)
    expect(chains[0].originalGuids).toHaveLength(new Set(chains[0].originalGuids).size)
    expect(chains[0].originalGuids.toSorted()).toEqual(['a', 'b', 'c'])
  })

  it('keeps long chains linear-shaped without losing source ids', () => {
    const lines = Array.from({ length: 1000 }, (_, index) =>
      line(
        `line-${index.toString().padStart(4, '0')}`,
        `N${index}`,
        `N${index + 1}`,
        [[index, 0], [index + 1, 0]],
        '雨水管',
        '小区',
        'UPVC',
        '300',
      ))

    const chains = planMergeChains(lines, buildTopology(lines))
    expect(chains).toHaveLength(1)
    expect(chains[0].originalGuids).toHaveLength(lines.length)
    expect(chains[0].originalGuids.at(0)).toBe('line-0000')
    expect(chains[0].originalGuids.at(-1)).toBe('line-0999')
    expect(chains[0].coordinates).toHaveLength(lines.length + 1)
  })
})

function line(guid: string, qdbm: string, zdbm: string, coordinates: Array<[number, number]>, gwlx: string, gs: string, cz: string, gg: string) {
  return { guid, qdbm, zdbm, coordinates, gwlx, gs, cz, gg }
}
