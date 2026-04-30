# Adding a remote panel (Panels tab)

Remote panels are other Amnezia Control Panel instances the **central** panel talks to (for example over Tailscale). This guide covers registering one from the UI.

## Prerequisites

- Log in to the control panel.
- Know the **base URL** of the remote panel (the Next.js app root), for example `http://100.x.x.x:3000` or `https://panel.example.com`.
- Agree on an **API key** with whoever operates the remote instance (see below).

## Open the form

1. In the sidebar, open **Panels** (`/panels`).
2. Click **Add Panel** (top right), or **Add Your First Panel** if the list is empty.
3. The **Add Panel** dialog opens.

## Fill in the fields

| Field | What to enter |
|--------|----------------|
| **Panel Name** | A label for this remote panel (required). |
| **Panel URL** | Full URL to the remote app’s **root** (required). Must be a valid URL (include scheme). Example placeholder in the UI: `http://100.x.x.x:3333`. Trailing slash is optional; use whatever the remote actually serves. Sync requests go to `{Panel URL}/api/sync/receive`. |
| **API Key** | Shared secret for authenticated sync (required). Stored only as a **bcrypt hash** in this database—the plain key is not kept after submit. |

## Save or test

- **Add Panel** — Sends `POST /api/panels` with `name`, `panelUrl`, and `apiKey`. On success the dialog closes and the list refreshes.
- **Test Connection** — **Creates the panel first** (same `POST`), then calls `POST /api/panels/:id/test`. If the test succeeds, the dialog closes like a normal add. If the test fails, you may still see a new row—remove it if you do not want that entry.

### Duplicate URLs

If that **panel URL** is already registered, the API returns **409** (*Panel URL already exists*).

## Where does the API key come from?

The central panel **does not generate** a key for you, and it is **not** the same as `JWT_SECRET` in `.env` (that is for admin sessions on this app only).

### Obtain a key (recommended)

1. **Generate a strong random secret**, for example:
   - `openssl rand -hex 32`
   - Or a long random string from a password manager.
2. **Share it securely** with the operator of the **remote** panel (encrypted channel, not email in plain text).
3. **Use the exact same string** when:
   - Registering the remote here (**API Key** on this form), and
   - Configuring the remote instance so its `POST /api/sync/receive` handler can authenticate your pushes (see **Remote side** below).

Each installation stores a **bcrypt hash** with its own salt, so the stored hashes differ between machines even for the same passphrase. That is normal: verification uses the **plaintext** key on the wire (`X-API-Key`) against the stored hash.

### Remote side (must match)

When this (central) panel **pushes** configuration, it calls the remote at:

`{Panel URL}/api/sync/receive`

with headers including `X-API-Key` (plaintext) and `X-Signature` (HMAC of the body). The remote verifies:

1. The key against its `RemotePanel` records (`bcrypt.compare`).
2. The HMAC using the same key (`src/app/api/sync/receive/route.ts`).

So the **remote** database must include a `RemotePanel` row whose `apiKeyHash` was produced from **the same plaintext** you typed here. In practice the remote operator often creates that by using this same codebase’s panel registration (e.g. **Add Panel** on the remote with a URL pointing back to central, or another documented onboarding step) while entering **the identical API key string**. If the remote has no matching row, sync receives **401 Invalid API key**.

**You cannot read the key back from either UI after saving**—only the hash is stored. Keep the secret in a password manager if you will need it again (for example for **Edit Panel** when rotating the key, or for operations that ask for the key at push time).

## How the API key is used (after registration)

- **Config push** (`src/lib/panel-sync-client.ts`): central sends JSON to `{panelUrl}/api/sync/receive` with `X-API-Key` and `X-Signature` derived from the payload and the plaintext key available at push time.
- **Auto-resync** after outages may require the plaintext key to have been supplied again in certain flows (see in-memory cache notes in `src/lib/panel-health-checker.ts`)—if auto-resync is skipped, a manual push that supplies the key can populate the cache.

## What “Test Connection” checks

`testPanel` issues an HTTP **HEAD** request to **Panel URL** with a short timeout. Any HTTP response (including errors) is treated as “reachable” in line with the current implementation. It does **not** call `/api/sync/receive` and does **not** validate the API key.

## After the panel appears

- **Status** is updated from connection history / polling (`/api/panels/:id/status`); the list also refreshes on an interval.
- **Test connection** (flask icon): runs the same HEAD-based test and updates history.
- **Edit**: change name, URL, API key, or active flag (`EditPanelForm`).
- **Remove**: deletes the panel and related connection history (confirmation required).
- **Details** (info icon): opens the details drawer for that panel.

## Related code

- UI: `src/components/panels/panel-list.tsx`, `src/components/panels/add-panel-form.tsx`, `src/components/panels/edit-panel-form.tsx`
- API: `src/app/api/panels/route.ts`, `src/app/api/panels/[id]/test/route.ts`
- Health / test: `src/lib/panel-health-checker.ts`
- Sync client: `src/lib/panel-sync-client.ts`
- Receive endpoint: `src/app/api/sync/receive/route.ts`
