---
status: complete
date: 2026-06-24
---

# Summary

Implemented the bundled VPN stack image: `Dockerfile.stack`, s6 supervision, `docker-compose.stack.yml`, version pins in `docker/stack-pins`, `ACP_DEPLOYMENT_MODE=bundled` health checks, GHCR `stack-latest` CI jobs, `--stack` on `acp-agent` / `deploy-server.sh`, and `docs/bundled-stack.md`.

## Commits

1. `feat(docker): add bundled VPN stack image and s6 supervision`
2. `feat(app): add bundled deployment mode service health checks`
3. `ci(docker): build and publish bundled stack image to GHCR`
4. `feat(deploy): add --stack profile for bundled VPN stack installs`
5. `docs: document bundled VPN stack deployment and upgrades`

## Verification

- `npm run lint` (pre-existing warnings only)
- `npx prettier --check` on changed TS files
