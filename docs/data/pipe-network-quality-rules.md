# Pipe Network Quality Rules

These rules describe the quality flags emitted by the pipeline when validating source pipe data.

## Spatial validation

- `srid-mismatch`: the source geometry SRID differs from the expected runtime SRID.
- `invalid-geometry`: the geometry is missing, malformed, or cannot be used to build display features.

## Specification and height normalization

- `spec-defaulted`: `gg` could not be parsed into a valid pipe specification, so the pipeline uses a default round specification.
- `height-defaulted`: both inner-bottom elevation and burial-depth fields are missing, so the pipeline falls back to the configured default depth.

## Topology and matching

- `endpoint-unmatched`: at least one endpoint code could not be matched to a point facility record.
- `endpoint-duplicate`: the same endpoint pair appears on more than one line in the same direction and must be counted in the fragment audit.
- `duplicate-candidate`: two lines share the same directed geometry and must be counted in the fragment audit.
- `reverse-duplicate-candidate`: two lines share the same geometry in opposite directions and must be counted in the fragment audit.
- `short-segment`: a line segment falls below the display-length threshold and must be reported even when it is otherwise valid.
- `merge-candidate`: adjacent line fragments share the same material, specification, pipe type, and branch context and can be merged for display.

## Operational notes

- Quality flags are informational and do not stop the full build by themselves.
- A single pipe segment may accumulate more than one quality flag.
- The build should continue with normalized defaults where possible so downstream visualization can still render the network.
- The pipeline should publish fragment-audit counts for exact duplicate, reverse duplicate, endpoint duplicate, short segment, and merge-candidate cases in the quality report.
