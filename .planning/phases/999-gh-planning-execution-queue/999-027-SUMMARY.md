# Summary 999-027: dev script default port with CLI/env override

## What was built

Fixed `scripts/dev.cjs` to properly extract and apply `-p`/`--port` CLI argument values. Previously the launcher detected these flags (to skip the default) but never extracted the port number, so `server.mjs` — which only reads `process.env.PORT` — silently ignored the override and still bound 3333.

## Changes

| File | Change |
|------|--------|
| `scripts/dev.cjs` | Replaced `hasPortInArgs()` (boolean check) with `extractPortFromArgs()` that returns `{ port, remainingArgs }`. Port value from `-p N`, `--port N`, `-p=N`, `--port=N` is now set in `process.env.PORT`. Consumed args are stripped from the forwarded list. |

## Verification

- Prettier: pass
- ESLint: pass (file is eslint-ignored, no errors)
- TypeScript: no errors
- `npm test`: pass (exit 0, pre-existing warnings unrelated)
- Verify conditions from source artifact:
  - `npm run dev` → defaults to PORT=3333 ✓
  - `npm run dev -- --port 3334` → extracts 3334, sets PORT=3334, strips flag from args ✓
  - `npm run dev --port 3334` → handled by npm shorthand path ✓
  - `PORT=3456 npm run dev` → hasPortEnv skips default, env forwarded as-is ✓

## Self-Check: PASSED
