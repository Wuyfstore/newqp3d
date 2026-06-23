import {
  type BuildTemplate,
  createReferenceBuildTemplate,
} from '@new-qp3d/shared'

import type { ApiClient, DataSourceTable, DataSourceTableProfile } from '../services/apiClient'

const STYLE_ID = 'qp3d-template-workbench-styles'

export interface TemplateWorkbenchOptions {
  apiClient: ApiClient
  dataSourceId: string
  onTemplateSaved?: (template: BuildTemplate) => void
}

export interface TemplateWorkbench {
  element: HTMLElement
  load(): Promise<void>
  destroy(): void
}

interface WorkbenchState {
  schema: string
  tables: DataSourceTable[]
  lineProfile?: DataSourceTableProfile
  pointProfile?: DataSourceTableProfile
}

const LINE_FIELDS: Array<[string, string]> = [
  ['id', '管段编码'],
  ['startNodeId', '起点编码'],
  ['endNodeId', '终点编码'],
  ['pipeType', '管线类型'],
  ['owner', '权属'],
  ['material', '材质'],
  ['spec', '规格'],
  ['startInvertElevation', '起点内底标高'],
  ['endInvertElevation', '终点内底标高'],
  ['startDepth', '起点埋深'],
  ['endDepth', '终点埋深'],
  ['flowDirection', '流向'],
  ['length', '长度'],
]

const POINT_FIELDS: Array<[string, string]> = [
  ['id', '管点编码'],
  ['pointType', '管点类型'],
  ['surfaceElevation', '地面标高'],
  ['size', '尺寸'],
  ['shape', '形状'],
  ['depth', '井深'],
  ['material', '材质'],
  ['spec', '规格'],
  ['diameter', '口径'],
]

export function createTemplateWorkbench(options: TemplateWorkbenchOptions): TemplateWorkbench {
  installTemplateWorkbenchStyles()

  const state: WorkbenchState = {
    schema: '',
    tables: [],
  }
  const element = document.createElement('section')
  element.className = 'qp3d-template-workbench'
  element.setAttribute('aria-label', '构建模板工作台')
  renderShell(element)

  async function load(): Promise<void> {
    setStatus(element, '字段探测加载中')
    const schemas = await options.apiClient.listSchemas()
    state.schema = schemas[0]?.name ?? 'public'
    state.tables = await options.apiClient.listTables(state.schema)
    const lineTable = chooseTable(state.tables, 'line')
    const pointTable = chooseTable(state.tables, 'point')

    const [lineProfile, pointProfile] = await Promise.all([
      options.apiClient.getTableProfile(state.schema, lineTable.name),
      options.apiClient.getTableProfile(state.schema, pointTable.name),
    ])
    state.lineProfile = lineProfile
    state.pointProfile = pointProfile
    renderLoaded(element, state)
    setStatus(element, '字段推荐已生成')
  }

  element.addEventListener('click', event => {
    const target = event.target
    if (!(target instanceof HTMLElement) || !target.matches('[data-template-save]')) {
      return
    }

    void saveTemplate(element, state, options)
  })

  return {
    element,
    load,
    destroy() {
      element.remove()
    },
  }
}

function renderShell(element: HTMLElement): void {
  element.innerHTML = `
    <div class="qp3d-template-workbench__header">
      <div>
        <h2>构建模板</h2>
        <p>字段映射和默认构建参数</p>
      </div>
      <button type="button" data-template-save>保存</button>
    </div>
    <label class="qp3d-template-workbench__field">
      <span>模板名称</span>
      <input data-template-name value="溧阳供排水管网参考模板">
    </label>
    <label class="qp3d-template-workbench__field">
      <span>Schema</span>
      <select data-template-schema></select>
    </label>
    <div class="qp3d-template-workbench__body" data-template-body></div>
    <div class="qp3d-template-workbench__status" data-template-status></div>
  `
}

function renderLoaded(element: HTMLElement, state: WorkbenchState): void {
  const schemaSelect = requireElement<HTMLSelectElement>(element, '[data-template-schema]')
  const schemaOption = document.createElement('option')
  schemaOption.value = state.schema
  schemaOption.textContent = state.schema
  schemaOption.selected = true
  schemaSelect.replaceChildren(schemaOption)

  const body = requireElement<HTMLElement>(element, '[data-template-body]')
  body.replaceChildren(
    renderProfileSection('line', '线表', state.lineProfile, LINE_FIELDS),
    renderProfileSection('point', '点表', state.pointProfile, POINT_FIELDS),
  )
}

function renderProfileSection(
  kind: 'line' | 'point',
  title: string,
  profile: DataSourceTableProfile | undefined,
  fields: Array<[string, string]>,
): HTMLElement {
  const section = document.createElement('section')
  section.className = 'qp3d-template-workbench__section'

  const heading = document.createElement('h3')
  heading.textContent = profile == null ? title : `${title}: ${profile.table}`
  section.append(heading)

  if (profile == null) {
    const empty = document.createElement('p')
    empty.textContent = '未探测到表'
    section.append(empty)
    return section
  }

  const meta = document.createElement('div')
  meta.className = 'qp3d-template-workbench__meta'
  meta.textContent = `几何: ${profile.geometryFields[0]?.name ?? 'geom'} / ${profile.geometryFields[0]?.geometryType ?? '未知'}`
  section.append(meta)

  const grid = document.createElement('div')
  grid.className = 'qp3d-template-workbench__mapping'
  for (const [key, label] of fields) {
    const row = document.createElement('label')
    row.className = 'qp3d-template-workbench__mapping-row'

    const text = document.createElement('span')
    text.textContent = label

    const input = document.createElement('input')
    input.dataset.field = `${kind}.${key}`
    input.value = profile.recommendedFieldMapping[key] ?? ''

    row.append(text, input)
    grid.append(row)
  }
  section.append(grid)
  return section
}

async function saveTemplate(
  element: HTMLElement,
  state: WorkbenchState,
  options: TemplateWorkbenchOptions,
): Promise<void> {
  if (state.lineProfile == null || state.pointProfile == null) {
    setStatus(element, '字段探测未完成')
    return
  }

  setStatus(element, '模板保存中')
  const name = requireElement<HTMLInputElement>(element, '[data-template-name]').value.trim() || '参数化管网构建模板'
  const reference = createReferenceBuildTemplate()
  const template: BuildTemplate = {
    ...reference,
    id: slugify(name),
    name,
    description: '通过字段映射工作台生成的构建模板',
    dataSourceId: options.dataSourceId,
    status: 'draft',
    lineTable: {
      schema: state.lineProfile.schema,
      table: state.lineProfile.table,
      geometryField: state.lineProfile.geometryFields[0]?.name ?? 'geom',
      fieldMapping: readMapping(element, 'line', LINE_FIELDS),
    },
    pointTable: {
      schema: state.pointProfile.schema,
      table: state.pointProfile.table,
      geometryField: state.pointProfile.geometryFields[0]?.name ?? 'geom',
      fieldMapping: readMapping(element, 'point', POINT_FIELDS),
    },
  }

  const savedTemplate = await options.apiClient.createBuildTemplate(template)
  options.onTemplateSaved?.(savedTemplate)
  setStatus(element, '模板已保存')
}

function readMapping(element: HTMLElement, kind: 'line' | 'point', fields: Array<[string, string]>): Record<string, string> {
  const mapping: Record<string, string> = {}
  for (const [key] of fields) {
    const value = element.querySelector<HTMLInputElement>(`[data-field="${kind}.${key}"]`)?.value.trim()
    if (value) {
      mapping[key] = value
    }
  }
  return mapping
}

function chooseTable(tables: DataSourceTable[], kind: 'line' | 'point'): DataSourceTable {
  const pattern = kind === 'line' ? /xbtj|line|pipe/i : /dbtj|point|node/i
  const table = tables.find(item => pattern.test(item.name)) ?? tables[0]
  if (table == null) {
    throw new Error('No datasource table is available')
  }

  return table
}

function slugify(value: string): string {
  const ascii = value
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()

  return ascii || 'parametric-template'
}

function setStatus(element: HTMLElement, message: string): void {
  requireElement<HTMLElement>(element, '[data-template-status]').textContent = message
}

function requireElement<T extends Element>(parent: ParentNode, selector: string): T {
  const element = parent.querySelector<T>(selector)
  if (!element) {
    throw new Error(`Missing template workbench element: ${selector}`)
  }

  return element
}

function installTemplateWorkbenchStyles(): void {
  if (document.getElementById(STYLE_ID)) {
    return
  }

  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
.qp3d-template-workbench {
  display: grid;
  gap: 10px;
  width: 460px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 64px);
  overflow: auto;
  padding: 12px;
  box-sizing: border-box;
  color: #f3f7fb;
}

.qp3d-template-workbench__header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 12px;
}

.qp3d-template-workbench h2,
.qp3d-template-workbench h3,
.qp3d-template-workbench p {
  margin: 0;
}

.qp3d-template-workbench h2 {
  font-size: 15px;
}

.qp3d-template-workbench h3 {
  font-size: 13px;
}

.qp3d-template-workbench p,
.qp3d-template-workbench__meta,
.qp3d-template-workbench__status {
  color: #9fb3c8;
  font-size: 12px;
}

.qp3d-template-workbench button,
.qp3d-template-workbench input,
.qp3d-template-workbench select {
  min-height: 28px;
  border: 1px solid rgb(255 255 255 / 14%);
  border-radius: 6px;
  box-sizing: border-box;
  color: #f3f7fb;
  background: rgb(255 255 255 / 8%);
  font: inherit;
}

.qp3d-template-workbench button {
  padding: 0 10px;
  cursor: pointer;
}

.qp3d-template-workbench__field,
.qp3d-template-workbench__mapping-row {
  display: grid;
  grid-template-columns: 100px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.qp3d-template-workbench input,
.qp3d-template-workbench select {
  width: 100%;
  min-width: 0;
  padding: 0 7px;
}

.qp3d-template-workbench__body {
  display: grid;
  gap: 10px;
}

.qp3d-template-workbench__section {
  display: grid;
  gap: 7px;
  padding-top: 10px;
  border-top: 1px solid rgb(255 255 255 / 12%);
}

.qp3d-template-workbench__mapping {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 10px;
}
`
  document.head.append(style)
}
