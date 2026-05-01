<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Learned User Preferences

- Prefer `npm run dev --port <n>` and production `npm start` port forms without requiring `--` before forwarded args; this repo normalizes npm `npm_config_port` in `scripts/dev.cjs` and `scripts/start.cjs`.
- Prefer small, scoped git commits; do not commit large unintended trees (e.g. nested `.claude/worktrees` copies) without explicit approval.
- When documenting Servers/Panels for admins, state that API keys are operator-chosen shared secrets (e.g. `openssl rand -hex 32`), not `JWT_SECRET`, and plaintext is not recoverable from the DB after save.

## Learned Workspace Facts

- Default dev port is 3333 only when no `-p`/`--port` in argv and `PORT` is unset; the dev/start launchers forward resolved ports to the Next CLI.
- Next.js allows only one `next dev` process per project directory; a second instance fails even on another port—use a separate checkout or worktree for concurrent dev servers on the same machine.
- Server reachability test is ICMP ping to the hostname only; it does not validate API key or TCP port. Panel reachability test is HTTP HEAD to the panel base URL; it does not call `/api/sync/receive` or validate the API key.
- Central-to-remote config push targets `{Panel URL}/api/sync/receive` with `X-API-Key` and HMAC `X-Signature`; the remote must store a bcrypt hash of the same plaintext key for verification to succeed.
