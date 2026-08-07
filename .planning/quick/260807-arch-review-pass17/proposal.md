# Architectural Review Pass 17 (2026-08-07)

Source: `/gsd:explore` seventeenth-pass review (non-duplicative vs proposals #1-#46 and open PRs).

Deduped vs open PRs: #992 (js-yaml), #936 (better-sqlite3), #935 (eslint), #934 (dev-deps), #933 (prod-deps), #907 (hono+prisma), #877 (audit-area rotation), #868 (typescript) — all dependency bumps or workflow fixes, zero source overlap.

## Proposals

| # | Proposal | Severity | Area | Status |
|---|----------|----------|------|--------|
| 47 | **Remove shell metacharacter guard from HTTP-bound config-applier values** | Medium (Correctness) | `src/lib/config-applier.ts:8-14, 131-136` | Proposed |
| 48 | **Add request body size limits to all API route handlers** | Medium (Security/Ops) | `src/app/api/**/*.ts` (30+ routes) | Proposed |
| 49 | **Centralized startup environment variable validation** | Low-Medium (Ops/UX) | `src/lib/env.ts` (new), `instrumentation.node.ts` | Proposed |

---

### #47: Remove shell metacharacter guard from HTTP-bound config-applier values

**Problem:**
`config-applier.ts` defines `DANGEROUS_CHARS = /[;|&$\`\\]/` and `validateNoInjection()` which rejects values containing these characters. It is called on WireGuard peer values (`publicKey`, `allowedIPs`, `endpoint`) before pushing them to a remote panel.

However, the push path is entirely HTTP-based: `pushToRemotePanel()` → `pushToPanel()` → `httpClient()` (fetch). The values are serialized as JSON in the request body. No shell is ever involved in this code path. The actual shell-executing code (`vpn-services.ts`) already uses `execFile()` with array-form arguments, which is inherently injection-safe.

The guard rejects **legitimate values**:
- WireGuard endpoints containing `$` (e.g., IPv6 zone IDs like `fe80::1%eth0`)
- URLs with `&` (query parameters in panel URLs)
- Paths with `\` (Windows-style paths in endpoint hostnames)

**Fix:**
Remove the `DANGEROUS_CHARS` regex and `validateNoInjection()` function from `config-applier.ts`. Remove the three calls at lines 131-136. The injection safety is already provided by:
1. `execFile()` with array args in `vpn-services.ts` (shell-safe by design)
2. JSON serialization in `httpClient()` (no shell interpretation)

**Files:** `src/lib/config-applier.ts`

**Benefit:** Eliminates false rejections of valid WireGuard configs (especially IPv6 endpoints). Removes misleading defense-in-depth that protects against a non-existent threat vector.

---

### #48: Add request body size limits to all API route handlers

**Problem:**
30+ POST/PUT API routes call `await request.json()` with no size constraint. In Next.js App Router, route handlers receive the body as a raw `ReadableStream`; `request.json()` will buffer and parse arbitrarily large payloads. A misconfigured client, runaway frontend form, or malicious request can send multi-MB JSON payloads that consume server memory.

Unlike Next.js Pages Router (which had `export const config = { api: { bodyParser: { sizeLimit: '1mb' } } }`), App Router route handlers have no built-in body size limit. Each route must enforce this individually or via a shared wrapper.

**Fix:**
Add a `parseBody<T>(request: NextRequest, schema: ZodSchema<T>, maxSizeBytes?: number)` utility that:
1. Reads the raw body stream with a byte counter
2. Rejects if `maxSizeBytes` is exceeded (default: 1 MiB)
3. Parses JSON and validates against the Zod schema
4. Returns the typed, validated payload

Wire this into the existing `apiHandler()` wrapper (`src/lib/api-handler.ts`) so all routes that use it get body size limits automatically. For the ~20 routes not yet using `apiHandler` (proposal #46), add a standalone `readBody(request, maxSize)` export they can call directly.

**Files:** `src/lib/api-handler.ts` (extend), `src/lib/parse-body.ts` (new, optional)

**Benefit:** Prevents OOM from oversized payloads. Uniform 1 MiB default across all mutating routes. Fails fast with a 413 response instead of silently consuming memory.

---

### #49: Centralized startup environment variable validation

**Problem:**
15+ environment variables are read lazily across 10+ files:
- `JWT_SECRET` — `src/lib/auth-jwt.ts:16` (throws only on first login)
- `DATABASE_URL` — `src/lib/prisma.ts:10` (fails on first query)
- `ADMIN_PASSWORD` — `src/lib/seed.ts:19` (warns in dev, throws in production on first seed)
- `XUI_COOKIE`, `XUI_USERNAME`, `XUI_PASSWORD` — `src/lib/vpn-services.ts:567-573`
- `AWG_INTERFACE`, `XUI_BASE_URL` — `src/lib/service-monitor.ts:26,31`
- `ACP_DEPLOYMENT_MODE` — `src/lib/deployment-mode.ts:8`
- `TRAFFIC_STATS_WINDOW_HOURS`, `RETENTION_DAYS`, `ALERT_RETENTION_DAYS` — various

If `JWT_SECRET` is missing, the error only surfaces when the first admin tries to log in — potentially hours after deployment. If `DATABASE_URL` points to a non-existent file, the first API query fails with a cryptic SQLite error.

**Fix:**
Create `src/lib/env.ts` that:
1. Declares all required and optional env vars with their types, defaults, and descriptions
2. Exports typed getter functions (`getJwtSecret()`, `getDatabaseUrl()`, etc.)
3. Exports a `validateEnvironment()` function that checks all required vars and logs warnings for optional ones
4. Call `validateEnvironment()` from `instrumentation.node.ts` at startup, before any services are initialized

Required vars (fail fast): `JWT_SECRET`
Optional vars (warn + default): `DATABASE_URL`, `ADMIN_PASSWORD`, `ACP_DEPLOYMENT_MODE`, `AWG_INTERFACE`, `XUI_BASE_URL`, etc.

**Files:** `src/lib/env.ts` (new), `instrumentation.node.ts` (add validate call), consumer files (update to use getters)

**Benefit:** Fails fast at startup with a clear `Missing required env var: JWT_SECRET` message instead of surfacing cryptic errors hours later. Single source of truth for all configuration.
