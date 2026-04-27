# Project Research Summary

**Project:** Amnezia Control Panel
**Domain:** VPN Management System
**Researched:** 2026-04-27
**Confidence:** HIGH

## Executive Summary

The Amnezia Control Panel is a web-based administrative interface for managing VPN services, specifically Amnezia WG and 3x-ui on a single Linux server. Based on research, experts build this type of system using Next.js 15 with React 19 for the full-stack implementation, leveraging server-side rendering and API routes for backend operations. The recommended approach uses a monolithic architecture with direct shell access to VPN services, SQLite for data storage at the 50-user scale, and real-time monitoring via WebSocket connections. Key risks include user synchronization failures between VPN systems, WireGuard configuration errors, and API integration fragility with third-party services, all of which can be mitigated through transaction-based operations, comprehensive validation, and robust error handling.

## Key Findings

### Recommended Stack

**Core technologies:**
- **Next.js 15** — Full-stack framework providing SSR and API routes for VPN service management — chosen for its built-in capabilities eliminating need for separate backend
- **React 19** — UI library for component-based admin interface with hooks for state management — modern features enable better user experience
- **TypeScript 5.5+** — Type system for static checking of VPN configurations and API responses — critical for preventing configuration errors
- **Zustand & React Query** — Lightweight state management with server state caching — optimal performance for admin operations at scale
- **SQLite + Prisma** — Simple database with type-safe ORM for 50-user scale — easier deployment than PostgreSQL at this size
- **Socket.io** — Real-time updates for service status monitoring — handles reconnection better than alternatives

### Expected Features

**Must have (table stakes):**
- User management CRUD — essential for admin operations across both systems
- Service status monitoring — critical visibility into VPN service health
- Basic dashboard overview — standard expectation for admin interfaces
- Login authentication — basic security requirement
- Configuration overview — standard admin panel expectation

**Should have (competitive):**
- Unified user sync — seamless management across Amnezia and 3x-ui
- Live traffic monitoring — real-time view of active connections
- Automated failover — automatic service restart on failure
- Configuration templates — quick setup for common configurations

**Defer (v2+):**
- Real-time traffic monitoring — requires WebSocket optimization at scale
- Smart routing rules — intelligent traffic flow management
- Multi-server support — beyond initial 3-server scope

### Architecture Approach

The system follows a full-stack Next.js architecture with clear separation between client React components and server API routes. API routes communicate directly with VPN services via shell commands, using Prisma for database operations and Socket.io for real-time updates. The architecture emphasizes server-client separation, uses client-side caching for all server data, and avoids direct DOM manipulation or synchronous file operations.

**Major components:**
1. **React Components** — UI rendering and user interactions
2. **API Routes** — VPN service communication and business logic
3. **Prisma ORM** — Type-safe database operations with SQLite

### Critical Pitfalls

1. **User Synchronization Between Systems** — Implement transaction-based sync with rollback and unique identifiers to prevent conflicting user databases
2. **WireGuard/AmneziaWG Protocol Implementation Errors** — Always validate configurations, maintain templates with validation, and implement dry-run mode
3. **3x-ui API Integration Fragility** — Add API compatibility layer, comprehensive error handling, and monitor for breaking changes
4. **Traffic Monitoring Inaccuracy** — Monitor at multiple points, implement discrepancy alerts, and account for protocol overhead
5. **Installation Automation Failures** — Make scripts idempotent, add pre-flight checks, and create rollback mechanisms

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Core Infrastructure
**Rationale:** Must establish foundational services and authentication before building management features
**Delivers:** Basic installation, authentication, and service status monitoring
**Addresses:** Table stakes features (login, service status)
**Avoids:** Installation automation failures through idempotent scripts and rollback capabilities

### Phase 2: User Management & Service Integration
**Rationale:** User management is core admin functionality and depends on working service integration
**Delivers:** CRUD operations for users across both systems with unified sync
**Uses:** Next.js API routes, Prisma ORM, ShellJS for CLI commands
**Implements:** API route pattern with server-client separation

### Phase 3: Monitoring & Analytics
**Rationale:** Requires working user and service systems to provide meaningful monitoring
**Delivers:** Real-time service status, traffic statistics, and health monitoring
**Uses:** Socket.io for real-time updates, Chart.js for visualization
**Implements:** WebSocket pattern with optimistic UI updates

### Phase 4: Advanced Features
**Rationale:** Builds on established foundation to add advanced automation and management
**Delivers:** Configuration templates, automated failover, export/import capabilities
**Uses:** Existing state management and API infrastructure
**Implements:** Smart configuration management with validation

### Phase Ordering Rationale

- **Dependency chain**: User management → Service integration → Monitoring → Advanced features
- **Architecture grouping**: Core infrastructure → User data → Real-time updates → Complex automation
- **Risk mitigation**: Early implementation of service health checks prevents cascade failures; transactional sync prevents data corruption

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2:** User synchronization between systems — complex integration needs API research
- **Phase 3:** Real-time traffic monitoring — WebSocket performance optimization required at scale

Phases with standard patterns (skip research-phase):
- **Phase 1:** Installation scripts — well-documented, established patterns in devops
- **Phase 4:** Configuration management — standard admin panel features

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All technologies verified with official documentation and widely used patterns |
| Features | MEDIUM | Based on admin panel design patterns but VPN-specific domain limited |
| Architecture | HIGH | Next.js and React patterns well-documented with clear examples |
| Pitfalls | MEDIUM | Domain expertise from VPN management best practices but some inference required |

**Overall confidence:** HIGH

### Gaps to Address

- **3x-ui API specifics**: API documentation lacks comprehensive examples, need hands-on validation during development
- **WireGuard configuration validation**: Need to identify specific validation rules for AmneziaWG extensions
- **Performance at scale**: Testing needed to confirm SQLite + Next.js can handle 50+ concurrent operations

## Sources

### Primary (HIGH confidence)
- [Next.js Documentation](https://nextjs.org/docs) — API routes patterns and architecture
- [React Query Best Practices](https://tanstack.com/query/latest/docs/framework/react/guides/overview) — Server state management patterns
- [Prisma Documentation](https://prisma.io/docs) — Database operations and migrations
- [Supabase Auth Documentation](https://supabase.com/docs/guides/auth) — Authentication implementation

### Secondary (MEDIUM confidence)
- [Admin Panel Design Patterns](https://uxdesign.cc/dashboard-design-patterns-5c889b7f4d07) — UI/UX for management interfaces
- [VPN Management Best Practices](https://www.privacyguides.org/en/vpn-providers/) — Domain-specific operational patterns

### Tertiary (LOW confidence)
- [VPN Admin Panel Patterns](https://github.com/topics/vpn-admin-panel) — Community patterns for VPN management
---
*Research completed: 2026-04-27*
*Ready for roadmap: yes*