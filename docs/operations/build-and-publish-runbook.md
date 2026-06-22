# Build and Publish Runbook

## Environment Variables

- `QP3D_DATABASE_URL`
- `QP3D_POINT_TABLE`
- `QP3D_LINE_TABLE`
- `QP3D_EXPECTED_SRID`
- `QP3D_OUTPUT_ROOT`

## Build Commands

```bash
pnpm --filter @new-qp3d/pipeline build
node packages/pipeline/dist/cli.js inspect-db
node packages/pipeline/dist/cli.js build --source postgis --output data/tiles
```

For local smoke verification, build from bundled fixtures:

```bash
node packages/pipeline/dist/cli.js build --source sample --output data/tiles
node packages/pipeline/dist/cli.js validate --version network-YYYYMMDD-HHmm --output data/tiles
```

## Validation Rules

- `tileset.json` exists.
- `quality-report.json` exists.
- `latest.json` points to a version directory that exists.
- New failed builds do not modify the previous `latest.json`.
