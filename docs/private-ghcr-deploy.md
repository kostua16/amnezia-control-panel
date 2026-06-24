# Private GHCR Deployment

This guide installs Amnezia Control Panel on personal servers from the private
GitHub Container Registry image:

```text
ghcr.io/kostua16/amnezia-control-panel:latest
```

The deployment uses two first-party scripts:

- `scripts/deploy-server.sh` runs locally and manages one or more SSH targets.
- `scripts/acp-agent.sh` is installed on each server as `/usr/local/bin/acp-agent`.

The server agent installs Docker, writes the production Compose file, pulls the
private image, starts the app, and installs systemd timers for health repair,
updates, and cleanup.

## Token Requirements

Private GHCR images cannot be pulled anonymously. Use a GitHub classic PAT or
machine-user token that can read this package.

For this private repository, use a token with:

- `read:packages`
- repository read access, so release assets can be downloaded for script
  self-upgrades

The remote server stores the token at:

```text
/etc/amnezia-control-panel/ghcr-token
```

The file is root-owned with `0600` permissions. The agent uses a temporary Docker
credential directory for each pull and removes it after use.

## Supported Servers

Automatic Docker installation supports:

- Ubuntu
- Debian
- CentOS Stream 9
- RHEL 9-family distributions such as Rocky Linux 9 and AlmaLinux 9

Run SSH as `root` or as a user with passwordless `sudo`.

## First Install

Initialize reusable local config:

```bash
scripts/deploy-server.sh config init
```

Add servers:

```bash
scripts/deploy-server.sh server add vpn-1 203.0.113.10 \
  --user root \
  --url https://vpn-1.example.com

scripts/deploy-server.sh server add vpn-2 admin@203.0.113.11
```

Run install for all enabled servers in the config:

```bash
scripts/deploy-server.sh install
```

Bundled VPN stack (AWG + 3x-ui + Tailscale in one privileged container):

```bash
scripts/deploy-server.sh install --stack vpn-1
```

This uses `ghcr.io/kostua16/amnezia-control-panel:stack-latest`. See [Bundled stack deployment](bundled-stack.md).

If `GHCR_TOKEN` or `ADMIN_PASSWORD` are not set in the environment, the helper
prompts once and stores them in the OS credential store:

- macOS: Keychain via `security`
- Linux desktop/server: Secret Service via `secret-tool`

Plaintext local secret storage is disabled unless you explicitly pass
`--allow-plaintext-secrets`.

You can also pass secrets for a one-off run:

```bash
GHCR_TOKEN=... ADMIN_PASSWORD=... scripts/deploy-server.sh install vpn-1
```

## Reusing Config

The local config lives at:

```text
~/.config/amnezia-control-panel/deploy.yaml
```

When no target names are passed, commands apply to all enabled servers:

```bash
scripts/deploy-server.sh status
scripts/deploy-server.sh healthcheck
scripts/deploy-server.sh upgrade image
```

To target specific servers:

```bash
scripts/deploy-server.sh care vpn-1 vpn-2
scripts/deploy-server.sh logs --follow vpn-1
```

CLI flags override environment variables, environment variables override saved
config, and saved config overrides built-in defaults.

## Upgrades

Upgrade the local helper and all remote agents from the latest GitHub Release
assets:

```bash
scripts/deploy-server.sh upgrade scripts
```

Upgrade only the Docker image on all enabled servers:

```bash
scripts/deploy-server.sh upgrade image
```

Upgrade scripts and the image:

```bash
scripts/deploy-server.sh upgrade all
```

The scripts download `deploy-server.sh`, `acp-agent.sh`, and `checksums.txt`
from GitHub Releases and verify SHA256 checksums before replacing anything.

## Server Agent Commands

On the target server, root can run:

```bash
acp-agent status
acp-agent healthcheck
acp-agent care
acp-agent cleanup
acp-agent upgrade scripts
acp-agent upgrade image
acp-agent upgrade all
```

The production files are stored at:

```text
/opt/amnezia-control-panel/compose.yaml
/opt/amnezia-control-panel/.env
/var/lib/amnezia-control-panel-agent/
```

The generated Compose file uses the published image, persistent named volumes,
and the container healthcheck already defined for the app.

## Systemd Self-Care

Service installation is enabled by default. The agent installs:

- `amnezia-control-panel-care.timer` every 2 minutes
- `amnezia-control-panel-upgrade.timer` hourly with randomized delay
- `amnezia-control-panel-cleanup.timer` daily

Disable service installation for a manual server:

```bash
scripts/deploy-server.sh --no-service install vpn-1
```

Install or remove units later:

```bash
scripts/deploy-server.sh install-service vpn-1
scripts/deploy-server.sh uninstall-service vpn-1
```

`care` restarts Docker if needed, recreates a missing container, restarts an
unhealthy container, and force-recreates the app after repeated failures.

`cleanup` prunes stopped containers, dangling images, and old builder cache. It
does not prune named volumes and does not delete the current or last-good app
image.

## Rollback Behavior

Before pulling a tag-based image, the agent tags the current local image as:

```text
amnezia-control-panel:last-good
```

If the new image fails post-upgrade health checks, the agent retags the
last-good image back to the configured image reference and recreates the app.

Digest-pinned image references can be used, but automatic retag rollback is not
available for digest refs.
