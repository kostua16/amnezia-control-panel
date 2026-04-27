# CLAUDE.md

<!-- GSD:project-start source:PROJECT.md -->
## Project

Amnezia Control Panel — unified admin panel for managing Amnezia AWG2 (AmneziaVPN WireGuard) and 3x-ui (Xray panel) on the same VPN server. Single administrator manages users across both systems, configures VPN services, controls routing, monitors traffic and health — all from one interface.

**Core Value:** One panel, both VPN systems — users synchronized between Amnezia AWG and 3x-ui, no context switching.

**Scale:** 1-3 servers, up to 50 users, single admin.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:STACK.md -->
## Technology Stack

Next.js 15 + React 19 + TypeScript + Prisma ORM + SQLite + Socket.io (WebSocket). Tailwind CSS for styling. Single-server deployment.
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

- Next.js App Router with API routes for backend
- Prisma + SQLite for data storage
- Direct shell access to Amnezia AWG and 3x-ui services
- WebSocket for real-time monitoring
- Single-server deployment, no microservices
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, or `.github/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` — do not edit manually.
<!-- GSD:profile-end -->
