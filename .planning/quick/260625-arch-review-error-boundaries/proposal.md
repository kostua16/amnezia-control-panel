# Quick Task 260625: React Error Boundaries + Next.js error.tsx

## Problem

Zero `ErrorBoundary` components and zero `error.tsx` files exist in the codebase. An unhandled rendering error in any React component (bad data shape, null dereference, network timeout during render) crashes the **entire** admin panel with a white screen. For a VPN management tool where the admin may be responding to an outage, this is a reliability gap — the panel itself should never become unavailable due to a UI bug in one widget.

## Scope

### 1. Add Next.js `error.tsx` at the root layout level

- **files**: `src/app/error.tsx` (new)
- **action**: Create a `global-error.tsx` or `error.tsx` that renders a styled error page with a "Reload" button and logs the error. Next.js App Router requires this at the layout boundary; it catches any unhandled errors in the tree below.
- **verify**: Throw in any page component → error boundary catches → shows fallback, not white screen.

### 2. Add `error.tsx` for critical route groups

- **files**: `src/app/(dashboard)/error.tsx` (new, or equivalent layout group)
- **action**: Per-route-group error boundary so a crash in the chains page doesn't kill the entire dashboard shell (sidebar, header remain functional).
- **verify**: Error in chains page → sidebar still navigable → other pages unaffected.

### 3. Create a reusable `DashboardWidgetError` component

- **files**: `src/components/dashboard-widget-error.tsx` (new)
- **action**: Small wrapper component with `componentDidCatch` (class component) or React's `ErrorBoundary` pattern. Wrap each dashboard widget (stats cards, chain visualization, traffic chart, alert banner) individually so one widget failure doesn't cascade.
- **verify**: Simulate error in stats card → card shows "Stats unavailable" fallback → rest of dashboard renders normally.

## Acceptance Criteria

- [ ] Root-level `error.tsx` exists and renders a styled error page
- [ ] Dashboard route group has its own `error.tsx`
- [ ] At least 3 dashboard widgets wrapped in `DashboardWidgetError`
- [ ] No white-screen crashes from component-level rendering errors

## Estimated Effort

~2 hours. Three small new files + wrapping 3-5 existing components.
