const MATERIAL_ALIASES = new Map<string, string>([
  ['砼', '混凝土'],
  ['混凝土管', '混凝土'],
  ['钢筋混凝土', '钢筋混凝土'],
  ['UPVC管', 'UPVC'],
  ['HDPE管', 'HDPE'],
  ['双壁波纹管', '波纹管'],
])

export function normalizeMaterial(raw: string | null | undefined): string {
  const value = raw?.trim()
  if (!value) return '未知'

  const compact = value.replace(/\s+/g, '')
  return MATERIAL_ALIASES.get(compact) ?? value
}
