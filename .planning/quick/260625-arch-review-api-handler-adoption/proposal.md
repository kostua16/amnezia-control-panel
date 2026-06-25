# Quick Task 260625: apiHandler adoption across API routes

## Problem

`apiHandler` in `src/lib/api-handler.ts` centralizes Prisma error mapping (unique violation → 409, not-found → 404), Zod error formatting (422), and unknown error logging. Only **2 of ~65 route handlers** use it (`panels/route.ts` GET+POST). The remaining ~60 routes use raw `export async function POST/GET` with manual try/catch, producing inconsistent error responses:

- A Prisma `P2002` unique violation in `/api/users` returns 409 (via `apiHandler`), but the same violation in `/api/chains/apply` returns a generic 500.
- Zod parse failures return varying error shapes across routes.
- Unknown errors may leak stack traces in some routes but not others.

This inconsistency makes frontend error handling fragile — each consumer must know which error shape to expect per endpoint.

## Scope

### 1. Migrate high-risk routes to `apiHandler`

Priority routes where consistent error responses matter most:

| Route | Why |
|-------|-----|
| `chains/apply/route.ts` (250 lines) | Complex multi-service operation, Prisma writes |
| `panels/push/route.ts` (511 lines via push-wizard) | Network operations to remote panels |
| `panels/[id]/route.ts` (GET/PUT/DELETE) | CRUD with unique constraints |
| `routing/rules/[id]/route.ts` (GET/PUT/DELETE) | Reorder + priority conflicts |
| `routing/geo/[id]/route.ts` (GET/PUT/DELETE) | Cascade deletions |
| `alerts/route.ts` (GET/POST) | Alert creation |
| `servers/[id]/route.ts` | Server config updates |

- **action**: Wrap each handler with `apiHandler(handler, '/api/chains/apply')`. Remove manual try/catch boilerplate. Ensure Zod parse failures are thrown (not caught and returned early) so `apiHandler` maps them to 422.
- **verify**: Send invalid body to each migrated route → consistent `{ success: false, error: "..." }` shape with correct HTTP status.

### 2. Standardize Zod error propagation pattern

Several routes catch Zod errors and return early with `NextResponse.json({ error })` instead of throwing. This means `apiHandler` never sees them.

- **action**: Document a convention: either (a) throw Zod errors and let `apiHandler` catch them, or (b) return early before the handler for input validation. Pick one and apply consistently. Update `api-handler.ts` if needed (e.g., add a `validate()` helper that throws on bad input).
- **verify**: All migrated routes produce identical error shapes for the same Zod failure.

## Acceptance Criteria

- [ ] At least 7 high-risk routes migrated to `apiHandler`
- [ ] All migrated routes return consistent error JSON for Prisma unique/not-found
- [ ] Zod error propagation follows a single documented pattern
- [ ] No manual try/catch remains in migrated routes

## Estimated Effort

~4 hours. Mechanical per-route, but ~7 routes × 30 min each for careful migration + testing.
