# Amnezia Control Panel — Gemini Project Context

## Project

Amnezia Control Panel — unified admin panel for managing Amnezia AWG2
and 3x-ui on the same VPN server.

## Technology Stack

Next.js 15 + React 19 + TypeScript + Prisma ORM + SQLite + Socket.io.
Tailwind CSS for styling. Single-server deployment.

## Conventions

- Use TypeScript for new files
- Follow existing code patterns
- Ensure tests for new functionality
- Use conventional commits

## Architecture

- Next.js App Router with API routes for backend
- Prisma + SQLite for data storage
- Direct shell access to Amnezia AWG and 3x-ui services
- WebSocket for real-time monitoring
