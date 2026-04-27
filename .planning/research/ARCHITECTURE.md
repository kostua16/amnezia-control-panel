# Architecture Patterns

**Domain:** Web-based VPN admin control panel
**Researched:** 2026-04-27

## Recommended Architecture

Full-stack Next.js application with client-side React components and server-side API routes communicating directly with local VPN services.

```
┌─────────────────────────────────────────────────────────────┐
│                     Browser Client                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │   React     │  │   Zustand   │  │   React     │        │
│  │   Components │  │    Store    │  │   Query     │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
└─────────────────────────────────────────────────────────────┘
                              │ HTTP/WebSocket
┌─────────────────────────────────────────────────────────────┐
│                     Next.js Server                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │   API       │  │   Prisma    │  │   Shell     │        │
│  │   Routes    │  │  + SQLite   │  │   Commands  │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
│                               │                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │   Auth      │  │  Real-time  │  │   Config    │        │
│  │  (Supabase) │  │ (Socket.io) │  │   Writer    │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
└─────────────────────────────────────────────────────────────┘
                              │ Direct access
┌─────────────────────────────────────────────────────────────┐
│                   VPN Services (Local)                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │  Amnezia    │  │    3x-ui    │  │   System    │        │
│  │    AWG2     │  │   (Xray)    │  │   Resources │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

### Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| React Components | UI rendering, user interactions | Zustand store, React Query |
| Zustand Store | Frontend state management | React components |
| React Query | Server state, caching | API Routes, WebSocket |
| API Routes | VPN service communication | Shell commands, SQLite |
| Prisma ORM | Database operations | SQLite database |
| Shell Commands | Direct VPN service control | Amnezia CLI, 3x-ui CLI |
| WebSocket Handler | Real-time updates | Socket.io client |
| Auth Service | Admin authentication | Supabase Auth API |

### Data Flow

1. **User Action** → React Component → Zustand State Update
2. **Data Request** → React Query → API Route → Shell Command → VPN Service
3. **Response** → Shell Command → API Response → React Query Cache → UI Update
4. **Real-time Updates** → VPN Service Status → WebSocket → React Query → UI Update

## Patterns to Follow

### Pattern 1: Server-Client API Separation
**What:** Clear separation between frontend React components and backend API routes
**When:** All VPN operations require authentication and proper error handling
**Example:**
```typescript
// pages/api/users.ts
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  
  const users = await prisma.user.findMany()
  res.status(200).json(users)
}
```

### Pattern 2: State Management with Client Caching
**What:** Use React Query for all server data with automatic caching and background sync
**When:** User data, VPN configurations, service status changes
**Example:**
```typescript
const { data: users, error } = useQuery('users', () => 
  fetch('/api/users').then(res => res.json())
)
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Direct DOM Manipulation
**What:** Manipulating DOM elements directly from JavaScript instead of using React state
**Why bad:** Leads to unpredictable behavior, breaks component re-rendering
**Instead:** Use React state and props for all UI updates

### Anti-Pattern 2: Synchronous File Operations
**What:** Blocking the main thread with synchronous file I/O operations
**Why bad:** Poor user experience, UI freezes during VPN config operations
**Instead:** Use async/await and offload heavy operations to API routes

## Scalability Considerations

| Concern | At 100 users | At 10K users | At 1M users |
|---------|--------------|--------------|-------------|
| Database | SQLite with Prisma migrations | PostgreSQL with connection pooling | Distributed database with sharding |
| API Performance | Single Node.js instance sufficient | Load balancing, API gateway | Microservices architecture |
| Real-time Updates | Socket.io handles 100 connections | Redis pub/sub, message queue | Event streaming with Kafka |
| VPN Service Access | Direct shell commands | Remote API layer | VPN service proxy layer |

## Sources

- [Next.js Architecture Patterns](https://nextjs.org/docs/advanced-architecture) - HIGH confidence
- [React Query Best Practices](https://tanstack.com/query/latest/docs/framework/react/guides/overview) - HIGH confidence
- [Admin UI Component Design](https://blog.logrocket.com/admin-dashboard-design-patterns/) - MEDIUM confidence