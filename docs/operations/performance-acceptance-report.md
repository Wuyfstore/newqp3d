# Performance Acceptance Report

## Target Dataset

- 1,000,000 line segments.
- 50,000 point facilities.

## Acceptance Metrics

| Metric | Target | Result | Notes |
| --- | --- | --- | --- |
| First interactive view | Within 5 seconds on normal network |  |  |
| Normal view frame rate | Around 30 FPS |  |  |
| Dense area frame rate | Not lower than 20 FPS |  |  |
| Normal compressed tile size | 1-5 MB |  |  |
| Pick response for loaded objects | Within 300 ms |  |  |
| Search response | Within 1 second |  |  |
| 30-minute browsing memory stability | No unbounded growth |  |  |

## Test Scenarios

- Full-region overview from a cold browser session.
- Dense-area zoom and pan.
- Rainwater/sewage layer toggles.
- Owner and quality filters.
- Search by `guid`, `qdbm`, `zdbm`, and `gdbm`.
- Click picking and property panel display.
- Continuous 30-minute browsing session with repeated zoom and pan.
