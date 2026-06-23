export const PIPE_LAYER_TYPES = ['雨水管', '污水管', '合流管'] as const

export type RenderStrategy = 'generated-low-poly' | 'generated-parametric' | 'model'

export interface PointFacilityRenderRule {
  category: string
  strategy: RenderStrategy
  symbol: string
}

const PIPE_COLORS = new Map<string, string>([
  ['雨水管', '#00A9CE'],
  ['污水管', '#A23B72'],
  ['合流管', '#D18B00'],
])

export const POINT_FACILITY_RENDER_RULES: PointFacilityRenderRule[] = [
  { category: '雨篦', strategy: 'generated-low-poly', symbol: 'rect-grate' },
  { category: '污篦', strategy: 'generated-low-poly', symbol: 'rect-grate' },
  { category: '雨水进水口', strategy: 'generated-low-poly', symbol: 'inlet' },
  { category: '污水进水口', strategy: 'generated-low-poly', symbol: 'inlet' },
  { category: '雨水预留口', strategy: 'generated-parametric', symbol: 'reserved-outlet' },
  { category: '污水预留口', strategy: 'generated-parametric', symbol: 'reserved-outlet' },
  { category: '雨水井', strategy: 'generated-parametric', symbol: 'well' },
  { category: '污水井', strategy: 'generated-parametric', symbol: 'well' },
  { category: '消防栓', strategy: 'model', symbol: 'hydrant' },
  { category: '闸门', strategy: 'model', symbol: 'gate' },
  { category: '泵站', strategy: 'model', symbol: 'pump-station' },
  { category: '雨水排放口', strategy: 'model', symbol: 'outfall' },
  { category: '污水排放口', strategy: 'model', symbol: 'outfall' },
]

export function getPipeColor(layerType: string | null | undefined): string {
  return PIPE_COLORS.get(layerType ?? '') ?? '#8A8F98'
}

export function getPointRenderRule(category: string | null | undefined): PointFacilityRenderRule {
  return POINT_FACILITY_RENDER_RULES.find(rule => rule.category === category) ?? {
    category: category ?? '未知',
    strategy: 'generated-low-poly',
    symbol: 'unknown-point',
  }
}
