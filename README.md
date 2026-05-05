# Amnezia Control Panel

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app). See `CLAUDE.md` for project goals and stack.

## Documentation

- **[Adding a server](docs/adding-a-server.md)** — Servers tab walkthrough, including where the **API key** comes from and how **Test Connection** behaves.
- **[Adding a panel](docs/adding-a-panel.md)** — Panels tab walkthrough, **shared API key** with the remote instance, sync headers, and **Test Connection** behavior.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit it.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family from Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

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

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `JWT_SECRET` | **(required)** | Secret for signing JWT tokens — generate with `openssl rand -hex 32` |
| `ADMIN_PASSWORD` | **(required)** | Initial admin password |
| `PORT` | `3333` | Host port mapping |
| `DATABASE_URL` | `file:/app/data/prisma/dev.db` | SQLite database path |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3333` | Public URL of the panel |

### Volumes

| Volume | Mount | Purpose |
|---|---|---|
| `db-data` | `/app/data/prisma` | SQLite database persistence |
| `geoip-data` | `/app/data/geoip` | GeoIP database cache |
| `log-data` | `/app/logs` | Application logs |

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

## Deploy on Vercel

Alternatively, you can deploy using the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme).

Check out the [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
