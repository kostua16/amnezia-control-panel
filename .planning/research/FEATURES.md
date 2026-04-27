# Feature Landscape

**Domain:** Web-based VPN admin control panel
**Researched:** 2026-04-27

## Table Stakes

Features users expect. Missing = product feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| User management CRUD | Essential for admin operations | Medium | Create, delete, edit, view users across both systems |
| Service status monitoring | Critical for admin visibility | Low | Real-time on/off status of Amnezia and 3x-ui services |
| Configuration overview | Standard admin panel expectation | Low | View current VPN settings, ports, interfaces |
| Login authentication | Basic security requirement | Low | Single admin login with session management |
| Dashboard overview | Admin landing page expectation | Low | Quick view of key metrics, service status |
| Basic traffic stats | Expected for any VPN service | Medium | Simple data usage per user, basic charts |
| Server resource monitoring | Health monitoring standard | Low | CPU, RAM, disk usage display |

## Differentiators

Features that set product apart. Not expected, but valued.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Unified user sync | Seamless management across both systems | High | Automatic user synchronization between Amnezia and 3x-ui |
| Live traffic monitoring | Real-time view of active connections | High | WebSocket-based live updates of active VPN sessions |
| Smart routing rules | Intelligent traffic flow management | High | Configure routing based on user, protocol, or time |
| Automated failover | Service restart on failure | Medium | Auto-restart failed VPN services with notifications |
| Configuration templates | Quick setup for new users/servers | Medium | Pre-configured templates for common setups |
| Export/Import configs | Backup and migration support | Low | Save/load configurations for disaster recovery |

## Anti-Features

Features to explicitly NOT build.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Multi-tenant architecture | Overkill for single-server deployment | Keep single-server focus with simple scaling to 3 servers max |
| Complex RBAC | Admin-only panel, no user roles | Single admin authentication sufficient |
| Mobile app | Web-first approach with responsive design | Ensure mobile-friendly web interface |
| Billing integration | Not a commercial VPN service | Focus purely on technical management features |
| Plugin system | Adds unnecessary complexity | Build directly with the recommended stack |

## Feature Dependencies

```
User Management → Service Status Monitoring → Traffic Statistics
Configuration Editor → Service Management → User Sync
Real-time Monitoring → Dashboard Overview → Alert System
```

## MVP Recommendation

Prioritize:
1. User management CRUD (core admin functionality)
2. Service status monitoring (visibility)
3. Basic dashboard overview (UI foundation)

Defer: Real-time traffic monitoring - requires WebSocket setup and may need performance optimization at scale

## Sources

- [Admin Panel Design Patterns](https://uxdesign.cc/dashboard-design-patterns-5c889b7f4d07) - MEDIUM confidence
- [VPN Management Best Practices](https://www.privacyguides.org/en/vpn-providers/) - MEDIUM confidence