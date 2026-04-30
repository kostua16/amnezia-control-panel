# Adding a server (Servers tab)

## Prerequisites

- Log in to the Amnezia Control Panel.
- Know the VPN/server **hostname or IP** and the **SSH port** the panel will use to reach that host (default **22**).

## Open the form

1. In the sidebar, open **Servers** (`/servers`).
2. Click **Add Server** (top right), or **Add Your First Server** if the list is empty.
3. A dialog titled **Add Server** opens.

## Fill in the fields

| Field | What to enter |
|--------|----------------|
| **Server Name** | Any label you will recognize (required). |
| **Hostname / IP Address** | IPv4 (e.g. `192.168.1.1`) or a domain (e.g. `vpn.example.com`). Invalid formats are rejected in the form. |
| **Port** | TCP port for SSH-style access to that host. Default **22**. Range 1–65535. |
| **API Key** | A **shared secret** you choose (see [Where does the API key come from?](#where-does-the-api-key-come-from) below). Required; stored only as a **bcrypt hash** in the database—the plain value is not kept after submit. |

## Save or test

- **Add Server** — Saves the server via `POST /api/servers` and closes the dialog if the request succeeds.
- **Test Connection** — **Also creates the server first** (same API), then runs a reachability check. If the check succeeds, the dialog closes like a normal add. If it fails, you may still see a new row in the list; delete it from the table if you do not want that entry.

### Duplicate hostnames

If that hostname is already registered, the API returns **409** with a message like *Server hostname already exists*.

## Where does the API key come from?

The panel **does not generate or display** a server API key for you, and it is **not** the same as `JWT_SECRET` in `.env` (that secret is for panel login sessions only).

**What to do in practice:**

1. **Generate a strong random secret yourself**, for example:
   - **OpenSSL:** `openssl rand -hex 32`
   - Or use your password manager’s random generator (long random string).
2. **Paste that value** into the **API Key** field when adding the server.
3. **Keep a copy in a safe place** (password manager). You cannot read the original back from the panel—only the hash is stored.
4. **Use the same value on the server side** when you configure whatever agent or service will authenticate to this panel (future SSH/API integration). Until that side exists, the key is still required by the form so the record can be stored consistently.

**Current behavior:** “Test Connection” uses a **ping** from the machine running the app to the **hostname**. It does **not** verify the API key or the TCP port. The key is for **stored credentials** and upcoming remote automation—not for the ping test.

## After the server appears

- **Status** may show **unknown** until you run **Test Connection** (flask icon) on a row.
- **Edit** (pencil): may be visible but is not wired in the current UI; use delete and re-add if you must change fields.
- **Delete** asks for confirmation, then removes the server.

## Related code

- UI: `src/components/servers/server-list.tsx`, `src/components/servers/add-server-form.tsx`
- API: `src/app/api/servers/route.ts`, `src/app/api/servers/[id]/test/route.ts`
- Reachability check: `src/lib/server-connection.ts`
