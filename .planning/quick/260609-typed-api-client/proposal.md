# Quick Task 260609: Typed API Client for Frontend Data Hooks

## Problem

All 10 data hooks (`use-users.ts`, `use-alerts.ts`, `use-traffic-stats.ts`, `use-dashboard-stats.ts`, `use-chain-status.ts`, `use-multi-panel-status.ts`, `use-service-status.ts`, `use-system-resources.ts`, `use-top-user-traffic.ts`, `use-websocket.ts`) duplicate the same fetch boilerplate:

```ts
async function fetchXxx(params): Promise<XxxResponse> {
  const searchParams = new URLSearchParams();
  if (params?.foo) searchParams.set('foo', params.foo);
  // ... 5-10 more params ...
  const query = searchParams.toString();
  const url = `/api/xxx${query ? `?${query}` : ''}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch xxx (status ${response.status})`);
  }
  return response.json();
}
```

Each hook manually:
1. Constructs `URLSearchParams` from optional params (~5-10 lines)
2. Builds the URL string
3. Calls `fetch()` with no timeout, no retry, no auth header
4. Checks `response.ok` and throws a generic error with status code only
5. Parses JSON with `response.json()`

This is ~15-20 lines of boilerplate per hook, totaling ~150-200 lines of duplication across the hooks layer. Error messages lose the server's error detail (`response.json()` is never read on failure). There's no centralized place to add request interceptors (auth tokens, correlation IDs, timeout).

**Existing proposal `260602-f6n`** covers the server-side error handling standardization (API route wrappers). This proposal addresses the **client-side** fetch abstraction — a distinct surface.

## Solution

Create a typed API client (`src/lib/api-client.ts`) that wraps `fetch` with:
- URL construction from path + query params
- Consistent error parsing (reads server error JSON on failure)
- Configurable timeout
- Generic response typing

## Scope

### 1. Create typed API client

- **files**: Create `src/lib/api-client.ts`
- **action**:
  - Export `apiGet<T>(path, params?)` and `apiMutate<T>(path, method, body?)` functions
  - `apiGet`: constructs URL with params, calls fetch, reads error JSON on !ok, returns typed `ApiResponse<T>`
  - `apiMutate`: same but accepts method + body
  - Both include configurable timeout (default 15s) via `AbortSignal.timeout`
  - Parse server error JSON when available: `{ success: false, error: string }` → throw with server message
  - ~60-80 lines
- **verify**: Unit test with mocked fetch confirming: success path returns typed data; 4xx throws with server message; timeout throws; network error throws
- **done**: `apiGet` and `apiMutate` exported

### 2. Migrate 3-5 hooks to use apiGet

- **files**: `src/hooks/use-users.ts`, `src/hooks/use-alerts.ts`, `src/hooks/use-traffic-stats.ts`, `src/hooks/use-dashboard-stats.ts`
- **action**:
  - Replace manual fetch + URLSearchParams with `apiGet<UsersResponse>('/api/users', params)`
  - Delete the private `fetchUsers()` / `fetchAlerts()` / etc. functions
  - Each hook reduces by ~15 lines
- **verify**: Dev server starts; dashboard loads users, alerts, traffic stats correctly
- **done**: 4 hooks using `apiGet`, no manual fetch calls

### 3. Migrate mutation hooks to use apiMutate

- **files**: `src/hooks/use-alerts.ts` (markRead, markAllRead, deleteAlert)
- **action**:
  - Replace manual `fetch(url, { method, ... })` with `apiMutate('/api/alerts/read-all', 'POST')`
  - Error handling preserved via apiMutate
- **verify**: Alert CRUD operations work in UI
- **done**: All alert mutations use apiMutate

## Acceptance Criteria

- [ ] `api-client.ts` exports `apiGet` and `apiMutate` with generic typing
- [ ] Error messages include server-provided detail (not just HTTP status)
- [ ] Timeout (15s default) prevents hanging requests
- [ ] 4+ hooks migrated with no behavioral change
- [ ] ~60-80 lines of fetch boilerplate eliminated
- [ ] TypeScript compiles; dev server works

## Risk

- Very low — the client is a thin fetch wrapper. No auth token injection yet (cookies already sent automatically). Adding auth headers later requires only one place to change.

## Estimated Effort

1 focused session

## Relationship to Existing Proposals

- **260602-f6n** (API route error standardization) — server-side complement to this proposal. Together they ensure errors are structured at the route handler AND correctly parsed at the client.
- **260601-b2n** (HTTP client) — server-side HTTP client for outbound calls (panel sync, health checks). This proposal is for the **browser→server** fetch path, a distinct layer.
