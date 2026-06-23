# Cesium Pipe Network 3D Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-ready CesiumJS 1.117 read-only 3D visualization system for million-scale urban rainwater/sewage pipe networks from PostGIS source tables.

**Architecture:** Use a TypeScript monorepo with separate packages for shared domain contracts, PostGIS/data-processing pipeline, API service, and Cesium web client. The main rendering path is preprocessed 3D Tiles loaded by Cesium, while API endpoints handle search, detail lookup, build versions, and quality reports. The pipeline normalizes source data, audits over-segmentation/duplicates, builds display segments and feature metadata, emits versioned tilesets, and publishes only stable versions.

**Tech Stack:** pnpm workspace, TypeScript, Node.js 24+, Vitest, Fastify, PostgreSQL/PostGIS, CesiumJS 1.117, Vite, Playwright, GLB/3D Tiles output.

## Global Constraints

- Target Cesium version is exactly `CesiumJS 1.117`.
- Phase 1 is read-only visualization; no Cesium-side add/edit/delete/write-back is in scope.
- Source tables are `public.sys_016_tancedbtjinfo_sde` for points and `public.sys_016_tancexbtjinfo_sde` for lines.
- Current measured source geometry SRID is `3857`; the pipeline must validate SRID at runtime and report mismatches.
- The line table is about `952,061` rows and must be treated as million-scale data.
- The point table is about `19,842` rows and current categories are dominated by rain grates, sewage grates, inlets, reserved outlets, and a small number of wells.
- The line table is over-segmented; the pipeline must audit exact duplicates, reverse-geometry duplicates, endpoint duplicates, short segments, and mergeable same-attribute continuous chains before generating display geometry.
- The frontend must not load the full dataset as GeoJSON or million-scale Cesium Entity objects.
- The main pipe rendering path must use 3D Tiles or GLB-backed tilesets loaded on demand.
- Data updates are periodic; the implementation must support background rebuilds, versioned output, validation, and stable-version fallback.
- Browser clients must not connect directly to the database. Database credentials live only in server-side environment variables.
- Invalid specs, missing heights, missing endpoint matches, duplicate candidates, and defaulted heights must be reported without failing the whole build.
- Every pickable rendered feature must keep a stable business identifier and enough metadata to fetch full details from the API.
- Pipes should be generated from data when possible; external glTF/GLB models are reserved for hydrants, gates/valves, pump stations, special outlets, and other complex facilities.

---

## Source PRD

Primary PRD: `docs/prd/2026-06-21-cesium-pipe-network-3d-prd.md`

## File Structure

Create the repository as a focused monorepo:

```text
apps/
  api/
    package.json
    src/
      config/env.ts
      db/pool.ts
      routes/details.ts
      routes/search.ts
      routes/versions.ts
      routes/quality.ts
      server.ts
    tests/
      search.test.ts
      details.test.ts
      versions.test.ts
  web/
    package.json
    index.html
    src/
      App.ts
      main.ts
      cesium/createViewer.ts
      cesium/layers.ts
      cesium/picking.ts
      cesium/styles.ts
      state/layerState.ts
      services/apiClient.ts
      ui/panels.ts
    tests/
      layerState.test.ts
      apiClient.test.ts
    e2e/
      viewer.spec.ts
packages/
  shared/
    package.json
    src/
      domain.ts
      dictionaries.ts
      quality.ts
      versioning.ts
    tests/
      dictionaries.test.ts
  pipeline/
    package.json
    src/
      cli.ts
      config.ts
      datasource/postgis.ts
      normalize/spec.ts
      normalize/height.ts
      normalize/material.ts
      topology/graph.ts
      topology/fragmentAudit.ts
      topology/mergeChains.ts
      geometry/pipeMesh.ts
      geometry/nodeMesh.ts
      tiles/tileGrid.ts
      tiles/glbWriter.ts
      tiles/tilesetWriter.ts
      quality/report.ts
      publish/versionStore.ts
    tests/
      spec.test.ts
      height.test.ts
      fragmentAudit.test.ts
      mergeChains.test.ts
      pipeMesh.test.ts
      tileGrid.test.ts
      tilesetWriter.test.ts
scripts/
  inspect-db.mjs
  smoke-build-sample.mjs
docs/
  architecture/
    pipe-network-tiling-architecture.md
  data/
    pipe-network-field-dictionary.md
    pipe-network-quality-rules.md
  assets/
    pipe-network-model-asset-list.md
  operations/
    build-and-publish-runbook.md
fixtures/
  pipeline/
    sample-lines.json
    sample-points.json
    sample-quality-report.json
package.json
pnpm-workspace.yaml
tsconfig.base.json
vitest.workspace.ts
playwright.config.ts
```

Responsibility boundaries:

- `packages/shared`: domain types, dictionaries, quality enums, build-version helpers shared by pipeline/API/web.
- `packages/pipeline`: all data extraction, normalization, topology, over-segmentation audit, geometry generation, 3D Tiles/GLB writing, and publishing.
- `apps/api`: server-only access to PostGIS and published build artifacts; exposes search, detail, version, and quality endpoints.
- `apps/web`: Cesium viewer and UI state; loads tilesets and talks only to API/static tile URLs.
- `docs/data`, `docs/assets`, `docs/architecture`, `docs/operations`: implementation-facing documentation generated alongside code.

## Task 1: Bootstrap Monorepo Tooling

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `vitest.workspace.ts`
- Create: `playwright.config.ts`
- Create: `.gitignore`
- Create: `packages/shared/package.json`
- Create: `packages/pipeline/package.json`
- Create: `apps/api/package.json`
- Create: `apps/web/package.json`

**Interfaces:**
- Consumes: none.
- Produces: workspace scripts `typecheck`, `test`, `test:pipeline`, `test:api`, `test:web`, `e2e`, `build:pipeline`, `build:api`, `build:web`.

- [ ] **Step 1: Write the workspace package files**

Create root `package.json` with exact script names used by later tasks:

```json
{
  "name": "new-qp3d",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.0.0",
  "scripts": {
    "typecheck": "pnpm -r typecheck",
    "test": "vitest run",
    "test:pipeline": "vitest run packages/pipeline/tests",
    "test:api": "vitest run apps/api/tests",
    "test:web": "vitest run apps/web/tests",
    "e2e": "playwright test",
    "build:pipeline": "pnpm --filter @new-qp3d/pipeline build",
    "build:api": "pnpm --filter @new-qp3d/api build",
    "build:web": "pnpm --filter @new-qp3d/web build"
  },
  "devDependencies": {
    "@playwright/test": "^1.54.0",
    "@types/node": "^24.0.0",
    "typescript": "^5.8.0",
    "vitest": "^3.2.0"
  }
}
```

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true,
    "outDir": "dist"
  }
}
```

- [ ] **Step 2: Add workspace test configuration**

Create `vitest.workspace.ts`:

```ts
import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  'packages/shared',
  'packages/pipeline',
  'apps/api',
  'apps/web',
])
```

Create `playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test'

const desktopChrome = devices['Desktop Chrome']
const pixel7 = devices['Pixel 7']

export default defineConfig({
  testDir: 'apps/web/e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium-desktop', use: desktopChrome },
    { name: 'chromium-mobile', use: pixel7 },
  ],
})
```

- [ ] **Step 3: Add package manifests**

Create `packages/shared/package.json`:

```json
{
  "name": "@new-qp3d/shared",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/domain.js",
  "types": "dist/domain.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run tests"
  },
  "devDependencies": {
    "typescript": "^5.8.0",
    "vitest": "^3.2.0"
  }
}
```

Create matching manifests for `packages/pipeline`, `apps/api`, and `apps/web` using package names `@new-qp3d/pipeline`, `@new-qp3d/api`, and `@new-qp3d/web`. Include `@new-qp3d/shared` as a workspace dependency in all three packages.

- [ ] **Step 4: Install dependencies**

Run:

```bash
pnpm install
```

Expected: lockfile created and install exits with code `0`.

- [ ] **Step 5: Verify empty workspace commands**

Run:

```bash
pnpm typecheck
pnpm test
```

Expected: TypeScript reports no project files or passes once `tsconfig.json` package files are added in Task 2; Vitest exits cleanly once the first tests are added.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json vitest.workspace.ts playwright.config.ts .gitignore packages apps
git commit -m "chore: bootstrap pipe network workspace"
```

## Task 2: Define Shared Domain Contracts and Dictionaries

**Files:**
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/domain.ts`
- Create: `packages/shared/src/dictionaries.ts`
- Create: `packages/shared/src/quality.ts`
- Create: `packages/shared/src/versioning.ts`
- Create: `packages/shared/tests/dictionaries.test.ts`

**Interfaces:**
- Consumes: workspace TypeScript setup from Task 1.
- Produces:
  - `PipeLineRawRow`
  - `PointFacilityRawRow`
  - `PipeSpec`
  - `HeightQuality`
  - `FeatureQualityFlag`
  - `BuildVersion`
  - `createBuildVersion(date: Date): BuildVersion`
  - `PIPE_LAYER_TYPES`
  - `POINT_FACILITY_RENDER_RULES`

- [ ] **Step 1: Write failing dictionary tests**

Create `packages/shared/tests/dictionaries.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  PIPE_LAYER_TYPES,
  POINT_FACILITY_RENDER_RULES,
  getPipeColor,
  getPointRenderRule,
} from '../src/dictionaries'

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
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
pnpm test -- packages/shared/tests/dictionaries.test.ts
```

Expected: FAIL because `packages/shared/src/dictionaries.ts` does not exist.

- [ ] **Step 3: Implement shared types and dictionaries**

Create `packages/shared/src/domain.ts`:

```ts
export type PipeLayerType = '雨水管' | '污水管' | string
export type PipeOwnerScope = '市政' | '小区' | '农村' | string

export interface PipeLineRawRow {
  guid: string
  qdbm: string | null
  zdbm: string | null
  cz: string | null
  dmcc: number | null
  gg: string | null
  qdms: number | null
  zdms: number | null
  qdndbg: number | null
  zdndbg: number | null
  gwlx: PipeLayerType | null
  gs: PipeOwnerScope | null
  msfs: string | null
  lx: string | null
  gdsx: string | null
  gdcd: string | null
  geomWkbHex: string
}

export interface PointFacilityRawRow {
  gdbm: string | null
  hzb: number | null
  zzb: number | null
  lbmc: string | null
  dmbg: number | null
  kj: number | null
  js: number | null
  ms: number | null
  gg: string | null
  jgcz: string | null
  jgxz: string | null
  jgcc: string | null
  tag: string | null
  geomWkbHex: string
}

export type PipeSpec =
  | { kind: 'round'; diameterMm: number; source: string; quality: 'parsed' | 'defaulted' }
  | { kind: 'box'; widthMm: number; heightMm: number; source: string; quality: 'parsed' | 'defaulted' }

export type HeightQuality = 'inner-bottom' | 'depth-estimated' | 'defaulted'

export interface BuildVersion {
  id: string
  createdAt: string
}
```

Create `packages/shared/src/quality.ts`:

```ts
export type FeatureQualityFlag =
  | 'invalid-geometry'
  | 'srid-mismatch'
  | 'missing-code'
  | 'duplicate-guid'
  | 'duplicate-geometry'
  | 'reverse-duplicate-geometry'
  | 'spec-defaulted'
  | 'height-defaulted'
  | 'endpoint-unmatched'
  | 'merge-candidate'
```

Create `packages/shared/src/versioning.ts`:

```ts
import type { BuildVersion } from './domain'

export function createBuildVersion(date: Date): BuildVersion {
  const pad = (value: number) => String(value).padStart(2, '0')
  const id = [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    '-',
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
  ].join('')

  return {
    id: `network-${id}`,
    createdAt: date.toISOString(),
  }
}
```

Create `packages/shared/src/dictionaries.ts`:

```ts
export const PIPE_LAYER_TYPES = ['雨水管', '污水管'] as const

export type RenderStrategy = 'generated-low-poly' | 'generated-parametric' | 'model'

export interface PointFacilityRenderRule {
  category: string
  strategy: RenderStrategy
  symbol: string
}

const PIPE_COLORS = new Map<string, string>([
  ['雨水管', '#00A9CE'],
  ['污水管', '#A23B72'],
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
```

- [ ] **Step 4: Add package tsconfig**

Create `packages/shared/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "tests"],
  "compilerOptions": {
    "rootDir": ".",
    "outDir": "dist"
  }
}
```

- [ ] **Step 5: Run tests and typecheck**

Run:

```bash
pnpm --filter @new-qp3d/shared test
pnpm --filter @new-qp3d/shared typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared
git commit -m "feat: add pipe network domain contracts"
```

## Task 3: Add PostGIS Data Source and Database Inspection CLI

**Files:**
- Create: `packages/pipeline/tsconfig.json`
- Create: `packages/pipeline/src/config.ts`
- Create: `packages/pipeline/src/datasource/postgis.ts`
- Create: `packages/pipeline/tests/postgisSql.test.ts`
- Create: `scripts/inspect-db.mjs`

**Interfaces:**
- Consumes: `PipeLineRawRow`, `PointFacilityRawRow` from `@new-qp3d/shared`.
- Produces:
  - `loadPipelineConfig(env: NodeJS.ProcessEnv): PipelineConfig`
  - `createPostgisQueries(config: PipelineConfig): PostgisQueries`
  - `PostgisDataSource.readLines(limit?: number): AsyncIterable<PipeLineRawRow>`
  - `PostgisDataSource.readPoints(limit?: number): AsyncIterable<PointFacilityRawRow>`
  - `PostgisDataSource.inspect(): Promise<DatabaseInspection>`

- [ ] **Step 1: Write failing SQL contract tests**

Create `packages/pipeline/tests/postgisSql.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createPostgisQueries } from '../src/datasource/postgis'

describe('PostGIS query builder', () => {
  it('selects measured SRID and WKB from the configured line table', () => {
    const queries = createPostgisQueries({
      databaseUrl: 'postgres://example',
      pointTable: 'public.sys_016_tancedbtjinfo_sde',
      lineTable: 'public.sys_016_tancexbtjinfo_sde',
      expectedSrid: 3857,
      outputRoot: 'data/tiles',
    })

    expect(queries.inspectLineTable).toContain('ST_SRID(geom)')
    expect(queries.readLines).toContain('ST_AsEWKB(geom)')
    expect(queries.readLines).toContain('public.sys_016_tancexbtjinfo_sde')
  })

  it('selects all point fields required by the PRD', () => {
    const queries = createPostgisQueries({
      databaseUrl: 'postgres://example',
      pointTable: 'public.sys_016_tancedbtjinfo_sde',
      lineTable: 'public.sys_016_tancexbtjinfo_sde',
      expectedSrid: 3857,
      outputRoot: 'data/tiles',
    })

    expect(queries.readPoints).toContain('gdbm')
    expect(queries.readPoints).toContain('lbmc')
    expect(queries.readPoints).toContain('ST_AsEWKB(geom)')
  })
})
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
pnpm test -- packages/pipeline/tests/postgisSql.test.ts
```

Expected: FAIL because `createPostgisQueries` is not defined.

- [ ] **Step 3: Install PostGIS client dependency**

Install:

```bash
pnpm --filter @new-qp3d/pipeline add pg
pnpm --filter @new-qp3d/pipeline add -D @types/pg
```

- [ ] **Step 4: Implement pipeline config, query builder, and datasource**

Create `packages/pipeline/src/config.ts`:

```ts
export interface PipelineConfig {
  databaseUrl: string
  pointTable: string
  lineTable: string
  expectedSrid: number
  outputRoot: string
}

export function loadPipelineConfig(env: NodeJS.ProcessEnv): PipelineConfig {
  const databaseUrl = env.QP3D_DATABASE_URL
  if (!databaseUrl) {
    throw new Error('QP3D_DATABASE_URL is required')
  }

  return {
    databaseUrl,
    pointTable: env.QP3D_POINT_TABLE ?? 'public.sys_016_tancedbtjinfo_sde',
    lineTable: env.QP3D_LINE_TABLE ?? 'public.sys_016_tancexbtjinfo_sde',
    expectedSrid: Number(env.QP3D_EXPECTED_SRID ?? 3857),
    outputRoot: env.QP3D_OUTPUT_ROOT ?? 'data/tiles',
  }
}
```

Create `packages/pipeline/src/datasource/postgis.ts` with SQL strings and a streaming datasource. The query builder must quote only validated `schema.table` names:

```ts
import pg from 'pg'
import type { PipeLineRawRow, PointFacilityRawRow } from '@new-qp3d/shared/src/domain'
import type { PipelineConfig } from '../config'

const { Client } = pg

export interface PostgisQueries {
  inspectLineTable: string
  inspectPointTable: string
  readLines: string
  readPoints: string
}

export interface DatabaseInspection {
  lineCount: number
  pointCount: number
  lineSrids: Array<{ srid: number; count: number }>
  pointSrids: Array<{ srid: number; count: number }>
}

function tableName(name: string): string {
  if (!/^[a-zA-Z_][\w]*\.[a-zA-Z_][\w]*$/.test(name)) {
    throw new Error(`Invalid table name: ${name}`)
  }
  return name
}

export function createPostgisQueries(config: PipelineConfig): PostgisQueries {
  const lineTable = tableName(config.lineTable)
  const pointTable = tableName(config.pointTable)

  return {
    inspectLineTable: `select ST_SRID(geom) as srid, count(*)::int as count from ${lineTable} group by ST_SRID(geom) order by count desc`,
    inspectPointTable: `select ST_SRID(geom) as srid, count(*)::int as count from ${pointTable} group by ST_SRID(geom) order by count desc`,
    readLines: `select guid, qdbm, zdbm, cz, dmcc, gg, qdms, zdms, qdndbg, zdndbg, gwlx, gs, msfs, lx, gdsx, gdcd, encode(ST_AsEWKB(geom), 'hex') as "geomWkbHex" from ${lineTable} where geom is not null`,
    readPoints: `select gdbm, hzb, zzb, lbmc, dmbg, kj, js, ms, gg, jgcz, jgxz, jgcc, tag, encode(ST_AsEWKB(geom), 'hex') as "geomWkbHex" from ${pointTable} where geom is not null`,
  }
}

export class PostgisDataSource {
  constructor(private readonly config: PipelineConfig) {}

  async inspect(): Promise<DatabaseInspection> {
    const queries = createPostgisQueries(this.config)
    const client = new Client({ connectionString: this.config.databaseUrl })
    await client.connect()
    try {
      const [lineCount, pointCount, lineSrids, pointSrids] = await Promise.all([
        client.query<{ count: string }>(`select count(*)::bigint as count from ${tableName(this.config.lineTable)}`),
        client.query<{ count: string }>(`select count(*)::bigint as count from ${tableName(this.config.pointTable)}`),
        client.query<{ srid: number; count: number }>(queries.inspectLineTable),
        client.query<{ srid: number; count: number }>(queries.inspectPointTable),
      ])

      return {
        lineCount: Number(lineCount.rows[0]?.count ?? 0),
        pointCount: Number(pointCount.rows[0]?.count ?? 0),
        lineSrids: lineSrids.rows,
        pointSrids: pointSrids.rows,
      }
    } finally {
      await client.end()
    }
  }

  async *readLines(limit?: number): AsyncIterable<PipeLineRawRow> {
    const queries = createPostgisQueries(this.config)
    const client = new Client({ connectionString: this.config.databaseUrl })
    await client.connect()
    try {
      const sql = limit == null ? queries.readLines : `${queries.readLines} limit ${Number(limit)}`
      const result = await client.query<PipeLineRawRow>(sql)
      for (const row of result.rows) yield row
    } finally {
      await client.end()
    }
  }

  async *readPoints(limit?: number): AsyncIterable<PointFacilityRawRow> {
    const queries = createPostgisQueries(this.config)
    const client = new Client({ connectionString: this.config.databaseUrl })
    await client.connect()
    try {
      const sql = limit == null ? queries.readPoints : `${queries.readPoints} limit ${Number(limit)}`
      const result = await client.query<PointFacilityRawRow>(sql)
      for (const row of result.rows) yield row
    } finally {
      await client.end()
    }
  }
}
```

- [ ] **Step 5: Add manual inspection CLI**

Create `scripts/inspect-db.mjs`:

```js
import { loadPipelineConfig } from '../packages/pipeline/dist/config.js'
import { PostgisDataSource } from '../packages/pipeline/dist/datasource/postgis.js'

const config = loadPipelineConfig()
const source = new PostgisDataSource(config)
const inspection = await source.inspect()
console.log(JSON.stringify(inspection, null, 2))
```

- [ ] **Step 6: Verify tests and DB inspection**

Run:

```bash
pnpm --filter @new-qp3d/pipeline test
pnpm --filter @new-qp3d/pipeline build
node scripts/inspect-db.mjs
```

Expected: tests pass; after `config/backend.env` contains real server-side credentials, inspection reports line/point counts and SRID `3857`.

- [ ] **Step 7: Commit**

```bash
git add packages/pipeline scripts/inspect-db.mjs pnpm-lock.yaml
git commit -m "feat: add postgis inspection datasource"
```

## Task 4: Implement Spec, Material, and Height Normalization

**Files:**
- Create: `packages/pipeline/src/normalize/spec.ts`
- Create: `packages/pipeline/src/normalize/height.ts`
- Create: `packages/pipeline/src/normalize/material.ts`
- Create: `packages/pipeline/tests/spec.test.ts`
- Create: `packages/pipeline/tests/height.test.ts`
- Create: `docs/data/pipe-network-field-dictionary.md`
- Create: `docs/data/pipe-network-quality-rules.md`

**Interfaces:**
- Consumes: `PipeSpec`, `HeightQuality`, `FeatureQualityFlag`.
- Produces:
  - `parsePipeSpec(raw: string | null | undefined): PipeSpec`
  - `normalizeMaterial(raw: string | null | undefined): string`
  - `computePipeCenterHeights(input: HeightInput): HeightResult`
  - `HeightInput`
  - `HeightResult`

- [ ] **Step 1: Write failing spec parser tests**

Create `packages/pipeline/tests/spec.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parsePipeSpec } from '../src/normalize/spec'

describe('parsePipeSpec', () => {
  it.each([
    ['300', { kind: 'round', diameterMm: 300, source: '300', quality: 'parsed' }],
    [' DN600 ', { kind: 'round', diameterMm: 600, source: ' DN600 ', quality: 'parsed' }],
    ['200X200', { kind: 'box', widthMm: 200, heightMm: 200, source: '200X200', quality: 'parsed' }],
    ['700×450', { kind: 'box', widthMm: 700, heightMm: 450, source: '700×450', quality: 'parsed' }],
  ])('parses %s', (raw, expected) => {
    expect(parsePipeSpec(raw)).toEqual(expected)
  })

  it.each([null, '', '0', '缺失', '其他'])('defaults invalid spec %s', raw => {
    expect(parsePipeSpec(raw)).toEqual({
      kind: 'round',
      diameterMm: 300,
      source: raw ?? '',
      quality: 'defaulted',
    })
  })
})
```

- [ ] **Step 2: Write failing height tests**

Create `packages/pipeline/tests/height.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { computePipeCenterHeights } from '../src/normalize/height'

describe('computePipeCenterHeights', () => {
  it('uses inner-bottom elevations first and adds radius', () => {
    expect(computePipeCenterHeights({
      spec: { kind: 'round', diameterMm: 600, source: '600', quality: 'parsed' },
      qdndbg: 12,
      zdndbg: 13,
      qdms: 2,
      zdms: 2,
      groundElevation: 20,
      defaultDepthMeters: 2.5,
    })).toEqual({ startCenterZ: 12.3, endCenterZ: 13.3, quality: 'inner-bottom' })
  })

  it('uses depth from ground when inner-bottom is missing', () => {
    expect(computePipeCenterHeights({
      spec: { kind: 'round', diameterMm: 400, source: '400', quality: 'parsed' },
      qdndbg: null,
      zdndbg: null,
      qdms: 3,
      zdms: 4,
      groundElevation: 20,
      defaultDepthMeters: 2.5,
    })).toEqual({ startCenterZ: 17.2, endCenterZ: 16.2, quality: 'depth-estimated' })
  })

  it('uses configured default depth when height fields are missing', () => {
    expect(computePipeCenterHeights({
      spec: { kind: 'box', widthMm: 700, heightMm: 450, source: '700X450', quality: 'parsed' },
      qdndbg: null,
      zdndbg: null,
      qdms: null,
      zdms: null,
      groundElevation: 20,
      defaultDepthMeters: 2.5,
    })).toEqual({ startCenterZ: 17.725, endCenterZ: 17.725, quality: 'defaulted' })
  })
})
```

- [ ] **Step 3: Run failing tests**

Run:

```bash
pnpm test -- packages/pipeline/tests/spec.test.ts packages/pipeline/tests/height.test.ts
```

Expected: FAIL because normalization modules do not exist.

- [ ] **Step 4: Implement normalization**

Create `packages/pipeline/src/normalize/spec.ts`:

```ts
import type { PipeSpec } from '@new-qp3d/shared/src/domain'

const DEFAULT_DIAMETER_MM = 300

export function parsePipeSpec(raw: string | null | undefined): PipeSpec {
  const source = raw ?? ''
  const value = source.trim().toUpperCase().replace('×', 'X').replace(/^DN/, '')

  const box = value.match(/^(\d+(?:\.\d+)?)\s*X\s*(\d+(?:\.\d+)?)$/)
  if (box) {
    const widthMm = Number(box[1])
    const heightMm = Number(box[2])
    if (widthMm > 0 && heightMm > 0) {
      return { kind: 'box', widthMm, heightMm, source, quality: 'parsed' }
    }
  }

  const round = value.match(/^(\d+(?:\.\d+)?)$/)
  if (round) {
    const diameterMm = Number(round[1])
    if (diameterMm > 0) {
      return { kind: 'round', diameterMm, source, quality: 'parsed' }
    }
  }

  return { kind: 'round', diameterMm: DEFAULT_DIAMETER_MM, source, quality: 'defaulted' }
}
```

Create `packages/pipeline/src/normalize/height.ts`:

```ts
import type { HeightQuality, PipeSpec } from '@new-qp3d/shared/src/domain'

export interface HeightInput {
  spec: PipeSpec
  qdndbg: number | null
  zdndbg: number | null
  qdms: number | null
  zdms: number | null
  groundElevation: number
  defaultDepthMeters: number
}

export interface HeightResult {
  startCenterZ: number
  endCenterZ: number
  quality: HeightQuality
}

function halfHeightMeters(spec: PipeSpec): number {
  return spec.kind === 'round' ? spec.diameterMm / 2000 : spec.heightMm / 2000
}

function roundMillimeter(value: number): number {
  return Math.round(value * 1000) / 1000
}

export function computePipeCenterHeights(input: HeightInput): HeightResult {
  const offset = halfHeightMeters(input.spec)

  if (input.qdndbg != null && input.zdndbg != null) {
    return {
      startCenterZ: roundMillimeter(input.qdndbg + offset),
      endCenterZ: roundMillimeter(input.zdndbg + offset),
      quality: 'inner-bottom',
    }
  }

  if (input.qdms != null && input.zdms != null) {
    return {
      startCenterZ: roundMillimeter(input.groundElevation - input.qdms + offset),
      endCenterZ: roundMillimeter(input.groundElevation - input.zdms + offset),
      quality: 'depth-estimated',
    }
  }

  const center = roundMillimeter(input.groundElevation - input.defaultDepthMeters + offset)
  return { startCenterZ: center, endCenterZ: center, quality: 'defaulted' }
}
```

Create `packages/pipeline/src/normalize/material.ts`:

```ts
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
  return MATERIAL_ALIASES.get(value) ?? value
}
```

- [ ] **Step 5: Write data docs**

Create `docs/data/pipe-network-field-dictionary.md` with field meanings for both source tables, including `guid`, `qdbm`, `zdbm`, `gwlx`, `gs`, `cz`, `gg`, `qdms`, `zdms`, `qdndbg`, `zdndbg`, `gdbm`, `lbmc`, `dmbg`, `kj`, `js`, `jgcz`, `jgxz`, `geom`.

Create `docs/data/pipe-network-quality-rules.md` with the exact rules from the PRD and this task: SRID validation, invalid geometry, spec defaulting, height defaulting, endpoint unmatched, duplicate candidate, reverse duplicate candidate, and merge candidate.

- [ ] **Step 6: Verify**

Run:

```bash
pnpm --filter @new-qp3d/pipeline test
pnpm --filter @new-qp3d/pipeline typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/pipeline/src/normalize packages/pipeline/tests docs/data
git commit -m "feat: normalize pipe specs and heights"
```

## Task 5: Build Topology, Duplicate Audit, and Over-Segmentation Merge Planning

**Files:**
- Create: `packages/pipeline/src/topology/graph.ts`
- Create: `packages/pipeline/src/topology/fragmentAudit.ts`
- Create: `packages/pipeline/src/topology/mergeChains.ts`
- Create: `packages/pipeline/tests/fragmentAudit.test.ts`
- Create: `packages/pipeline/tests/mergeChains.test.ts`

**Interfaces:**
- Consumes: normalized pipe rows with business IDs, endpoints, attributes, and geometry coordinates.
- Produces:
  - `buildTopology(lines: NormalizedLine[]): TopologyGraph`
  - `auditFragments(lines: NormalizedLine[]): FragmentAuditReport`
  - `planMergeChains(lines: NormalizedLine[], graph: TopologyGraph): MergeChain[]`
  - `MergeChain.originalGuids: string[]`
  - `MergeChain.displayId: string`

- [ ] **Step 1: Write failing fragment audit tests**

Create `packages/pipeline/tests/fragmentAudit.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { auditFragments } from '../src/topology/fragmentAudit'

describe('auditFragments', () => {
  it('counts exact duplicate geometries, reverse duplicates, endpoint duplicates, and short segments', () => {
    const report = auditFragments([
      line('a', 'N1', 'N2', [[0, 0], [1, 0]], '雨水管', '市政', '砼', '300'),
      line('b', 'N3', 'N4', [[0, 0], [1, 0]], '雨水管', '市政', '砼', '300'),
      line('c', 'N5', 'N6', [[1, 0], [0, 0]], '雨水管', '市政', '砼', '300'),
      line('d', 'N1', 'N2', [[0, 1], [1, 1]], '雨水管', '市政', '砼', '300'),
      line('e', 'N7', 'N8', [[0, 2], [20, 2]], '污水管', '小区', 'PE', '200'),
    ])

    expect(report.total).toBe(5)
    expect(report.exactDuplicateGeometryRows).toBe(2)
    expect(report.reverseDuplicateGeometryRows).toBe(3)
    expect(report.directedEndpointDuplicateRows).toBe(2)
    expect(report.shorterThan10m).toBe(4)
  })
})

function line(guid: string, qdbm: string, zdbm: string, coordinates: Array<[number, number]>, gwlx: string, gs: string, cz: string, gg: string) {
  return { guid, qdbm, zdbm, coordinates, gwlx, gs, cz, gg }
}
```

- [ ] **Step 2: Write failing merge-chain tests**

Create `packages/pipeline/tests/mergeChains.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildTopology } from '../src/topology/graph'
import { planMergeChains } from '../src/topology/mergeChains'

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
})

function line(guid: string, qdbm: string, zdbm: string, coordinates: Array<[number, number]>, gwlx: string, gs: string, cz: string, gg: string) {
  return { guid, qdbm, zdbm, coordinates, gwlx, gs, cz, gg }
}
```

- [ ] **Step 3: Run failing tests**

Run:

```bash
pnpm test -- packages/pipeline/tests/fragmentAudit.test.ts packages/pipeline/tests/mergeChains.test.ts
```

Expected: FAIL because topology modules do not exist.

- [ ] **Step 4: Implement topology graph**

Create `packages/pipeline/src/topology/graph.ts` with these exported shapes:

```ts
export interface NormalizedLine {
  guid: string
  qdbm: string | null
  zdbm: string | null
  coordinates: Array<[number, number]>
  gwlx: string | null
  gs: string | null
  cz: string | null
  gg: string | null
}

export interface TopologyGraph {
  degreeByNode: Map<string, number>
  lineIdsByNode: Map<string, string[]>
}

export function buildTopology(lines: NormalizedLine[]): TopologyGraph {
  const lineIdsByNode = new Map<string, string[]>()

  for (const line of lines) {
    for (const node of [line.qdbm, line.zdbm]) {
      if (!node) continue
      const ids = lineIdsByNode.get(node) ?? []
      ids.push(line.guid)
      lineIdsByNode.set(node, ids)
    }
  }

  const degreeByNode = new Map<string, number>()
  for (const [node, ids] of lineIdsByNode) {
    degreeByNode.set(node, ids.length)
  }

  return { degreeByNode, lineIdsByNode }
}
```

- [ ] **Step 5: Implement audit and merge planning**

Create `fragmentAudit.ts` to compute length buckets, endpoint duplicates, exact geometry duplicates, and reverse geometry duplicates using rounded coordinate keys. Create `mergeChains.ts` to walk degree-2 chains only when `gwlx`, `gs`, `cz`, and `gg` match exactly.

The merge planner must keep `originalGuids`, use a stable `displayId` of `pipe-display-${guid1}-${guid2}`, and never drop source IDs.

- [ ] **Step 6: Verify**

Run:

```bash
pnpm --filter @new-qp3d/pipeline test
pnpm --filter @new-qp3d/pipeline typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/pipeline/src/topology packages/pipeline/tests/*Audit* packages/pipeline/tests/mergeChains.test.ts
git commit -m "feat: audit and merge fragmented pipe segments"
```

## Task 6: Generate Pipe and Node Meshes

**Files:**
- Create: `packages/pipeline/src/geometry/pipeMesh.ts`
- Create: `packages/pipeline/src/geometry/nodeMesh.ts`
- Create: `packages/pipeline/tests/pipeMesh.test.ts`

**Interfaces:**
- Consumes: `MergeChain`, `PipeSpec`, `HeightResult`.
- Produces:
  - `createPipeMesh(input: PipeMeshInput): Mesh`
  - `createNodeMesh(input: NodeMeshInput): Mesh`
  - `Mesh.positions: Float32Array`
  - `Mesh.indices: Uint32Array`
  - `Mesh.featureIds: Uint32Array`

- [ ] **Step 1: Write failing mesh tests**

Create `packages/pipeline/tests/pipeMesh.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createPipeMesh } from '../src/geometry/pipeMesh'

describe('createPipeMesh', () => {
  it('creates a round pipe mesh with feature ids', () => {
    const mesh = createPipeMesh({
      featureId: 7,
      coordinates: [[0, 0, 10], [10, 0, 10]],
      spec: { kind: 'round', diameterMm: 1000, source: '1000', quality: 'parsed' },
      radialSegments: 8,
    })

    expect(mesh.positions.length).toBeGreaterThan(0)
    expect(mesh.indices.length).toBeGreaterThan(0)
    expect(new Set(mesh.featureIds)).toEqual(new Set([7]))
  })

  it('creates a rectangular box pipe mesh', () => {
    const mesh = createPipeMesh({
      featureId: 9,
      coordinates: [[0, 0, 10], [10, 0, 11]],
      spec: { kind: 'box', widthMm: 700, heightMm: 450, source: '700X450', quality: 'parsed' },
      radialSegments: 4,
    })

    expect(mesh.positions.length).toBeGreaterThan(0)
    expect(mesh.indices.length).toBeGreaterThan(0)
    expect(new Set(mesh.featureIds)).toEqual(new Set([9]))
  })
})
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
pnpm test -- packages/pipeline/tests/pipeMesh.test.ts
```

Expected: FAIL because `createPipeMesh` does not exist.

- [ ] **Step 3: Implement mesh interfaces**

Create `packages/pipeline/src/geometry/pipeMesh.ts`:

```ts
import type { PipeSpec } from '@new-qp3d/shared/src/domain'

export interface Mesh {
  positions: Float32Array
  indices: Uint32Array
  featureIds: Uint32Array
}

export interface PipeMeshInput {
  featureId: number
  coordinates: Array<[number, number, number]>
  spec: PipeSpec
  radialSegments: number
}

export function createPipeMesh(input: PipeMeshInput): Mesh {
  if (input.coordinates.length < 2) {
    return { positions: new Float32Array(), indices: new Uint32Array(), featureIds: new Uint32Array() }
  }

  const vertexCount = input.coordinates.length * Math.max(4, input.radialSegments)
  const positions = new Float32Array(vertexCount * 3)
  const featureIds = new Uint32Array(vertexCount)
  featureIds.fill(input.featureId)

  const indices: number[] = []
  for (let i = 0; i < input.coordinates.length - 1; i++) {
    const ring = Math.max(4, input.radialSegments)
    for (let j = 0; j < ring; j++) {
      const a = i * ring + j
      const b = i * ring + ((j + 1) % ring)
      const c = (i + 1) * ring + j
      const d = (i + 1) * ring + ((j + 1) % ring)
      indices.push(a, c, b, b, c, d)
    }
  }

  return { positions, indices: new Uint32Array(indices), featureIds }
}
```

This minimal implementation makes tests pass and establishes interfaces. Replace zeroed positions in the next step with real ring generation.

- [ ] **Step 4: Replace zeroed positions with real local-coordinate rings**

Update `createPipeMesh` so each coordinate produces a circular ring for round specs and a rectangle for box specs. Use a local tile origin before converting to GLB positions to avoid precision issues. For this task, coordinates are already local meters.

- [ ] **Step 5: Add generated node mesh**

Create `packages/pipeline/src/geometry/nodeMesh.ts`:

```ts
import type { Mesh } from './pipeMesh'

export interface NodeMeshInput {
  featureId: number
  position: [number, number, number]
  symbol: 'well' | 'rect-grate' | 'inlet' | 'reserved-outlet' | 'unknown-point'
  sizeMeters: number
}

export function createNodeMesh(input: NodeMeshInput): Mesh {
  const half = input.sizeMeters / 2
  const [x, y, z] = input.position
  const positions = new Float32Array([
    x - half, y - half, z,
    x + half, y - half, z,
    x + half, y + half, z,
    x - half, y + half, z,
  ])
  return {
    positions,
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    featureIds: new Uint32Array([input.featureId, input.featureId, input.featureId, input.featureId]),
  }
}
```

- [ ] **Step 6: Verify**

Run:

```bash
pnpm --filter @new-qp3d/pipeline test
pnpm --filter @new-qp3d/pipeline typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/pipeline/src/geometry packages/pipeline/tests/pipeMesh.test.ts
git commit -m "feat: generate pipe and node meshes"
```

## Task 7: Write 3D Tiles and Sample Tileset

**Files:**
- Create: `packages/pipeline/src/tiles/tileGrid.ts`
- Create: `packages/pipeline/src/tiles/glbWriter.ts`
- Create: `packages/pipeline/src/tiles/tilesetWriter.ts`
- Create: `packages/pipeline/tests/tileGrid.test.ts`
- Create: `packages/pipeline/tests/tilesetWriter.test.ts`
- Create: `fixtures/pipeline/sample-lines.json`
- Create: `fixtures/pipeline/sample-points.json`

**Interfaces:**
- Consumes: `Mesh`, display features, quality flags.
- Produces:
  - `createTileGrid(bounds: Bounds, options: TileGridOptions): TileGrid`
  - `writeGlb(mesh: Mesh, metadata: FeatureMetadata[]): Uint8Array`
  - `writeTileset(input: TilesetInput): TilesetJson`

- [ ] **Step 1: Write failing tile-grid tests**

Create `packages/pipeline/tests/tileGrid.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createTileGrid } from '../src/tiles/tileGrid'

describe('createTileGrid', () => {
  it('splits bounds into deterministic child tiles', () => {
    const grid = createTileGrid(
      { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      { maxFeaturesPerTile: 2, maxDepth: 2 },
    )

    expect(grid.root.bounds).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 100 })
    expect(grid.root.children).toHaveLength(4)
    expect(grid.root.children[0].bounds).toEqual({ minX: 0, minY: 0, maxX: 50, maxY: 50 })
  })
})
```

- [ ] **Step 2: Write failing tileset tests**

Create `packages/pipeline/tests/tilesetWriter.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { writeTileset } from '../src/tiles/tilesetWriter'

describe('writeTileset', () => {
  it('creates a Cesium-loadable tileset root with geometric error and content uri', () => {
    const tileset = writeTileset({
      assetVersion: '1.1',
      geometricError: 500,
      rootUri: 'tiles/root.glb',
      boundingVolume: { box: [0, 0, 0, 50, 0, 0, 0, 50, 0, 0, 0, 20] },
    })

    expect(tileset.asset.version).toBe('1.1')
    expect(tileset.root.geometricError).toBe(500)
    expect(tileset.root.content?.uri).toBe('tiles/root.glb')
  })
})
```

- [ ] **Step 3: Run failing tests**

Run:

```bash
pnpm test -- packages/pipeline/tests/tileGrid.test.ts packages/pipeline/tests/tilesetWriter.test.ts
```

Expected: FAIL because tile modules do not exist.

- [ ] **Step 4: Implement tile grid and tileset JSON**

Create `packages/pipeline/src/tiles/tileGrid.ts` and `tilesetWriter.ts` with deterministic outputs. Use 3D Tiles `asset.version` of `1.1`, root `boundingVolume.box`, `geometricError`, `refine: "ADD"` for overview-to-detail behavior, and GLB `content.uri`.

- [ ] **Step 5: Implement GLB writer**

Install:

```bash
pnpm --filter @new-qp3d/pipeline add @gltf-transform/core @gltf-transform/extensions
```

Create `packages/pipeline/src/tiles/glbWriter.ts` to convert `Mesh` into GLB. Include feature ID data in a way Cesium 1.117 can be tested against. If structural metadata support is not stable enough in Cesium 1.117 for the first MVP, store stable IDs in a sidecar JSON named next to the GLB and keep GLB feature IDs for internal picking experiments.

- [ ] **Step 6: Add sample fixtures**

Create `fixtures/pipeline/sample-lines.json` with at least:

```json
[
  {
    "guid": "sample-rain-1",
    "qdbm": "N1",
    "zdbm": "N2",
    "gwlx": "雨水管",
    "gs": "市政",
    "cz": "砼",
    "gg": "300",
    "coordinates": [[0, 0], [20, 0]]
  },
  {
    "guid": "sample-sewage-1",
    "qdbm": "N3",
    "zdbm": "N4",
    "gwlx": "污水管",
    "gs": "小区",
    "cz": "PE",
    "gg": "200X200",
    "coordinates": [[0, 10], [20, 10]]
  }
]
```

Create `fixtures/pipeline/sample-points.json` with rain grate, sewage grate, inlet, and well examples.

- [ ] **Step 7: Verify**

Run:

```bash
pnpm --filter @new-qp3d/pipeline test
pnpm --filter @new-qp3d/pipeline typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/pipeline/src/tiles packages/pipeline/tests/*tile* fixtures/pipeline pnpm-lock.yaml
git commit -m "feat: write pipe network 3d tiles"
```

## Task 8: Build Pipeline CLI, Quality Report, and Versioned Publishing

**Files:**
- Create: `packages/pipeline/src/cli.ts`
- Create: `packages/pipeline/src/quality/report.ts`
- Create: `packages/pipeline/src/publish/versionStore.ts`
- Create: `fixtures/pipeline/sample-quality-report.json`
- Create: `scripts/smoke-build-sample.mjs`
- Create: `docs/operations/build-and-publish-runbook.md`

**Interfaces:**
- Consumes: datasource, normalization, topology, geometry, tile writers.
- Produces:
  - CLI command `pipe-network build --source sample --output data/tiles`
  - `createQualityReport(input: QualityReportInput): QualityReport`
  - `publishVersion(input: PublishVersionInput): Promise<PublishedVersion>`
  - output layout `data/tiles/<version>/tileset.json`, `data/tiles/latest.json`, `data/tiles/<version>/quality-report.json`

- [ ] **Step 1: Write failing quality report tests**

Create `packages/pipeline/tests/qualityReport.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createQualityReport } from '../src/quality/report'

describe('createQualityReport', () => {
  it('summarizes counts and quality flags for publish validation', () => {
    const report = createQualityReport({
      versionId: 'network-20260621-1500',
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
    })

    expect(report.flagCounts).toEqual({
      'spec-defaulted': 1,
      'height-defaulted': 1,
      'endpoint-unmatched': 2,
    })
    expect(report.totalLines).toBe(5)
    expect(report.generatedLineFeatures).toBe(4)
  })
})
```

- [ ] **Step 2: Run failing test**

Run:

```bash
pnpm test -- packages/pipeline/tests/qualityReport.test.ts
```

Expected: FAIL because `createQualityReport` does not exist.

- [ ] **Step 3: Implement quality report and publish store**

Create `quality/report.ts` with explicit flag counting, group counts, input totals, generated totals, and created timestamp.

Create `publish/versionStore.ts` that writes into a staging directory first, validates required files, then writes `latest.json`:

```json
{
  "version": "network-20260621-1500",
  "tilesetUrl": "/tiles/network-20260621-1500/tileset.json",
  "qualityReportUrl": "/tiles/network-20260621-1500/quality-report.json"
}
```

- [ ] **Step 4: Implement CLI**

Install:

```bash
pnpm --filter @new-qp3d/pipeline add commander
```

Create `packages/pipeline/src/cli.ts` with commands:

```bash
pipe-network inspect-db
pipe-network build --source postgis --output data/tiles
pipe-network build --source sample --output data/tiles
pipe-network validate --version network-YYYYMMDD-HHmm --output data/tiles
```

The `sample` source must read `fixtures/pipeline/sample-lines.json` and `fixtures/pipeline/sample-points.json` and generate a minimal tileset for frontend tests.

- [ ] **Step 5: Add smoke script**

Create `scripts/smoke-build-sample.mjs`:

```js
import { execa } from 'execa'

await execa('pnpm', ['--filter', '@new-qp3d/pipeline', 'build'], { stdio: 'inherit' })
await execa('node', ['packages/pipeline/dist/cli.js', 'build', '--source', 'sample', '--output', 'data/tiles'], { stdio: 'inherit' })
```

Install `execa` at root or replace this with `node:child_process` if avoiding another dependency.

- [ ] **Step 6: Write operations runbook**

Create `docs/operations/build-and-publish-runbook.md` with these exact sections:

```markdown
# Build and Publish Runbook

## Backend Config File

Pipeline and API read `config/backend.env` by default. Prepare that file with the real server-side credentials before startup; `config/backend.example.env` is only a field template.

## Build Commands

```bash
pnpm --filter @new-qp3d/pipeline build
node packages/pipeline/dist/cli.js inspect-db
node packages/pipeline/dist/cli.js build --source postgis --output data/tiles
```

## Validation Rules

- `tileset.json` exists.
- `quality-report.json` exists.
- `latest.json` points to a version directory that exists.
- New failed builds do not modify the previous `latest.json`.
```

- [ ] **Step 7: Verify**

Run:

```bash
pnpm --filter @new-qp3d/pipeline test
pnpm --filter @new-qp3d/pipeline build
node scripts/smoke-build-sample.mjs
```

Expected: tests pass; `data/tiles/latest.json` points to a sample build version.

- [ ] **Step 8: Commit**

```bash
git add packages/pipeline scripts/smoke-build-sample.mjs docs/operations fixtures/pipeline pnpm-lock.yaml
git commit -m "feat: add versioned tile build pipeline"
```

## Task 9: Implement API Service for Search, Details, Versions, and Quality

**Files:**
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/src/config/env.ts`
- Create: `apps/api/src/db/pool.ts`
- Create: `apps/api/src/routes/search.ts`
- Create: `apps/api/src/routes/details.ts`
- Create: `apps/api/src/routes/versions.ts`
- Create: `apps/api/src/routes/quality.ts`
- Create: `apps/api/src/server.ts`
- Create: `apps/api/tests/search.test.ts`
- Create: `apps/api/tests/details.test.ts`
- Create: `apps/api/tests/versions.test.ts`

**Interfaces:**
- Consumes: PostGIS source tables, `data/tiles/latest.json`, `quality-report.json`.
- Produces:
  - `GET /api/search?q=<code>`
  - `GET /api/lines/:guid`
  - `GET /api/points/:gdbm`
  - `GET /api/versions/latest`
  - `GET /api/quality/latest`

- [ ] **Step 1: Write failing route tests**

Create `apps/api/tests/search.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createServer } from '../src/server'

describe('search route', () => {
  it('returns typed search results for guid, gdbm, qdbm, and zdbm', async () => {
    const app = await createServer({
      search: async query => [
        { type: 'line', id: 'line-1', label: query, longitude: 120.1, latitude: 31.1 },
        { type: 'point', id: 'point-1', label: query, longitude: 120.2, latitude: 31.2 },
      ],
      getLine: async () => null,
      getPoint: async () => null,
      getLatestVersion: async () => null,
      getLatestQuality: async () => null,
    })

    const response = await app.inject({ method: 'GET', url: '/api/search?q=LSYS' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      results: [
        { type: 'line', id: 'line-1', label: 'LSYS', longitude: 120.1, latitude: 31.1 },
        { type: 'point', id: 'point-1', label: 'LSYS', longitude: 120.2, latitude: 31.2 },
      ],
    })
  })
})
```

- [ ] **Step 2: Run failing test**

Run:

```bash
pnpm test -- apps/api/tests/search.test.ts
```

Expected: FAIL because `createServer` does not exist.

- [ ] **Step 3: Implement Fastify server with injectable repository**

Install:

```bash
pnpm --filter @new-qp3d/api add fastify @fastify/cors pg
pnpm --filter @new-qp3d/api add -D @types/pg
```

Create `apps/api/src/server.ts`:

```ts
import Fastify from 'fastify'
import cors from '@fastify/cors'

export interface SearchResult {
  type: 'line' | 'point'
  id: string
  label: string
  longitude: number
  latitude: number
}

export interface ApiRepository {
  search(query: string): Promise<SearchResult[]>
  getLine(guid: string): Promise<unknown>
  getPoint(gdbm: string): Promise<unknown>
  getLatestVersion(): Promise<unknown>
  getLatestQuality(): Promise<unknown>
}

export async function createServer(repository: ApiRepository) {
  const app = Fastify({ logger: true })
  await app.register(cors, { origin: true })

  app.get('/api/search', async request => {
    const query = String((request.query as { q?: string }).q ?? '').trim()
    if (!query) return { results: [] }
    return { results: await repository.search(query) }
  })

  app.get('/api/lines/:guid', async request => {
    const { guid } = request.params as { guid: string }
    return repository.getLine(guid)
  })

  app.get('/api/points/:gdbm', async request => {
    const { gdbm } = request.params as { gdbm: string }
    return repository.getPoint(gdbm)
  })

  app.get('/api/versions/latest', async () => repository.getLatestVersion())
  app.get('/api/quality/latest', async () => repository.getLatestQuality())

  return app
}
```

- [ ] **Step 4: Add PostGIS repository**

Implement `apps/api/src/db/pool.ts` and route repositories that:

- Search line `guid`, `qdbm`, `zdbm`.
- Search point `gdbm`.
- Return centroids transformed to EPSG:4326 for frontend flight.
- Read latest version and quality report from `QP3D_OUTPUT_ROOT`.

- [ ] **Step 5: Verify**

Run:

```bash
pnpm --filter @new-qp3d/api test
pnpm --filter @new-qp3d/api typecheck
pnpm --filter @new-qp3d/api build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api pnpm-lock.yaml
git commit -m "feat: add pipe network api service"
```

## Task 10: Build Cesium Web Client Shell and Layer Loading

**Files:**
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.ts`
- Create: `apps/web/src/App.ts`
- Create: `apps/web/src/cesium/createViewer.ts`
- Create: `apps/web/src/cesium/layers.ts`
- Create: `apps/web/src/cesium/styles.ts`
- Create: `apps/web/src/state/layerState.ts`
- Create: `apps/web/tests/layerState.test.ts`

**Interfaces:**
- Consumes: `GET /api/versions/latest`, static tileset URLs.
- Produces:
  - `createPipeNetworkViewer(container: HTMLElement): Cesium.Viewer`
  - `loadPipeNetworkLayers(viewer: Cesium.Viewer, manifest: VersionManifest): Promise<LayerHandles>`
  - `createLayerState(): LayerState`

- [ ] **Step 1: Write failing layer state tests**

Create `apps/web/tests/layerState.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createLayerState } from '../src/state/layerState'

describe('layer state', () => {
  it('tracks pipe type and owner filters without recreating tilesets', () => {
    const state = createLayerState()
    state.setPipeTypeVisible('雨水管', false)
    state.setOwnerVisible('小区', false)

    expect(state.snapshot()).toEqual({
      pipeTypes: { 雨水管: false, 污水管: true },
      owners: { 市政: true, 小区: false, 农村: true },
      quality: { normal: true, abnormal: true },
      underground: { enabled: false, terrainAlpha: 1, verticalExaggeration: 1 },
    })
  })
})
```

- [ ] **Step 2: Run failing test**

Run:

```bash
pnpm test -- apps/web/tests/layerState.test.ts
```

Expected: FAIL because `createLayerState` does not exist.

- [ ] **Step 3: Install frontend dependencies**

Run:

```bash
pnpm --filter @new-qp3d/web add @cesium/engine@1.117.0 cesium@1.117.0
pnpm --filter @new-qp3d/web add -D vite
```

- [ ] **Step 4: Implement web shell and layer state**

Create `apps/web/src/state/layerState.ts` with explicit setters and immutable `snapshot()` output matching the test.

Create `apps/web/src/cesium/createViewer.ts`:

```ts
import { Viewer } from 'cesium'

export function createPipeNetworkViewer(container: HTMLElement): Viewer {
  return new Viewer(container, {
    animation: false,
    timeline: false,
    baseLayerPicker: true,
    geocoder: false,
    homeButton: true,
    sceneModePicker: true,
    navigationHelpButton: false,
    infoBox: false,
    selectionIndicator: false,
  })
}
```

Create `apps/web/src/cesium/layers.ts` to load the main tileset with `Cesium3DTileset.fromUrl(manifest.tilesetUrl)` and never create per-line Entity objects.

- [ ] **Step 5: Add minimal app UI**

Create `apps/web/src/App.ts` as a plain TypeScript UI shell with:

- full-window Cesium container,
- left layer toolbar,
- bottom status strip showing current tileset version,
- right property panel container hidden until picking is implemented.

Use compact operational UI. Do not create a marketing landing page.

- [ ] **Step 6: Verify**

Run:

```bash
pnpm --filter @new-qp3d/web test
pnpm --filter @new-qp3d/web typecheck
pnpm --filter @new-qp3d/web build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat: add cesium pipe network viewer shell"
```

## Task 11: Add Picking, Search, Filters, and Property Panels

**Files:**
- Create: `apps/web/src/cesium/picking.ts`
- Create: `apps/web/src/services/apiClient.ts`
- Create: `apps/web/src/ui/panels.ts`
- Create: `apps/web/tests/apiClient.test.ts`
- Modify: `apps/web/src/App.ts`
- Modify: `apps/web/src/cesium/layers.ts`

**Interfaces:**
- Consumes: API endpoints from Task 9 and tileset layer handles from Task 10.
- Produces:
  - `createApiClient(baseUrl: string): ApiClient`
  - `installPicking(viewer, apiClient, callbacks): () => void`
  - `renderPropertyPanel(target): HTMLElement`
  - Search result flight and highlight behavior.

- [ ] **Step 1: Write failing API client tests**

Create `apps/web/tests/apiClient.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { createApiClient } from '../src/services/apiClient'

describe('api client', () => {
  it('searches by code and returns typed results', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      results: [{ type: 'line', id: 'guid-1', label: 'guid-1', longitude: 120, latitude: 31 }],
    })))

    const api = createApiClient('/api', fetcher)
    await expect(api.search('guid-1')).resolves.toEqual([
      { type: 'line', id: 'guid-1', label: 'guid-1', longitude: 120, latitude: 31 },
    ])
    expect(fetcher).toHaveBeenCalledWith('/api/search?q=guid-1')
  })
})
```

- [ ] **Step 2: Run failing test**

Run:

```bash
pnpm test -- apps/web/tests/apiClient.test.ts
```

Expected: FAIL because `createApiClient` does not exist.

- [ ] **Step 3: Implement API client**

Create `apps/web/src/services/apiClient.ts` with `search`, `getLine`, `getPoint`, `getLatestVersion`, and `getLatestQuality`. Inject `fetch` for testing.

- [ ] **Step 4: Implement picking**

Create `apps/web/src/cesium/picking.ts`:

- Use `viewer.scene.pick(movement.position)`.
- Extract feature ID or metadata if available.
- Fallback to sidecar metadata lookup by tile feature ID.
- Call `apiClient.getLine(id)` or `apiClient.getPoint(id)`.
- Maintain a single highlighted feature at a time.

- [ ] **Step 5: Implement filters without recreating tilesets**

Update `layers.ts` so layer filters use Cesium 3D Tiles styling or tileset visibility. Start with owner/type visibility at the tileset or style level. Do not remove and recreate the tileset on every checkbox toggle.

- [ ] **Step 6: Implement property and quality panels**

Create `apps/web/src/ui/panels.ts` with render functions for:

- line properties: `guid`, `qdbm`, `zdbm`, `gwlx`, `gs`, `cz`, `gg`, `gdcd`, `qdms`, `zdms`, `qdndbg`, `zdndbg`, quality flags,
- point properties: `gdbm`, `lbmc`, `dmbg`, `kj`, `js`, `gg`, `jgcz`, `jgxz`, `jgcc`, quality flags,
- quality summary from `/api/quality/latest`.

- [ ] **Step 7: Verify**

Run:

```bash
pnpm --filter @new-qp3d/web test
pnpm --filter @new-qp3d/web typecheck
pnpm --filter @new-qp3d/web build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src apps/web/tests
git commit -m "feat: add pipe network interaction tools"
```

## Task 12: Add Visual, Smoke, and Performance Verification

**Files:**
- Create: `apps/web/e2e/viewer.spec.ts`
- Create: `docs/architecture/pipe-network-tiling-architecture.md`
- Create: `docs/assets/pipe-network-model-asset-list.md`
- Create: `docs/operations/performance-acceptance-report.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: sample build output, API service, Vite web app.
- Produces:
  - automated Playwright smoke test for Cesium nonblank rendering,
  - architecture documentation,
  - model asset list,
  - performance acceptance report template.

- [ ] **Step 1: Write Playwright e2e test**

Create `apps/web/e2e/viewer.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

test('loads a nonblank Cesium viewer with pipe network controls', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('[data-testid="cesium-container"]')).toBeVisible()
  await expect(page.locator('[data-testid="layer-tree"]')).toBeVisible()

  const canvas = page.locator('canvas').first()
  await expect(canvas).toBeVisible()

  const box = await canvas.boundingBox()
  expect(box?.width).toBeGreaterThan(300)
  expect(box?.height).toBeGreaterThan(300)

  const screenshot = await canvas.screenshot()
  expect(screenshot.length).toBeGreaterThan(10_000)
})
```

- [ ] **Step 2: Run e2e before full wiring**

Run:

```bash
pnpm e2e
```

Expected: FAIL until the dev server and sample tiles are wired in the next step.

- [ ] **Step 3: Add local smoke command**

Modify root `package.json` scripts:

```json
{
  "scripts": {
    "smoke:sample": "node scripts/smoke-build-sample.mjs && pnpm --filter @new-qp3d/api build && pnpm --filter @new-qp3d/web build",
    "dev:web": "pnpm --filter @new-qp3d/web dev",
    "dev:api": "pnpm --filter @new-qp3d/api dev"
  }
}
```

- [ ] **Step 4: Write architecture doc**

Create `docs/architecture/pipe-network-tiling-architecture.md` with:

- data flow diagram from PostGIS to Cesium,
- why 3D Tiles is the main path,
- why full GeoJSON/Entity loading is rejected,
- how over-segmented line chains are merged for display while original GUIDs are preserved,
- how API lookup returns full attributes,
- how versioned publishing protects the last stable build.

- [ ] **Step 5: Write model asset list**

Create `docs/assets/pipe-network-model-asset-list.md` with a table:

| Category | Strategy | Required in Phase 1 | Asset |
| --- | --- | --- | --- |
| 雨篦 | generated-low-poly | yes | no external model |
| 污篦 | generated-low-poly | yes | no external model |
| 雨水进水口 | generated-low-poly | yes | no external model |
| 污水进水口 | generated-low-poly | yes | no external model |
| 雨水井 | generated-parametric | yes | no external model |
| 污水井 | generated-parametric | yes | no external model |
| 消防栓 | model | no | `assets/models/hydrant.glb` |
| 闸门 | model | no | `assets/models/gate.glb` |
| 泵站 | model | no | `assets/models/pump-station.glb` |
| 雨水排放口 | model | no | `assets/models/outfall-rain.glb` |
| 污水排放口 | model | no | `assets/models/outfall-sewage.glb` |

- [ ] **Step 6: Write performance acceptance report template**

Create `docs/operations/performance-acceptance-report.md` with metrics from the PRD:

- 1,000,000 line segments and 50,000 point facilities target,
- first interactive view within 5 seconds on normal network,
- 30 FPS normal view and no lower than 20 FPS in dense areas,
- 1-5 MB normal compressed tile size,
- pick response within 300 ms for loaded objects,
- search response within 1 second,
- 30-minute browsing memory stability.

- [ ] **Step 7: Verify full workspace**

Run:

```bash
pnpm typecheck
pnpm test
pnpm smoke:sample
pnpm e2e
```

Expected: PASS. If Playwright fails because Cesium renders blank, inspect browser console errors and verify Cesium asset base URL, sample tileset URL, and WebGL availability before changing rendering code.

- [ ] **Step 8: Commit**

```bash
git add apps/web/e2e docs/architecture docs/assets docs/operations package.json
git commit -m "test: add pipe network visual acceptance checks"
```

## Final Acceptance Checklist

- [ ] `pnpm typecheck` passes across all packages.
- [ ] `pnpm test` passes across shared, pipeline, API, and web tests.
- [ ] `node scripts/smoke-build-sample.mjs` creates `data/tiles/latest.json`.
- [ ] API returns `/api/versions/latest`, `/api/quality/latest`, `/api/search?q=LSYS`, `/api/lines/:guid`, and `/api/points/:gdbm`.
- [ ] Web app loads CesiumJS 1.117 and the sample tileset.
- [ ] Web app does not create million-scale Entity or full GeoJSON rendering path.
- [ ] Pipeline reports SRID distribution and flags non-3857 rows.
- [ ] Pipeline reports exact duplicate, reverse duplicate, endpoint duplicate, short segment, and merge-candidate counts.
- [ ] Display merge chains preserve all source GUIDs in `originalGuids`.
- [ ] Spec parser covers pure numeric, `DN` numeric, `宽X高`, `×`, empty, `0`, and nonstandard values.
- [ ] Height parser covers inner-bottom elevation, depth-estimated, and defaulted paths.
- [ ] Quality report is written for every successful build.
- [ ] Failed build does not replace the previous `latest.json`.
- [ ] Playwright confirms a nonblank Cesium canvas at desktop and mobile viewports.

## Execution Notes

- Build the sample pipeline before connecting the full PostGIS dataset; it makes frontend and API work independently testable.
- Keep generated `data/tiles/**` out of Git unless a tiny fixture tileset is intentionally added for tests.
- For the real 95.2 万 row line table, run the fragment audit before mesh generation. If merge candidates are high, report the before/after display feature count in `quality-report.json`.
- For dense areas, tune tile splitting before increasing browser-side cache limits.
- When Cesium 1.117 feature metadata support does not expose stable IDs reliably for picking, use sidecar metadata as the first production path and keep feature metadata as an optimization track.
