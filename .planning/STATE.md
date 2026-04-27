---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: unknown
last_updated: "2026-04-27T20:29:20.519Z"
progress:
  total_phases: 58
  completed_phases: 0
  total_plans: 1
  completed_plans: 0
  percent: 0
---

# Amnezia Control Panel - Project State

## Project Reference

**Project**: Amnezia Control Panel  
**Core Value**: One panel, both VPN systems — users synchronized between Amnezia AWG and 3x-ui, no context switching  
**Current Focus**: Phase 1.2 - Core Dependencies
**Current Position**: Phase 1.2 planned, ready to execute

## Current Position

**Phase**: 1.2 - Core Dependencies
**Plan**: 1 plan in 1 wave (01.2-PLAN.md)
**Status**: Ready to execute
**Progress**: 0/47 phases complete (0%)
**Progress Bar**: [                                        ] 0%
**Resume file**: `.planning/phases/01.2-core-dependencies/01.2-PLAN.md`

## Performance Metrics

- **Requirements Coverage**: 42/42 ✓ (100%)
- **Research Confidence**: HIGH
- **Stack Readiness**: Next.js 15, React 19, TypeScript, Prisma, SQLite
- **Risk Areas**: User synchronization between systems, WireGuard configuration validation

## Accumulated Context

### Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Deploy on same server as VPN services | Simplifies management, no remote API needed for local services | — Logged in PROJECT.md |
| Single admin, no roles | Small scale, single operator | — Logged in PROJECT.md |
| Stack: Next.js 15 + React 19 + TypeScript | Full-stack framework with SSR and API routes, optimal for admin interface | — Logged in research/SUMMARY.md |
| 10-minute phase structure | Break down complex features into focused tasks for steady progress | — Applied in roadmap revision |

### Project Structure

```
amnezia-control-panel/
├── .planning/
│   ├── PROJECT.md          # Project context and evolution
│   ├── REQUIREMENTS.md     # Feature requirements and traceability
│   ├── research/
│   │   └── SUMMARY.md      # Research findings and recommendations
│   ├── config.json         # Project configuration
│   ├── ROADMAP.md          # Current roadmap (this file)
│   └── STATE.md            # Current project state (this file)
├── src/
│   ├── app/                # Next.js 15 app directory
│   ├── components/         # React components
│   ├── lib/                # Utility libraries and configurations
│   └── prisma/             # Database schema and migrations
└── public/                 # Static assets
```

### Research Insights

1. **Critical Technical Details**:
   - Next.js 15 with React 19 provides full-stack capabilities with API routes
   - Prisma ORM with SQLite sufficient for 50-user scale
   - Socket.io for real-time monitoring connections
   - ShellJS for direct CLI communication with VPN services

2. **Major Risks & Mitigations**:
   - User sync failures: Transaction-based operations with rollback
   - WireGuard config errors: Template validation + dry-run mode
   - 3x-ui API fragility: Compatibility layer with error handling

3. **Phase Dependencies**:
   - Phase 1.1 → 1.2 → ... → 10.4: Sequential with dependency chain
   - Each phase approximately 10 minutes of focused work
   - UI phases marked with "UI hint: yes" for proper tooling

### Outstanding Questions

1. **Authentication Stack**: Will use NextAuth.js or Supabase Auth?
   - Initial decision: NextAuth.js for tighter integration with Next.js ecosystem
   
2. **State Management**: React Query + Zustand or alternative?
   - Initial decision: React Query for server state, Zustand for client state

3. **VPN Service Communication**: Direct shell commands or API abstraction?
   - Initial decision: Shell commands with validation layer for reliability

### Known Technical Constraints

1. **Deployment**: Must work alongside existing Amnezia and 3x-ui installations
2. **Scale**: 1-3 servers, up to 50 users, single admin
3. **OS**: Linux server environment
4. **Dependencies**: Cannot modify existing VPN configurations during setup
5. **Phase Size**: Each phase should complete in ~10 minutes

### Todo Items

- [ ] Initialize Next.js 15 project with TypeScript configuration
- [ ] Install React 19, Prisma, SQLite, and Socket.io dependencies
- [ ] Set up Prisma schema for users, services, configurations
- [ ] Create project structure with directories (components, pages, api, lib)
- [ ] Configure Tailwind CSS, ESLint, and start development server
- [ ] Create main layout with header, sidebar navigation, and footer
- [ ] Design and implement responsive login page with credentials form

### Blockers

None at project initialization.

## Session Continuity

This state document will be updated:

- After each phase transition (via `/gsd-transition`)
- After milestone completion (via `/gsd-complete-milestone`)
- When significant decisions are made
- When risks are identified or mitigated

---

*State initialized: 2026-04-27*  
*Last updated: 2026-04-27 - Phases broken into smaller 10-minute tasks*  
*Next action: Begin Phase 1.1 implementation*
