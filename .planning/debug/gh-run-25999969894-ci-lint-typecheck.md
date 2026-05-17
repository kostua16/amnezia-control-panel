# Debug: CI Lint + TypeCheck failures (gh run #25999969894)

**Status:** RESOLVED
**Branch:** main
**Date:** 2026-05-18

## Symptoms
- **Lint job:** 35 errors, 54 warnings
- **Type Check job:** ~35 type errors

## Root Causes

### 1. Missing exports (chain-layout.ts, websocket.ts)
- `NODE_WIDTH`, `NODE_HEIGHT`, `CANVAS_PADDING` not exported from chain-layout
- `WsEventType`, `broadcastAlert`, `broadcastStatsUpdate`, `broadcastResourceUpdate` missing from websocket.ts

### 2. React Flow v12 NodeProps API misuse
- `NodeProps<{ data: T }>` should be `NodeProps<Node<T>>` in @xyflow/react v12
- Affects: chain-flow-node.tsx, panel-group-node.tsx, chain-flow-utils.ts, chain-flow-editor.tsx

### 3. useWebSocket API mismatch
- providers.tsx/push-wizard.tsx expect `lastEvent`, `events`, `autoConnect` but useWebSocket doesn't provide them
- `socketRef.current` accessed during render (react-hooks/refs lint error)

### 4. chain-visualization.tsx broken
- `formatBytesPerSec` doesn't exist
- `useChainStatus` called with wrong signature (object vs positional args)
- `calculateConnections` returns `{ from: string, to: string }` but code accesses `.x`, `.y`, `.id`
- `isConnected` doesn't exist on useChainStatus return

### 5. Prisma model name mismatch
- `rule-enforcement.ts` uses `xrayRule` but schema has `RoutingRule`

### 6. Type issues in various files
- chain-router.ts: prisma type assertion too loose
- panel-health-checker.ts: return doesn't match PanelConnectionRecord interface
- routing-rule-templates.ts: JSON type incompatibility with Prisma

### 7. Test lint
- transport-resolver.test.ts assigns to `module` variable (Next.js lint rule)
