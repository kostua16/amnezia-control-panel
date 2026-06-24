# Bundled VPN stack image

The **stack** image is a single privileged container that runs:

| Process | Role | Isolated data path |
|---------|------|--------------------|
| Amnezia Control Panel | Admin UI + API | `/app/data/prisma` (SQLite) |
| 3x-ui + Xray | Xray panel (localhost only) | `/opt/acp-stack/x-ui` |
| AmneziaWG (`awg`, `amneziawg-go`) | WireGuard-compatible VPN | `/opt/acp-stack/awg` |
| Tailscale (`tailscaled`) | Mesh connectivity | `/opt/acp-stack/tailscale` |

The slim **`latest`** image contains only the control panel. Use it for central/orchestrator deployments. Use the **stack** image when this host should run its **own** VPN copies without touching existing host installs.

## Isolation from host VPN software

- AWG listens on **51821/udp** by default (`ACP_AWG_UDP_PORT`), not 51820.
- 3x-ui binds to **127.0.0.1:2053** inside the container (not published).
- Config and keys live in **named Docker volumes**, not host `/etc`.
- `ACP_DEPLOYMENT_MODE=bundled` switches health checks from `systemctl` to local CLI/HTTP probes.
- Client NAT/forwarding (MASQUERADE) is applied by the `amneziawg` s6 service when the tunnel starts, not via `awg0.conf` PostUp hooks.

Existing host Amnezia / 3x-ui / Tailscale installs are unaffected.

## Quick start

```bash
cp .env.example .env
# Set JWT_SECRET, ADMIN_PASSWORD; optional TS_AUTHKEY, XUI_USERNAME/XUI_PASSWORD

docker compose -f docker-compose.stack.yml up -d --build
```

Open [http://localhost:3333](http://localhost:3333).

### Published stack image

```bash
docker pull ghcr.io/kostua16/amnezia-control-panel:stack-latest
```

Tags: `stack-latest`, `stack-main` (from `main`), `stack-sha-*`, plus `stack-<semver>` on release.

## Environment variables (stack)

| Variable | Default | Description |
|----------|---------|-------------|
| `ACP_DEPLOYMENT_MODE` | `bundled` | Must be `bundled` in stack compose |
| `ACP_AWG_UDP_PORT` | `51821` | AWG listen port (host mapping) |
| `AWG_INTERFACE` | `awg0` | Interface name for `awg` CLI |
| `XUI_BASE_URL` | `http://127.0.0.1:2053` | Internal 3x-ui URL |
| `XUI_USERNAME` / `XUI_PASSWORD` | — | Optional; used by ACP when calling 3x-ui API |
| `TS_AUTHKEY` | — | Optional; auto-join tailnet on first boot |
| `TS_HOSTNAME` | — | Tailscale machine name |
| `TS_STATE_DIR` | `/opt/acp-stack/tailscale` | Persist tailscaled state (volume) |

See [`.env.example`](../.env.example) and [README](../README.md).

## Version pins

Upstream versions are pinned in [`docker/stack-pins`](../docker/stack-pins). The stack Dockerfile reads these as build `ARG` defaults.

## Upgrade playbook

When bumping bundled components, edit `docker/stack-pins`, rebuild, and smoke-test.

### 1. 3x-ui + Xray

1. Check [3x-ui releases](https://github.com/MHSanaei/3x-ui/releases).
2. Update `XUI_REF` to the new tag (e.g. `v3.4.0`).
3. Read the release notes for the bundled **Xray-core** version; update `XRAY_VERSION` if you build from source. When using the official `ghcr.io/mhsanaei/3x-ui` image stage, `XUI_REF` alone selects both.
4. Rebuild: `docker compose -f docker-compose.stack.yml build --no-cache`
5. Smoke: `docker run --rm <image> /opt/x-ui/x-ui -v`

Useful upstream files:

- `Dockerfile`, `DockerInit.sh` in [MHSanaei/3x-ui](https://github.com/MHSanaei/3x-ui)

### 2. amneziawg-tools (`awg`, `wg`)

1. Check [amneziawg-tools releases](https://github.com/amnezia-vpn/amneziawg-tools/releases).
2. Update `AWGTOOLS_RELEASE` (e.g. `1.0.20260618-2`).
3. Confirm the Alpine zip name matches (`alpine-3.19-amneziawg-tools.zip` in the release assets).
4. Rebuild and run: `awg -v` inside the image.

### 3. amneziawg-go

1. Check [amneziawg-go tags](https://github.com/amnezia-vpn/amneziawg-go/tags).
2. Update `AMNEZIAWG_GO_REF`.
3. Rebuild; verify `/usr/bin/amneziawg-go` exists.

Reference Dockerfile: [amnezia-vpn/amneziawg-go](https://github.com/amnezia-vpn/amneziawg-go/blob/master/Dockerfile)

### 4. Tailscale

1. Check [Tailscale changelog](https://tailscale.com/changelog) / [releases](https://github.com/tailscale/tailscale/releases).
2. Update `TAILSCALE_VERSION` (e.g. `v1.98.3`) to match `tailscale/tailscale` image tag.
3. Rebuild; run `tailscale version` in the image.
4. **Keep `TS_STATE_DIR` on a volume** — without it, each restart registers a new tailnet node.

### 5. s6-overlay

1. Check [s6-overlay releases](https://github.com/just-containers/s6-overlay/releases).
2. Update `S6_OVERLAY_VERSION` in `docker/stack-pins` and `Dockerfile.stack`.

### Post-upgrade smoke tests

```bash
docker compose -f docker-compose.stack.yml up -d
docker compose -f docker-compose.stack.yml exec app awg show awg0
docker compose -f docker-compose.stack.yml exec app wget -qO- http://127.0.0.1:2053/login | head
docker compose -f docker-compose.stack.yml exec app tailscale status
```

Create a test user in the ACP UI (AWG + 3x-ui services).

### Rollback

Retag or pull a previous stack image:

```bash
docker pull ghcr.io/kostua16/amnezia-control-panel:stack-sha-<commit>
```

The server agent tags the current image as `amnezia-control-panel:last-good` before upgrades (see [private GHCR deployment](private-ghcr-deploy.md)).

## Process supervision

PID 1 is **s6-overlay**. Long-running services:

- `tailscaled`
- `x-ui`
- `amneziawg`
- `acp` (Node, runs as `appuser`)

`docker/stack-entrypoint.sh` runs Prisma migrations and AWG first-boot init before `/init`.

Restart helpers (used by bundled `service-monitor`):

- `/docker/stack/scripts/restart-xui.sh`
- `/docker/stack/scripts/restart-awg.sh`

## Licenses

Bundled upstream components retain their own licenses (3x-ui, Xray, AmneziaWG, Tailscale). This repository packages them for convenience; review upstream terms before production use.
