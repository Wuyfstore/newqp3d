import { describe, expect, it } from 'vitest'
import {
  PIPE_LAYER_TYPES,
  POINT_FACILITY_RENDER_RULES,
  getPipeColor,
  getPointRenderRule,
} from '../src/dictionaries.js'

describe('pipe and point dictionaries', () => {
  it('maps rainwater and sewage pipes to stable layer ids and colors', () => {
    expect(PIPE_LAYER_TYPES).toEqual(['雨水管', '污水管'])
    expect(getPipeColor('雨水管')).toBe('#00A9CE')
    expect(getPipeColor('污水管')).toBe('#A23B72')
    expect(getPipeColor('未知')).toBe('#8A8F98')
  })

  it('uses lightweight generated render rules for current point categories', () => {
    expect(getPointRenderRule('雨篦')).toEqual({
      category: '雨篦',
      strategy: 'generated-low-poly',
      symbol: 'rect-grate',
    })
    expect(getPointRenderRule('泵站')).toEqual({
      category: '泵站',
      strategy: 'model',
      symbol: 'pump-station',
    })
  })

  it('keeps the render-rule table explicit', () => {
    expect(POINT_FACILITY_RENDER_RULES.map(rule => rule.category)).toContain('消防栓')
    expect(POINT_FACILITY_RENDER_RULES.map(rule => rule.category)).toContain('闸门')
  })
})
