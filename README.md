# Amnezia Control Panel

Unified admin panel for managing [Amnezia AWG2](https://amnezia.org/) (AmneziaVPN WireGuard) and [3x-ui](https://github.com/MHSanaei/3x-ui) (Xray panel) on the same VPN server. Single administrator manages users across both systems, configures VPN services, controls routing, monitors traffic and health — all from one interface.

**Stack:** Next.js 16 + React 19 + TypeScript + Prisma ORM + SQLite + Socket.IO (WebSocket). Tailwind CSS for styling.

## Documentation

- **[Adding a server](docs/adding-a-server.md)** — Servers tab walkthrough, including where the **API key** comes from and how **Test Connection** behaves.
- **[Adding a panel](docs/adding-a-panel.md)** — Panels tab walkthrough, **shared API key** with the remote instance, sync headers, and **Test Connection** behavior.
- **[Private GHCR deployment](docs/private-ghcr-deploy.md)** — Multi-server bootstrap from the private GitHub Container Registry image, with self-care and auto-upgrades.
- **[GSD Commands and Workflows](docs/GSD-HOWTO.md)** — Cheatsheet for GSD commands, daily workflows, and project-specific examples.

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3333](http://localhost:3333) with your browser to see the result.

The landing page redirects to `/dashboard`. Default dev port is **3333** (override with `npm run dev -- --port 8000` or `PORT=8000 npm run dev`).

This project self-hosts [Geist](https://vercel.com/font) via [`next/font/local`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts): variable `.woff2` files are committed under `src/app/fonts/` (Geist v1.7.1, SIL OFL) so builds do not fetch fonts from external CDNs at compile time.

## Deploy with Docker

The recommended way to deploy Amnezia Control Panel is using Docker.

### Quick start

1. Copy the example environment file and set your secrets:

```bash
cp .env.example .env
# Edit .env — JWT_SECRET and ADMIN_PASSWORD are required (compose will fail without them)
```

2. Start the container:

```bash
docker compose up -d
```

3. Open [http://localhost:3333](http://localhost:3333) in your browser.

### Bundled VPN stack (AWG + 3x-ui + Tailscale)

For a **self-contained** VPN server in one container (isolated from host VPN installs):

```bash
cp .env.example .env
docker compose -f docker-compose.stack.yml up -d --build
```

See [Bundled stack deployment](docs/bundled-stack.md) for ports, volumes, version bumps, and `stack-latest` GHCR tags.

### Environment variables

| Variable              | Default                        | Description                                                          |
| --------------------- | ------------------------------ | -------------------------------------------------------------------- |
| `JWT_SECRET`          | **(required)**                 | Secret for signing JWT tokens — generate with `openssl rand -hex 32` |
| `ADMIN_PASSWORD`      | **(required)**                 | Initial admin password                                               |
| `PORT`                | `3333`                         | Host port mapping                                                    |
| `DATABASE_URL`        | `file:/app/data/prisma/dev.db` | SQLite database path                                                 |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3333`        | Public URL of the panel                                              |

### Published image

The `Docker Image` GitHub Actions workflow publishes the production image to GitHub Container Registry:

```bash
docker pull ghcr.io/kostua16/amnezia-control-panel:latest
```

Published tags:

- `latest`, `main`, and `sha-*` from the `main` branch
- `1.2.3`, `1.2`, and `sha-*` from release tags like `v1.2.3`
- `stack-latest`, `stack`, and `stack-sha-*` for the bundled VPN stack image

The first workflow publish creates the GHCR package. Package visibility is managed in the GitHub Packages settings for `ghcr.io/kostua16/amnezia-control-panel`.

### Managed private deployment

For personal servers, use the first-party deployment helper instead of manually installing Docker and logging in:

```bash
scripts/deploy-server.sh config init
scripts/deploy-server.sh server add vpn-1 203.0.113.10 --user root
scripts/deploy-server.sh install
```

The helper stores reusable server inventory in `~/.config/amnezia-control-panel/deploy.yaml`, stores local reusable secrets in the OS credential store, installs `/usr/local/bin/acp-agent` on each server, and enables systemd timers for health repair, image/script upgrades, and cleanup by default.

See [Private GHCR deployment](docs/private-ghcr-deploy.md) for CentOS Stream 9 / RHEL 9-family support, token requirements, upgrade commands, rollback behavior, and service details.

### Volumes

| Volume       | Mount              | Purpose                     |
| ------------ | ------------------ | --------------------------- |
| `db-data`    | `/app/data/prisma` | SQLite database persistence |
| `geoip-data` | `/app/data/geoip`  | GeoIP database cache        |
| `log-data`   | `/app/logs`        | Application logs            |

### Build manually

```bash
docker build -t amnezia-control-panel .

docker run -d \
  --name amnezia-control-panel \
  -p 3333:3333 \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e ADMIN_PASSWORD="your-secure-password" \
  -e DATABASE_URL="file:/app/data/prisma/dev.db" \
  -v amnezia-db:/app/data/prisma \
  -v amnezia-geoip:/app/data/geoip \
  amnezia-control-panel
```

### Run the published image

```bash
docker run -d \
  --name amnezia-control-panel \
  -p 3333:3333 \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e ADMIN_PASSWORD="your-secure-password" \
  -e DATABASE_URL="file:/app/data/prisma/dev.db" \
  -v amnezia-db:/app/data/prisma \
  -v amnezia-geoip:/app/data/geoip \
  -v amnezia-logs:/app/logs \
  ghcr.io/kostua16/amnezia-control-panel:latest
```

## Other deployment

This project can also be deployed to any platform that supports Node.js. See the [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for options. The Docker method above is recommended for production.
