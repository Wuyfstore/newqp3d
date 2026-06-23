import type { PickTarget } from '../cesium/picking'
import type { AdaptationReport, PipeLineDetail, PipePointDetail, QualityReport } from '../services/apiClient'

const STYLE_ID = 'qp3d-interaction-panel-styles'
const LINE_FIELDS = [
  ['guid', 'GUID'],
  ['qdbm', '起点编码'],
  ['zdbm', '终点编码'],
  ['gwlx', '管网类型'],
  ['gs', '管属'],
  ['cz', '材质'],
  ['gg', '规格'],
  ['gdcd', '管段长度'],
  ['qdms', '起点埋深'],
  ['zdms', '终点埋深'],
  ['qdndbg', '起点内底标高'],
  ['zdndbg', '终点内底标高'],
] as const

const POINT_FIELDS = [
  ['gdbm', '管点编码'],
  ['lbmc', '类别'],
  ['dmbg', '地面标高'],
  ['kj', '口径'],
  ['js', '井深'],
  ['gg', '规格'],
  ['jgcz', '井盖材质'],
  ['jgxz', '井盖形状'],
  ['jgcc', '井盖尺寸'],
] as const

export function installPanelStyles(): void {
  if (document.getElementById(STYLE_ID)) {
    return
  }

  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
.qp3d-search {
  display: grid;
  grid-template-columns: 1fr 48px;
  gap: 6px;
  margin-bottom: 10px;
}

.qp3d-search input,
.qp3d-search button,
.qp3d-search-result {
  min-height: 28px;
  border: 1px solid rgb(255 255 255 / 14%);
  border-radius: 6px;
  box-sizing: border-box;
  color: #f3f7fb;
  background: rgb(255 255 255 / 8%);
  font: inherit;
}

.qp3d-search input {
  width: 100%;
  min-width: 0;
  padding: 0 7px;
}

.qp3d-search button {
  padding: 0 8px;
  cursor: pointer;
}

.qp3d-search-results {
  display: grid;
  gap: 4px;
  margin-bottom: 10px;
}

.qp3d-search-result {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 4px 7px;
  text-align: left;
  cursor: pointer;
}

.qp3d-search-result span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qp3d-search-result small,
.qp3d-search-results__empty {
  color: #9fb3c8;
  font-size: 11px;
}

.qp3d-panel {
  max-height: calc(100vh - 64px);
  overflow: auto;
  padding: 12px;
  box-sizing: border-box;
}

.qp3d-panel__title {
  margin: 0;
  font-size: 15px;
  line-height: 1.2;
  color: #f3f7fb;
}

.qp3d-panel__subtitle {
  margin-top: 4px;
  overflow-wrap: anywhere;
  color: #9fb3c8;
  font-size: 12px;
}

.qp3d-panel__muted,
.qp3d-panel--empty {
  color: #cbd6e2;
  font-size: 13px;
  line-height: 1.45;
}

.qp3d-field-list {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr);
  gap: 6px 8px;
  margin: 12px 0 0;
  font-size: 12px;
  line-height: 1.35;
}

.qp3d-field-list dt {
  color: #9fb3c8;
}

.qp3d-field-list dd {
  margin: 0;
  overflow-wrap: anywhere;
  color: #f3f7fb;
}

.qp3d-flags {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid rgb(255 255 255 / 12%);
}

.qp3d-flags__label {
  color: #9fb3c8;
  font-size: 12px;
  font-weight: 700;
}

.qp3d-flags ul {
  margin: 6px 0 0;
  padding-left: 18px;
  color: #f3f7fb;
  font-size: 12px;
}
`
  document.head.append(style)
}

export function renderPropertyPanel(target: PickTarget): HTMLElement {
  const panel = document.createElement('section')
  panel.className = 'qp3d-panel qp3d-panel--properties'

  const title = document.createElement('h2')
  title.className = 'qp3d-panel__title'
  title.textContent = target.type === 'line' ? '管线属性' : '管点属性'

  const subtitle = document.createElement('div')
  subtitle.className = 'qp3d-panel__subtitle'
  subtitle.textContent = target.id

  panel.append(title, subtitle, renderDefinitionList(target.type === 'line' ? LINE_FIELDS : POINT_FIELDS, target.detail))

  const quality = renderQualityFlags(target.detail)
  if (quality) {
    panel.append(quality)
  }

  return panel
}

export function renderQualitySummary(report: QualityReport): HTMLElement {
  const panel = document.createElement('section')
  panel.className = 'qp3d-panel qp3d-panel--quality'

  const title = document.createElement('h2')
  title.className = 'qp3d-panel__title'
  title.textContent = '质量概览'

  const rows: Array<[string, unknown]> = [
    ['版本', report.versionId ?? report.version],
    ['管线数', report.totalLines],
    ['管点数', report.totalPoints],
  ]

  const flagCounts = report.flagCounts ?? asRecord(report.summary)
  if (flagCounts) {
    for (const [key, value] of Object.entries(flagCounts)) {
      rows.push([key, value])
    }
  }

  panel.append(title, renderRows(rows))
  return panel
}

export function renderBuildReportsPanel(input: {
  quality: QualityReport
  adaptation?: AdaptationReport | null
}): HTMLElement {
  const panel = document.createElement('section')
  panel.className = 'qp3d-panel qp3d-panel--reports'

  const title = document.createElement('h2')
  title.className = 'qp3d-panel__title'
  title.textContent = '构建报告'

  const subtitle = document.createElement('div')
  subtitle.className = 'qp3d-panel__subtitle'
  subtitle.textContent = formatValue(input.quality.versionId ?? input.quality.version)

  const rows: Array<[string, unknown]> = [
    ['模板', input.quality.templateId],
    ['模板版本', input.quality.templateVersion],
    ['构建任务', input.quality.buildTaskId],
    ['记录数', input.quality.recordCount],
    ['成功数', input.quality.successCount],
    ['失败数', input.quality.failureCount],
    ['管线数', input.quality.totalLines],
    ['管点数', input.quality.totalPoints],
    ['Tile 数', input.quality.tileStats?.count],
    ['最大 Tile', input.quality.tileStats?.maxBytes],
    ['平均 Tile', input.quality.tileStats?.averageBytes],
  ]

  panel.append(title, subtitle, renderRows(rows))
  appendStats(panel, '规格解析', input.quality.specParsingStats)
  appendStats(panel, '高程来源', input.quality.elevationSourceStats)
  appendStats(panel, 'pointSize 来源', input.quality.pointSizeSourceStats)
  appendStats(panel, '点线匹配', input.quality.pointLineMatchStats)
  appendStats(panel, '质量标记', input.quality.flagCounts)

  if (input.adaptation) {
    appendStats(panel, '管点类型来源', input.adaptation.sourceCounts?.pointType)
    appendStats(panel, '管点尺寸来源', input.adaptation.sourceCounts?.pointSize)
    appendStats(panel, '管点高程来源', input.adaptation.sourceCounts?.elevation)
    appendExamples(panel, input.adaptation.examples ?? [])
  }

  return panel
}

export function renderEmptyPanel(message: string): HTMLElement {
  const panel = document.createElement('section')
  panel.className = 'qp3d-panel qp3d-panel--empty'
  panel.textContent = message
  return panel
}

function renderDefinitionList(
  fields: readonly (readonly [string, string])[],
  detail: PipeLineDetail | PipePointDetail,
): HTMLElement {
  return renderRows(fields.map(([key, label]) => [label, detail[key]]))
}

function renderRows(rows: Array<[string, unknown]>): HTMLElement {
  const list = document.createElement('dl')
  list.className = 'qp3d-field-list'

  for (const [label, rawValue] of rows) {
    const value = formatValue(rawValue)
    if (value === '') {
      continue
    }

    const term = document.createElement('dt')
    term.textContent = label
    const description = document.createElement('dd')
    description.textContent = value
    list.append(term, description)
  }

  if (list.childElementCount === 0) {
    const empty = document.createElement('div')
    empty.className = 'qp3d-panel__muted'
    empty.textContent = '暂无数据'
    return empty
  }

  return list
}

function appendStats(panel: HTMLElement, label: string, stats: Record<string, unknown> | undefined): void {
  if (stats == null || Object.keys(stats).length === 0) {
    return
  }

  const section = document.createElement('div')
  section.className = 'qp3d-flags'
  const title = document.createElement('div')
  title.className = 'qp3d-flags__label'
  title.textContent = label
  const list = document.createElement('ul')
  for (const [key, value] of Object.entries(stats)) {
    const item = document.createElement('li')
    item.textContent = `${key}: ${formatValue(value)}`
    list.append(item)
  }

  section.append(title, list)
  panel.append(section)
}

function appendExamples(panel: HTMLElement, examples: NonNullable<AdaptationReport['examples']>): void {
  if (examples.length === 0) {
    return
  }

  const section = document.createElement('div')
  section.className = 'qp3d-flags'
  const title = document.createElement('div')
  title.className = 'qp3d-flags__label'
  title.textContent = '异常样例'
  const list = document.createElement('ul')
  for (const example of examples.slice(0, 10)) {
    const item = document.createElement('li')
    const connected = example.connectedLineIds?.join(', ') ?? ''
    const sources = example.sources ? ` ${JSON.stringify(example.sources)}` : ''
    item.textContent = `${example.pointId ?? '未知管点'} ${connected}${sources}`.trim()
    list.append(item)
  }

  section.append(title, list)
  panel.append(section)
}

function renderQualityFlags(detail: PipeLineDetail | PipePointDetail): HTMLElement | undefined {
  const flags = [
    ...collectFlagArray(detail.qualityFlags),
    ...collectFlagArray(detail.flags),
    ...Object.entries(detail)
      .filter(([key, value]) => /quality|flag|error|warning|异常/.test(key) && value && !Array.isArray(value))
      .map(([key, value]) => `${key}: ${formatValue(value)}`),
  ]

  if (flags.length === 0) {
    return undefined
  }

  const section = document.createElement('div')
  section.className = 'qp3d-flags'

  const label = document.createElement('div')
  label.className = 'qp3d-flags__label'
  label.textContent = '质量标记'

  const list = document.createElement('ul')
  for (const flag of flags) {
    const item = document.createElement('li')
    item.textContent = flag
    list.append(item)
  }

  section.append(label, list)
  return section
}

function collectFlagArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(formatValue).filter(Boolean)
    : []
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function formatValue(value: unknown): string {
  if (value == null) {
    return ''
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : ''
  }

  if (typeof value === 'string') {
    return value.trim()
  }

  if (typeof value === 'boolean') {
    return value ? '是' : '否'
  }

  return JSON.stringify(value)
}
