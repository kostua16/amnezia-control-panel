---
status: complete
date: 2026-06-12
---

# Managed Private GHCR Deployment

## Goal

Implement a first-party deployment path that can bootstrap and maintain Amnezia Control Panel on personal servers from the private GHCR image without manual Docker installation or manual registry login.

## Tasks

- Add a remote server agent that installs Docker on Ubuntu/Debian and CentOS Stream 9 / RHEL 9-family hosts, generates production Compose from the GHCR image, stores pull credentials root-only, and manages health, cleanup, image upgrades, script upgrades, rollback, and systemd timers.
- Add a local multi-server helper with reusable `~/.config/amnezia-control-panel/deploy.yaml`, OS credential-store secrets, SSH bootstrap, default all-enabled-server targeting, and commands for install/status/healthcheck/care/cleanup/upgrades/service/logs.
- Upload deployment scripts and checksums as GitHub Release assets so both scripts can self-upgrade from published releases with checksum verification.
- Document private GHCR deployment, token requirements, supported OSes, config reuse, service behavior, upgrades, and rollback.
- Verify shell syntax, shellcheck, actionlint, local config flow, and generated Compose validation where Docker is available.
