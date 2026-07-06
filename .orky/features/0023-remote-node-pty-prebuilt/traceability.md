# Traceability — 0023-remote-node-pty-prebuilt

Regenerated from `traceability.json` at doc-sync (phase 7), post-implementation and post-review.
All 26 REQ(s) map to their implementing TASK(s), the TEST(s) that cover them
(all verified present as markers in the actual test suite), and the file(s) touched.

| REQ | Tasks | Tests | Files |
|---|---|---|---|
| REQ-001 | TASK-001 | TEST-2301, TEST-2302, TEST-2303, TEST-2304, TEST-2365 | `scripts/stage-node-pty-prebuild.mjs` |
| REQ-002 | TASK-004, TASK-005 | TEST-2311, TEST-2312, TEST-2313, TEST-2315 | `.github/workflows/release.yml` |
| REQ-003 | TASK-002, TASK-005 | TEST-2305, TEST-2306, TEST-2307, TEST-2308, TEST-2309, TEST-2313, TEST-2365, TEST-2366, TEST-2367 | `scripts/verify-node-pty-prebuild.mjs`, `.github/workflows/release.yml` |
| REQ-004 | TASK-006 | TEST-2316 | `electron-builder.yml` |
| REQ-005 | TASK-003 | TEST-2320, TEST-2321 | `src/main/remote/agent-artifact.ts` |
| REQ-006 | TASK-001, TASK-004 | TEST-2302, TEST-2309, TEST-2312, TEST-2317 | `scripts/stage-node-pty-prebuild.mjs`, `.github/workflows/release.yml` |
| REQ-007 | TASK-004 | TEST-2314 | `.github/workflows/release.yml` |
| REQ-008 | TASK-007 | TEST-2322, TEST-2323, TEST-2334, TEST-2335, TEST-2336, TEST-2337, TEST-2369, TEST-2370 | `src/remote-client/prebuilt.ts` |
| REQ-009 | TASK-008 | TEST-2326, TEST-2327, TEST-2328, TEST-2329, TEST-2361, TEST-2378 | `src/remote-client/prebuilt.ts` |
| REQ-010 | TASK-009 | TEST-2324 | `src/remote-client/prebuilt.ts` |
| REQ-011 | TASK-010 | TEST-2325, TEST-2334 | `src/remote-client/prebuilt.ts` |
| REQ-012 | TASK-011 | TEST-2330, TEST-2344, TEST-2346, TEST-2373 | `src/remote-client/prebuilt.ts` |
| REQ-013 | TASK-012 | TEST-2345 | `src/remote-client/prebuilt.ts` |
| REQ-014 | TASK-013 | TEST-2331, TEST-2332, TEST-2338, TEST-2342, TEST-2343, TEST-2371, TEST-2380, TEST-2381, TEST-2382 | `src/remote-client/prebuilt.ts` |
| REQ-015 | TASK-014 | TEST-2334, TEST-2339, TEST-2340, TEST-2341, TEST-2347, TEST-2348, TEST-2360, TEST-2362, TEST-2363, TEST-2364, TEST-2371, TEST-2372, TEST-2379 | `src/remote-client/prebuilt.ts` |
| REQ-016 | TASK-016 | TEST-2343, TEST-2347, TEST-2348, TEST-2349, TEST-2364, TEST-2374, TEST-2375 | `src/remote-client/bootstrap.ts` |
| REQ-017 | TASK-016 | TEST-2350, TEST-2351, TEST-2352 | `src/remote-client/bootstrap.ts` |
| REQ-018 | TASK-015, TASK-017 | TEST-2353, TEST-2354, TEST-2355 | `src/remote-client/bootstrap.ts`, `src/main/services.ts` |
| REQ-019 | TASK-016 | TEST-2346, TEST-2356, TEST-2357, TEST-2358, TEST-2380, TEST-2381, TEST-2382 | `src/remote-client/bootstrap.ts` |
| REQ-020 | TASK-019 | TEST-2359, TEST-2379 | `tests/fixtures/`, `vite.agent.config.ts` |
| REQ-021 | TASK-016 | TEST-2333, TEST-2376 | `src/remote-client/bootstrap.ts` |
| REQ-022 | TASK-007 | TEST-2001, TEST-2002, TEST-2003, TEST-2004, TEST-2005, TEST-2006 | `src/remote-client/prebuilt.ts` |
| REQ-023 | TASK-016 | TEST-2310, TEST-2319 | `src/remote-client/bootstrap.ts` |
| REQ-024 | TASK-018 | TEST-2318 | `tests/fixtures/fake-ssh.mjs` |
| REQ-025 | TASK-018 | TEST-2343, TEST-2345, TEST-2347, TEST-2348, TEST-2352, TEST-2361, TEST-2364, TEST-2373, TEST-2374, TEST-2376, TEST-2377, TEST-2378 | `tests/fixtures/fake-ssh.mjs` |
| REQ-026 | TASK-020 | TEST-2368, TEST-2377, TEST-2378 | `src/remote-client/prebuilt.ts`, `src/remote-client/bootstrap.ts` |

Uncovered requirements: none. Every REQ-001..026 in `02-spec.md` has at least one TASK, at
least one TEST (verified against the actual test files, not asserted from the spec), and its
implementing file(s).
