---
slug: users-create-404
status: fixed
trigger: "the 'http://127.0.0.1:3333/users/create' returns 404 error"
created: 2026-05-02
updated: 2026-05-02
---

# Debug: users-create-404

## Symptoms

- **Expected:** /users/create should render a user creation form as part of the dashboard UI
- **Actual:** Next.js returns 404 not-found page
- **Error messages:** Next.js 404 page
- **Timeline:** Never worked
- **Reproduction:** Navigate to http://127.0.0.1:3333/users/create

## Current Focus

- **hypothesis:** FIXED — replaced dead Link with onCreateClick callback
- **test:** TypeScript compiles without errors
- **expecting:** Clicking "Create User" in empty state opens CreateUserModal
- **next_action:** manual verification in browser
- **reasoning_checkpoint:** confirmed
- **tdd_checkpoint:** (pending)

## Evidence

- `src/app/(dashboard)/users/page.tsx` exists (users list page)
- No `src/app/(dashboard)/users/create/page.tsx` exists
- `src/components/users/user-list.tsx:59` manages `createModalOpen` state and renders `CreateUserModal`
- `src/components/users/user-list.tsx:219` has working "Create User" button that opens the modal
- `src/components/users/user-empty-state.tsx:29` had dead link `<Link href="/users/create">`

## Eliminated

- Not a routing group issue — `(dashboard)` group correctly exposes `/users` without the group prefix
- Not a layout issue — `(dashboard)/layout.tsx` applies AuthGuard + DashboardLayout correctly
- Not a regression — the route never existed in the codebase

## Resolution

- **root_cause:** UserEmptyState component had a dead link to /users/create (a route that was never created). User creation is implemented as a modal within UserList, not as a separate page route.
- **fix:** Removed `Link` import, added `onCreateClick` callback prop to `UserEmptyState`, wired to `setCreateModalOpen(true)` in `UserList`. Added `CreateUserModal` render inside empty state early-return so the modal is available when opened from empty state.
- **verification:** TypeScript compiles clean. Needs manual browser verification: navigate to /users with 0 users, click "Create User" in empty state.
- **files_changed:** src/components/users/user-empty-state.tsx, src/components/users/user-list.tsx
