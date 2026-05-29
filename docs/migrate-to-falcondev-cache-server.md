# Migrating to FalconDev GitHub Actions Cache Server

This guide documents a future migration from local workflow caches to a
transparent GitHub Actions cache server for self-hosted runners.

The current workflow workaround uses `maxnowack/local-cache` because GitHub's
cache service restored multi-gigabyte npm caches very slowly from our
self-hosted runner. FalconDev's cache server is the longer-term option when we
want official `actions/cache` compatibility, including cache calls made inside
third-party actions.

References:

- FalconDev getting started: <https://gha-cache-server.falcondev.io/getting-started>
- FalconDev filesystem storage: <https://gha-cache-server.falcondev.io/storage-drivers/file-system>
- FalconDev S3 / MinIO storage: <https://gha-cache-server.falcondev.io/storage-drivers/s3>
- FalconDev how it works: <https://gha-cache-server.falcondev.io/how-it-works>
- maxnowack local-cache: <https://github.com/maxnowack/local-cache>

## How FalconDev Works

FalconDev runs a replacement GitHub Actions cache API. Runners continue to use
normal workflow cache actions, but cache traffic is redirected to the local
server through `ACTIONS_RESULTS_URL`.

Important details:

- The cache server URL must be reachable by every runner that should use it.
- The runner URL value must end with a trailing slash.
- The official runner overwrites `ACTIONS_RESULTS_URL`, so the runner must be
  patched or replaced with FalconDev's forked runner image.
- Install `zstd` on runners for faster compression and decompression.
- Filesystem storage plus SQLite is the simplest single-node setup.
- S3 or MinIO storage is better when multiple runners should share cache data.

## Docker Compose Cache Server

Use this baseline for a single-node filesystem plus SQLite deployment. Replace
`http://127.0.0.1:3000` with a LAN, Tailscale, WireGuard, or public HTTPS URL if
the runners are not on the same host.

```yaml
services:
  cache-server:
    image: ghcr.io/falcondev-oss/github-actions-cache-server:latest
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      API_BASE_URL: http://127.0.0.1:3000
      STORAGE_DRIVER: filesystem
      STORAGE_FILESYSTEM_PATH: /data/cache
      DB_DRIVER: sqlite
      DB_SQLITE_PATH: /data/cache-server.db
      CACHE_CLEANUP_OLDER_THAN_DAYS: "30"
    volumes:
      - cache-data:/data

volumes:
  cache-data:
```

Basic verification:

```bash
docker compose up -d
docker compose ps
curl -I http://127.0.0.1:3000/
```

If the server is remote, verify it from the runner host:

```bash
curl -I http://cache-server.example.internal:3000/
```

## macOS / Mac Mini M4

Use this path when the self-hosted runner is installed directly on a Mac Mini.

1. Install prerequisites.

   ```bash
   brew install --cask docker
   brew install gnu-sed zstd
   ```

   Start Docker Desktop before continuing.

   ```bash
   open -a Docker
   ```

2. Create a cache server directory.

   ```bash
   mkdir -p ~/gha-cache-server
   cd ~/gha-cache-server
   ```

3. Create `docker-compose.yml` from the baseline above.

4. Start the cache server.

   ```bash
   docker compose up -d
   docker compose logs --tail=100 cache-server
   ```

5. Stop the runner service before patching. Run this from the runner install
   directory, for example `~/actions-runner`.

   ```bash
   ./svc.sh stop
   ```

   If the runner is not installed as a service, stop the foreground runner
   process instead.

6. Back up and patch `Runner.Worker.dll`.

   ```bash
   cp ./bin/Runner.Worker.dll ./bin/Runner.Worker.dll.before-falcondev-cache
   gsed -i 's/\x41\x00\x43\x00\x54\x00\x49\x00\x4F\x00\x4E\x00\x53\x00\x5F\x00\x52\x00\x45\x00\x53\x00\x55\x00\x4C\x00\x54\x00\x53\x00\x5F\x00\x55\x00\x52\x00\x4C\x00/\x41\x00\x43\x00\x54\x00\x49\x00\x4F\x00\x4E\x00\x53\x00\x5F\x00\x52\x00\x45\x00\x53\x00\x55\x00\x4C\x00\x54\x00\x53\x00\x5F\x00\x4F\x00\x52\x00\x4C\x00/g' ./bin/Runner.Worker.dll
   ```

7. Configure the runner service environment. Use a trailing slash.

   ```bash
   launchctl setenv ACTIONS_RESULTS_URL "http://127.0.0.1:3000/"
   launchctl setenv ACTIONS_CACHE_SERVICE_V2 "true"
   ```

   If the runner is started from a shell rather than Launch Services, export the
   same variables in that shell before starting `run.sh`.

8. Restart the runner.

   ```bash
   ./svc.sh start
   ```

9. Run a workflow that uses `actions/cache` or `setup-node` cache, then watch
   cache server logs.

   ```bash
   cd ~/gha-cache-server
   docker compose logs -f cache-server
   ```

10. Roll back if needed.

    ```bash
    ./svc.sh stop
    cp ./bin/Runner.Worker.dll.before-falcondev-cache ./bin/Runner.Worker.dll
    launchctl unsetenv ACTIONS_RESULTS_URL
    launchctl unsetenv ACTIONS_CACHE_SERVICE_V2
    ./svc.sh start
    ```

## Linux VPS

Use this path when the cache server and runner live on a Linux host. For a
containerized runner, prefer FalconDev's forked runner image instead of binary
patching.

1. Install prerequisites.

   ```bash
   sudo apt-get update
   sudo apt-get install -y docker.io docker-compose-plugin curl sed zstd
   sudo systemctl enable --now docker
   ```

2. Create a cache server directory.

   ```bash
   sudo mkdir -p /opt/gha-cache-server
   sudo chown "$USER":"$USER" /opt/gha-cache-server
   cd /opt/gha-cache-server
   ```

3. Create `docker-compose.yml` from the baseline above. If runners are on other
   hosts, set `API_BASE_URL` to a reachable HTTPS, VPN, or private LAN URL.

4. Start the cache server.

   ```bash
   docker compose up -d
   docker compose ps
   curl -I http://127.0.0.1:3000/
   ```

5. Stop the runner service before patching. Run this from the runner install
   directory, for example `/opt/actions-runner`.

   ```bash
   sudo ./svc.sh stop
   ```

6. Back up and patch `Runner.Worker.dll`.

   ```bash
   cp ./bin/Runner.Worker.dll ./bin/Runner.Worker.dll.before-falcondev-cache
   sed -i 's/\x41\x00\x43\x00\x54\x00\x49\x00\x4F\x00\x4E\x00\x53\x00\x5F\x00\x52\x00\x45\x00\x53\x00\x55\x00\x4C\x00\x54\x00\x53\x00\x5F\x00\x55\x00\x52\x00\x4C\x00/\x41\x00\x43\x00\x54\x00\x49\x00\x4F\x00\x4E\x00\x53\x00\x5F\x00\x52\x00\x45\x00\x53\x00\x55\x00\x4C\x00\x54\x00\x53\x00\x5F\x00\x4F\x00\x52\x00\x4C\x00/g' ./bin/Runner.Worker.dll
   ```

7. Configure systemd service environment. Replace the service name if your
   runner installed a different unit.

   ```bash
   sudo systemctl edit actions.runner.*.service
   ```

   Add:

   ```ini
   [Service]
   Environment="ACTIONS_RESULTS_URL=http://127.0.0.1:3000/"
   Environment="ACTIONS_CACHE_SERVICE_V2=true"
   ```

8. Reload and restart.

   ```bash
   sudo systemctl daemon-reload
   sudo ./svc.sh start
   ```

9. Verify from a workflow run and logs.

   ```bash
   cd /opt/gha-cache-server
   docker compose logs -f cache-server
   ```

10. Roll back if needed.

    ```bash
    sudo ./svc.sh stop
    cp ./bin/Runner.Worker.dll.before-falcondev-cache ./bin/Runner.Worker.dll
    sudo systemctl revert actions.runner.*.service
    sudo systemctl daemon-reload
    sudo ./svc.sh start
    ```

### Linux Container Runner Alternative

For Docker-based runners, use FalconDev's forked runner image and set
`CUSTOM_ACTIONS_RESULTS_URL` instead of patching the binary:

```yaml
services:
  runner:
    image: ghcr.io/falcondev-oss/actions-runner:latest
    environment:
      CUSTOM_ACTIONS_RESULTS_URL: http://cache-server:3000/
```

Keep the trailing slash.

## Windows 11

Use this path when the self-hosted runner is installed directly on Windows 11.

1. Install prerequisites.

   ```powershell
   winget install Docker.DockerDesktop
   winget install Facebook.Zstandard
   ```

   Start Docker Desktop before continuing.

2. Create a cache server directory.

   ```powershell
   New-Item -ItemType Directory -Force C:\gha-cache-server
   Set-Location C:\gha-cache-server
   ```

3. Create `docker-compose.yml` from the baseline above.

4. Start the cache server.

   ```powershell
   docker compose up -d
   docker compose ps
   curl.exe -I http://127.0.0.1:3000/
   ```

5. Open PowerShell as Administrator and stop the runner service from the runner
   install directory, for example `C:\actions-runner`.

   ```powershell
   .\svc.cmd stop
   ```

6. Back up and patch `Runner.Worker.dll`.

   ```powershell
   Copy-Item .\bin\Runner.Worker.dll .\bin\Runner.Worker.dll.before-falcondev-cache
   [byte[]] $bytes = Get-Content -Path .\bin\Runner.Worker.dll -Encoding Byte
   $hex = ($bytes | ForEach-Object { $_.ToString("X2") }) -join ""
   $hex = $hex -replace "41004300540049004F004E0053005F0052004500530055004C00540053005F00550052004C00", "41004300540049004F004E0053005F0052004500530055004C00540053005F004F0052004C00"
   [byte[]] $patched = -split ($hex -replace "..", "0x$& ")
   Set-Content -Path .\bin\Runner.Worker.dll -Encoding Byte -Value $patched
   ```

7. Configure machine-level environment variables. Use a trailing slash.

   ```powershell
   [Environment]::SetEnvironmentVariable("ACTIONS_RESULTS_URL", "http://127.0.0.1:3000/", "Machine")
   [Environment]::SetEnvironmentVariable("ACTIONS_CACHE_SERVICE_V2", "true", "Machine")
   ```

8. Restart the runner service.

   ```powershell
   .\svc.cmd start
   ```

9. Verify from a workflow run and logs.

   ```powershell
   Set-Location C:\gha-cache-server
   docker compose logs -f cache-server
   ```

10. Roll back if needed.

    ```powershell
    .\svc.cmd stop
    Copy-Item .\bin\Runner.Worker.dll.before-falcondev-cache .\bin\Runner.Worker.dll -Force
    [Environment]::SetEnvironmentVariable("ACTIONS_RESULTS_URL", $null, "Machine")
    [Environment]::SetEnvironmentVariable("ACTIONS_CACHE_SERVICE_V2", $null, "Machine")
    .\svc.cmd start
    ```

## Optional S3 or MinIO Storage

Use filesystem storage for one runner host. Use S3-compatible storage when cache
data should be shared across multiple machines or retained independently from a
single runner host.

Minimal S3 settings:

```yaml
environment:
  API_BASE_URL: http://cache-server.example.internal:3000
  STORAGE_DRIVER: s3
  STORAGE_S3_BUCKET: gh-actions-cache
  AWS_REGION: us-east-1
  AWS_ACCESS_KEY_ID: change-me
  AWS_SECRET_ACCESS_KEY: change-me
```

For MinIO, also set:

```yaml
environment:
  AWS_ENDPOINT_URL: http://minio:9000
```

If `ENABLE_DIRECT_DOWNLOADS=true`, make sure every runner can reach the storage
provider directly. Otherwise, leave direct downloads disabled and let the cache
server proxy cache traffic.

## Workflow Migration After FalconDev

Once FalconDev is deployed and verified:

1. Re-enable the commented `actions/cache` blocks in workflows if we want the
   official cache action behavior again.
2. Re-enable `setup-node`'s `cache: npm` only after confirming cache traffic
   reaches FalconDev instead of GitHub/Azure.
3. Remove or disable `maxnowack/local-cache` only after multiple successful
   workflow runs prove the cache server is stable.
4. Keep `package-manager-cache: false` until we intentionally decide to let
   `setup-node` auto-enable package manager caching.

## Verification Checklist

- `curl -I <cache-server-url>` succeeds from each runner host.
- Runner environment contains `ACTIONS_RESULTS_URL` with a trailing slash.
- Runner logs show the patched runner no longer overwrites the custom results
  URL.
- Cache server logs show restore and save requests during a workflow run.
- Workflow logs no longer show multi-minute downloads from GitHub/Azure cache
  storage.
- A cache miss runs the underlying install/build command and a later run gets a
  cache hit.
