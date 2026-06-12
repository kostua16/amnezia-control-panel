---
status: complete
date: 2026-06-12
---

# Summary

Implemented managed private GHCR deployment with a local multi-server helper and a remote server agent.

The local helper stores reusable server inventory in `~/.config/amnezia-control-panel/deploy.yaml`, supports Keychain/Secret Service backed reusable secrets, can bootstrap all enabled servers by default, and forwards install/status/healthcheck/care/cleanup/upgrade/service/log commands over SSH.

The remote agent installs Docker on Ubuntu/Debian and CentOS Stream 9 / RHEL 9-family systems, generates a production Compose file that uses `ghcr.io/kostua16/amnezia-control-panel:latest`, stores the GHCR token as a root-only file, performs temporary registry login for pulls, manages health repair, cleanup, image upgrades with local rollback, script self-upgrades from GitHub Releases, and installs systemd timers by default.

Release notes workflow now uploads `deploy-server.sh`, `acp-agent.sh`, and `checksums.txt` to `v*` releases, and docs now include a private GHCR deployment guide linked from the README.

## Verification

- `/Users/kostua16/go/bin/actionlint .github/workflows/release-notes.yml`
- `/opt/homebrew/bin/shellcheck scripts/acp-agent.sh scripts/deploy-server.sh`
- `bash -n scripts/acp-agent.sh scripts/deploy-server.sh`
- `node .github/workflows/scripts/workflow-governance-check.cjs`
- `npm run lint`
- `npm run format:check`
- `prettier --check README.md docs/private-ghcr-deploy.md .github/workflows/release-notes.yml .planning/STATE.md .planning/quick/260612-vxj-implement-managed-private-ghcr-deploymen/260612-vxj-PLAN.md .planning/quick/260612-vxj-implement-managed-private-ghcr-deploymen/260612-vxj-SUMMARY.md`
- `scripts/deploy-server.sh --config <tmp>/deploy.yaml config init`
- `scripts/deploy-server.sh --config <tmp>/deploy.yaml server add vpn-1 admin@203.0.113.10:2222 --labels prod --url https://vpn-1.example.com`
- `scripts/deploy-server.sh --config <tmp>/deploy.yaml config show`
- `scripts/deploy-server.sh --config <tmp>/deploy.yaml server list`
- `graphify update .`

`npm test` was rerun after `npx prisma generate`; it still has one unrelated failing assertion in `src/lib/__tests__/pr-flow-watchdog.test.ts` about `.github/workflows/pr-flow.yml` `cancel-in-progress`. This task did not touch that workflow.

Docker was not available in the local shell, so Compose config validation could not be run locally.
