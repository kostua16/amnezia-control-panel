# Technology Stack

**Project:** Amnezia Control Panel
**Researched:** 2026-04-27

## Recommended Stack

### Core Framework
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Next.js 15 | 15.0.0+ | Full-stack React framework | Server-side rendering for admin panel, API routes for backend services, TypeScript support for type safety |
| React 19 | 19.0.0+ | UI library | Component-based architecture for admin interface, hooks for state management |
| TypeScript | 5.5+ | Type system | Static type checking for VPN configurations, API responses, and database models |

### Styling & UI
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Tailwind CSS | 3.4+ | Utility-first CSS | Rapid development of admin dashboard, responsive design, consistent styling |
| Headless UI | 2.1+ | Accessible UI components | Pre-built components for forms, tables, modals needed for admin panel |
| Flowbite | 2.4+ | Component library | Integration with Tailwind, ready-to-use admin components |

### State Management
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Zustand | 5.0+ | State management | Lightweight alternative to Redux, perfect for admin panel state, auto-subscriptions |
| React Query | 5.0+ | Data fetching | Server state management for VPN configurations and user data, caching and background sync |

### Backend/API Layer
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Next.js API Routes | 15.0.0+ | API endpoints | Built-in API routes for VPN service management, no separate backend server needed |
| Node.js | 20.x+ | Runtime | Next.js runtime, sufficient for VPN API operations at 50-user scale |

### Database & Storage
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| SQLite | 3.45+ | Local database | Simple file-based storage for 50-user scale, easy backup, minimal setup |
| Prisma | 5.8+ | ORM | Type-safe database access, migrations, schema management for user data |
| Supabase Auth | 2.39+ | Authentication | Built-in auth system for admin login, session management |

### VPN Integration Layer
| Technology | Version | Purpose | When to Use |
|------------|---------|---------|-------------|
| ShellJS | 0.9.0+ | Shell execution | Running Amnezia and 3x-ui CLI commands on server |
| Axios | 1.6+ | HTTP client | API calls to local VPN services, status monitoring |
| SSH2 | 1.16+ | SSH connection | Remote management of multiple VPN servers |

### Monitoring & Real-time
| Technology | Version | Purpose | When to Use |
|------------|---------|---------|-------------|
| Socket.io | 4.7+ | WebSockets | Real-time service status updates, live traffic monitoring |
| Chart.js | 4.4+ | Charts | Visualizing traffic statistics, server metrics |
| Docker | 24.0+ | Containerization | Optional containerization for deployment isolation |

### Dev & Build Tools
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Vite | 5.2+ | Build tool | Fast development server, optimized builds for Next.js apps |
| ESLint | 9.0+ | Linting | Code quality, consistency across VPN management code |
| Prettier | 3.2+ | Formatting | Code formatting for team consistency |

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Full-stack framework | Next.js | Nuxt.js | Next.js has better API routes integration for VPN services |
| State management | Zustand | Redux | Too heavy for admin panel, Zustand is simpler and faster |
| Database | SQLite | PostgreSQL | Overkill for 50 users, SQLite simpler with Prisma |
| Styling | Tailwind CSS | Bootstrap | Tailwind is more modern, better for custom admin dashboards |
| WebSocket | Socket.io | Server-Sent Events | Socket.io handles reconnection better for real-time status |

## Installation

```bash
# Core framework
npm install next@latest react@latest react-dom@latest typescript@latest

# Styling
npm install -D tailwindcss postcss autoprefixer
npm install headlessui flowbite

# State management
npm install zustand react-query

# Database
npm install prisma @prisma/client
npm install -D @types/sqlite

# API integration
npm install axios ssh2 shelljs

# Monitoring
npm install socket.io chart.js

# Dev tools
npm install -D eslint prettier vite
```

```bash
# Initialize Prisma
npx prisma init

# Configure Tailwind
npx tailwindcss init
```

## Architecture Notes

### Deployment Considerations
- Runs on same server as VPN services (direct shell access)
- Node.js runtime sufficient for 50-user scale
- SQLite handles concurrent access for admin operations
- Docker optional for containerized deployment

### VPN Service Communication
- Direct shell access to Amnezia and 3x-ui CLI commands
- File-based configuration reading and writing
- Real-time monitoring via process status checks

### Security
- Single admin authentication via Supabase Auth
- No need for complex RBAC (single admin constraint)
- Local deployment reduces external attack surface

## Sources

- [Next.js Documentation](https://nextjs.org/docs) - HIGH confidence
- [Tailwind CSS Documentation](https://tailwindcss.com/docs) - HIGH confidence
- [Prisma Documentation](https://prisma.io/docs) - HIGH confidence
- [Supabase Auth Documentation](https://supabase.com/docs/guides/auth) - HIGH confidence
- [VPN Admin Panel Patterns](https://github.com/topics/vpn-admin-panel) - MEDIUM confidence