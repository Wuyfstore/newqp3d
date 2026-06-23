import type { ApiClient, BuildTask, BuildTaskStatus, BuildVersionRecord } from '../services/apiClient'

const STYLE_ID = 'qp3d-build-task-center-styles'

export interface BuildTaskCenterOptions {
  apiClient: ApiClient
  templateId?: string
  getTemplateId?: () => string
  onVersionActivated?: () => void
  onVersionPreview?: (version: string) => void | Promise<void>
  pollIntervalMs?: number
}

export interface BuildTaskCenter {
  element: HTMLElement
  load(): Promise<void>
  destroy(): void
}

export function createBuildTaskCenter(options: BuildTaskCenterOptions): BuildTaskCenter {
  installBuildTaskCenterStyles()

  let tasks: BuildTask[] = []
  let versions: BuildVersionRecord[] = []
  let selectedTaskId: string | undefined
  let pollTimer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  const pollIntervalMs = options.pollIntervalMs ?? 2500
  const element = document.createElement('section')
  element.className = 'qp3d-build-task-center'
  element.setAttribute('aria-label', '构建任务中心')
  renderShell(element)

  async function load(): Promise<void> {
    await refresh()
  }

  async function refresh(): Promise<void> {
    if (disposed) {
      return
    }

    setStatus(element, '任务加载中')
    const [nextTasks, nextVersions] = await Promise.all([
      options.apiClient.listBuildTasks(),
      options.apiClient.listVersions().catch(() => []),
    ])
    tasks = nextTasks
    versions = nextVersions
    if (selectedTaskId == null || !tasks.some(task => task.id === selectedTaskId)) {
      selectedTaskId = tasks[0]?.id
    }
    renderTasks(element, tasks, selectedTaskId)
    if (selectedTaskId) {
      await selectTask(selectedTaskId)
    } else {
      renderTaskDetail(element, undefined, versions)
    }
    setStatus(element, tasks.length === 0 ? '暂无构建任务' : '任务状态已更新')
    schedulePolling()
  }

  async function selectTask(taskId: string): Promise<void> {
    selectedTaskId = taskId
    const detail = await options.apiClient.getBuildTask(taskId)
    tasks = upsertTask(tasks, detail)
    renderTasks(element, tasks, selectedTaskId)
    renderTaskDetail(element, detail, versions)
  }

  async function createTask(): Promise<void> {
    setStatus(element, '构建任务创建中')
    const task = await options.apiClient.createBuildTask(readTemplateId(options))
    tasks = upsertTask(tasks, task)
    selectedTaskId = task.id
    renderTasks(element, tasks, selectedTaskId)
    renderTaskDetail(element, task, versions)
    setStatus(element, '构建任务已创建')
    schedulePolling()
  }

  async function cancelTask(taskId: string): Promise<void> {
    setStatus(element, '任务取消中')
    const task = await options.apiClient.cancelBuildTask(taskId)
    tasks = upsertTask(tasks, task)
    selectedTaskId = task.id
    renderTasks(element, tasks, selectedTaskId)
    renderTaskDetail(element, task, versions)
    setStatus(element, '任务已取消')
  }

  async function publishTaskVersion(version: string): Promise<void> {
    setStatus(element, '版本发布中')
    const manifest = await options.apiClient.publishVersion(version)
    versions = await options.apiClient.listVersions().catch(() => versions)
    const selected = selectedTaskId ? await options.apiClient.getBuildTask(selectedTaskId) : undefined
    if (selected) {
      tasks = upsertTask(tasks, selected)
      renderTasks(element, tasks, selectedTaskId)
    }
    renderTaskDetail(element, selected, versions)
    setStatus(element, `版本已发布: ${manifest.version}`)
    options.onVersionActivated?.()
  }

  async function rollbackVersion(version: string): Promise<void> {
    setStatus(element, '版本回滚中')
    const manifest = await options.apiClient.rollbackVersion(version)
    versions = await options.apiClient.listVersions().catch(() => versions)
    const selected = selectedTaskId ? await options.apiClient.getBuildTask(selectedTaskId) : undefined
    if (selected) {
      tasks = upsertTask(tasks, selected)
      renderTasks(element, tasks, selectedTaskId)
    }
    renderTaskDetail(element, selected, versions)
    setStatus(element, `已回滚到: ${manifest.version}`)
    options.onVersionActivated?.()
  }

  async function previewTaskVersion(version: string): Promise<void> {
    setStatus(element, '版本预览加载中')
    await options.onVersionPreview?.(version)
    setStatus(element, `版本预览中: ${version}`)
  }

  element.addEventListener('click', event => {
    const target = event.target
    if (!(target instanceof HTMLElement)) {
      return
    }

    if (target.matches('[data-build-task-refresh]')) {
      void refresh().catch(error => setStatus(element, `任务刷新失败: ${formatError(error)}`))
      return
    }
    if (target.matches('[data-build-task-create]')) {
      void createTask().catch(error => setStatus(element, `任务创建失败: ${formatError(error)}`))
      return
    }

    const taskButton = target.closest<HTMLElement>('[data-build-task-id]')
    if (taskButton) {
      void selectTask(taskButton.dataset.buildTaskId ?? '')
        .catch(error => setStatus(element, `任务详情失败: ${formatError(error)}`))
      return
    }

    const cancelButton = target.closest<HTMLElement>('[data-build-task-cancel]')
    if (cancelButton) {
      void cancelTask(cancelButton.dataset.buildTaskCancelId ?? '')
        .catch(error => setStatus(element, `任务取消失败: ${formatError(error)}`))
      return
    }

    const publishButton = target.closest<HTMLElement>('[data-build-task-publish]')
    if (publishButton) {
      void publishTaskVersion(publishButton.dataset.buildTaskPublishId ?? '')
        .catch(error => setStatus(element, `版本发布失败: ${formatError(error)}`))
      return
    }

    const previewButton = target.closest<HTMLElement>('[data-build-task-preview]')
    if (previewButton) {
      void previewTaskVersion(previewButton.dataset.buildTaskPreviewId ?? '')
        .catch(error => setStatus(element, `版本预览失败: ${formatError(error)}`))
      return
    }

    const rollbackButton = target.closest<HTMLElement>('[data-version-rollback-id]')
    if (rollbackButton) {
      void rollbackVersion(rollbackButton.dataset.versionRollbackId ?? '')
        .catch(error => setStatus(element, `版本回滚失败: ${formatError(error)}`))
    }
  })

  function schedulePolling(): void {
    if (disposed) {
      return
    }

    clearPolling()
    if (!tasks.some(task => isActiveStatus(task.status))) {
      return
    }

    pollTimer = setTimeout(() => {
      void refresh().catch(error => setStatus(element, `任务刷新失败: ${formatError(error)}`))
    }, pollIntervalMs)
  }

  function clearPolling(): void {
    if (pollTimer !== undefined) {
      clearTimeout(pollTimer)
      pollTimer = undefined
    }
  }

  return {
    element,
    load,
    destroy() {
      disposed = true
      clearPolling()
      element.remove()
    },
  }
}

function readTemplateId(options: BuildTaskCenterOptions): string {
  return options.getTemplateId?.() ?? options.templateId ?? ''
}

function renderShell(element: HTMLElement): void {
  element.innerHTML = `
    <div class="qp3d-build-task-center__header">
      <div>
        <h2>构建任务</h2>
        <p>后台生成与发布状态</p>
      </div>
      <div class="qp3d-build-task-center__actions">
        <button type="button" data-build-task-refresh>刷新</button>
        <button type="button" data-build-task-create>启动</button>
      </div>
    </div>
    <div class="qp3d-build-task-center__list" data-build-task-list></div>
    <div class="qp3d-build-task-center__detail" data-build-task-detail></div>
    <div class="qp3d-build-task-center__status" data-build-task-status></div>
  `
}

function renderTasks(element: HTMLElement, tasks: BuildTask[], selectedTaskId: string | undefined): void {
  const list = requireElement<HTMLElement>(element, '[data-build-task-list]')
  list.replaceChildren()

  if (tasks.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'qp3d-build-task-center__empty'
    empty.textContent = '暂无任务'
    list.append(empty)
    return
  }

  for (const task of tasks) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'qp3d-build-task-center__task'
    if (task.id === selectedTaskId) {
      button.classList.add('is-active')
    }
    button.dataset.buildTaskId = task.id

    const title = document.createElement('span')
    title.textContent = task.templateName
    const meta = document.createElement('small')
    meta.textContent = `${statusLabel(task.status)} · ${formatProgress(task.progress)}`

    button.append(title, meta)
    list.append(button)
  }
}

function renderTaskDetail(element: HTMLElement, task: BuildTask | undefined, versions: BuildVersionRecord[]): void {
  const detail = requireElement<HTMLElement>(element, '[data-build-task-detail]')
  detail.replaceChildren()

  if (task == null) {
    const empty = document.createElement('div')
    empty.className = 'qp3d-build-task-center__empty'
    empty.textContent = '请选择任务'
    detail.append(empty, renderVersionHistory(versions))
    return
  }

  const title = document.createElement('h3')
  title.textContent = `${task.templateName} · ${statusLabel(task.status)}`

  const rows: Array<[string, unknown]> = [
    ['任务 ID', task.id],
    ['模板版本', task.templateVersion],
    ['进度', formatProgress(task.progress)],
    ['输出版本', task.outputVersion],
    ['失败原因', task.failureReason],
    ['更新时间', formatTime(task.updatedAt)],
  ]

  const rowList = document.createElement('dl')
  rowList.className = 'qp3d-build-task-center__rows'
  for (const [label, value] of rows) {
    const formatted = formatValue(value)
    if (!formatted) {
      continue
    }

    const term = document.createElement('dt')
    term.textContent = label
    const description = document.createElement('dd')
    description.textContent = formatted
    rowList.append(term, description)
  }

  const logTitle = document.createElement('div')
  logTitle.className = 'qp3d-build-task-center__log-title'
  logTitle.textContent = '日志'

  const logs = document.createElement('ol')
  logs.className = 'qp3d-build-task-center__logs'
  for (const log of task.logs.slice(-20)) {
    const item = document.createElement('li')
    item.dataset.level = log.level
    item.textContent = `${formatTime(log.timestamp)} ${log.message}`
    logs.append(item)
  }
  if (task.logs.length === 0) {
    const item = document.createElement('li')
    item.textContent = '暂无日志'
    logs.append(item)
  }

  detail.append(title, rowList)
  if (task.status === 'completed' && task.outputVersion) {
    const preview = document.createElement('button')
    preview.type = 'button'
    preview.setAttribute('data-build-task-preview', '')
    preview.dataset.buildTaskPreviewId = task.outputVersion
    preview.textContent = '预览'
    detail.append(preview)

    const publish = document.createElement('button')
    publish.type = 'button'
    publish.setAttribute('data-build-task-publish', '')
    publish.dataset.buildTaskPublishId = task.outputVersion
    publish.textContent = '发布'
    detail.append(publish)
  }
  if (isActiveStatus(task.status)) {
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.setAttribute('data-build-task-cancel', '')
    cancel.dataset.buildTaskCancelId = task.id
    cancel.textContent = '取消'
    detail.append(cancel)
  }
  detail.append(logTitle, logs, renderVersionHistory(versions))
}

function renderVersionHistory(versions: BuildVersionRecord[]): HTMLElement {
  const section = document.createElement('div')
  section.className = 'qp3d-build-task-center__versions'

  const title = document.createElement('div')
  title.className = 'qp3d-build-task-center__log-title'
  title.textContent = '版本'
  section.append(title)

  if (versions.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'qp3d-build-task-center__empty'
    empty.textContent = '暂无版本'
    section.append(empty)
    return section
  }

  const list = document.createElement('div')
  list.className = 'qp3d-build-task-center__version-list'
  for (const version of versions.slice(0, 8)) {
    const row = document.createElement('div')
    row.className = 'qp3d-build-task-center__version'
    const label = document.createElement('span')
    label.textContent = `${version.version} · ${versionStatusLabel(version.status)}`
    row.append(label)
    if (version.status !== 'published') {
      const rollback = document.createElement('button')
      rollback.type = 'button'
      rollback.dataset.versionRollbackId = version.version
      rollback.textContent = '回滚'
      row.append(rollback)
    }
    list.append(row)
  }
  section.append(list)
  return section
}

function upsertTask(tasks: BuildTask[], task: BuildTask): BuildTask[] {
  const existingIndex = tasks.findIndex(item => item.id === task.id)
  if (existingIndex < 0) {
    return [task, ...tasks]
  }

  const next = [...tasks]
  next[existingIndex] = task
  return next
}

function isActiveStatus(status: BuildTaskStatus): boolean {
  return status === 'queued' || status === 'preprocessing' || status === 'tiling' || status === 'validating'
}

function statusLabel(status: BuildTaskStatus): string {
  switch (status) {
    case 'queued':
      return 'queued'
    case 'preprocessing':
      return '预处理'
    case 'tiling':
      return '切片中'
    case 'validating':
      return '校验中'
    case 'completed':
      return '完成'
    case 'failed':
      return '失败'
    case 'canceled':
      return '已取消'
  }
}

function versionStatusLabel(status: BuildVersionRecord['status']): string {
  switch (status) {
    case 'ready':
      return '待发布'
    case 'published':
      return '当前'
    case 'superseded':
      return '历史'
  }
}

function formatProgress(value: number): string {
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`
}

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
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

  return JSON.stringify(value)
}

function setStatus(element: HTMLElement, message: string): void {
  requireElement<HTMLElement>(element, '[data-build-task-status]').textContent = message
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function requireElement<T extends Element>(parent: ParentNode, selector: string): T {
  const element = parent.querySelector<T>(selector)
  if (!element) {
    throw new Error(`Missing build task center element: ${selector}`)
  }

  return element
}

function installBuildTaskCenterStyles(): void {
  if (document.getElementById(STYLE_ID)) {
    return
  }

  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
.qp3d-build-task-center {
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

.qp3d-build-task-center__header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 12px;
}

.qp3d-build-task-center h2,
.qp3d-build-task-center h3,
.qp3d-build-task-center p {
  margin: 0;
}

.qp3d-build-task-center h2 {
  font-size: 15px;
}

.qp3d-build-task-center h3 {
  font-size: 13px;
}

.qp3d-build-task-center p,
.qp3d-build-task-center__status,
.qp3d-build-task-center__empty,
.qp3d-build-task-center small {
  color: #9fb3c8;
  font-size: 12px;
}

.qp3d-build-task-center__actions {
  display: flex;
  gap: 6px;
}

.qp3d-build-task-center button {
  min-height: 28px;
  border: 1px solid rgb(255 255 255 / 14%);
  border-radius: 6px;
  box-sizing: border-box;
  color: #f3f7fb;
  background: rgb(255 255 255 / 8%);
  font: inherit;
  cursor: pointer;
}

.qp3d-build-task-center__actions button,
.qp3d-build-task-center__detail > button {
  padding: 0 10px;
}

.qp3d-build-task-center__list {
  display: grid;
  gap: 5px;
}

.qp3d-build-task-center__task {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  text-align: left;
}

.qp3d-build-task-center__task.is-active {
  border-color: rgb(120 220 180 / 70%);
  background: rgb(120 220 180 / 12%);
}

.qp3d-build-task-center__task span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qp3d-build-task-center__detail {
  display: grid;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid rgb(255 255 255 / 12%);
}

.qp3d-build-task-center__rows {
  display: grid;
  grid-template-columns: 74px minmax(0, 1fr);
  gap: 5px 8px;
  margin: 0;
  font-size: 12px;
}

.qp3d-build-task-center__rows dt {
  color: #9fb3c8;
}

.qp3d-build-task-center__rows dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.qp3d-build-task-center__log-title {
  color: #9fb3c8;
  font-size: 12px;
  font-weight: 700;
}

.qp3d-build-task-center__logs {
  display: grid;
  gap: 4px;
  max-height: 180px;
  overflow: auto;
  margin: 0;
  padding-left: 18px;
  font-size: 12px;
  line-height: 1.35;
}

.qp3d-build-task-center__logs li[data-level="error"] {
  color: #ffb4a9;
}

.qp3d-build-task-center__logs li[data-level="warn"] {
  color: #ffd89a;
}

.qp3d-build-task-center__versions {
  display: grid;
  gap: 6px;
}

.qp3d-build-task-center__version-list {
  display: grid;
  gap: 5px;
}

.qp3d-build-task-center__version {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.qp3d-build-task-center__version span {
  overflow-wrap: anywhere;
}

.qp3d-build-task-center__version button {
  padding: 0 8px;
}
`
  document.head.append(style)
}
