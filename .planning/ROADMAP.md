# Amnezia Control Panel Roadmap

**Phases:** 47
**Granularity:** Fine
**Coverage:** 42/42 requirements mapped ✓

## Phases

- [ ] **Phase 1.1: Project Initialization** - Initialize Next.js 15 project with TypeScript configuration
- [ ] **Phase 1.2: Core Dependencies** - Install React 19, Prisma, SQLite, and Socket.io
- [ ] **Phase 1.3: Database Schema Setup** - Initialize Prisma and create schema for users, services, configurations
- [ ] **Phase 1.4: Basic Project Structure** - Create directories (components, pages, api, lib) and base files
- [ ] **Phase 1.5: Dev Environment Setup** - Configure Tailwind CSS, ESLint, and start development server
- [ ] **Phase 1.6: Layout & Navigation** - Create main layout with header, sidebar navigation, and footer
- [ ] **Phase 1.7: Login Page UI** - Design and implement responsive login page with credentials form
- [ ] **Phase 2.1: Authentication Context** - Create React context for authentication state management
- [ ] **Phase 2.2: Login API Endpoint** - Build backend API for admin username/password authentication
- [ ] **Phase 2.3: Session Management** - Implement session creation and JWT token management
- [ ] **Phase 2.4: Protected Routes** - Create authentication guards for protected pages/routes
- [ ] **Phase 2.5: Logout Functionality** - Build logout endpoint and clear session on client
- [ ] **Phase 3.1: Service Status API** - Create API endpoints to check AWG and 3x-ui service status
- [ ] **Phase 3.2: Status Display Component** - Create component to show real-time service status indicators
- [ ] **Phase 3.3: Service Install API - AWG** - Build API to install Amnezia AWG service on server
- [ ] **Phase 3.4: Service Install API - 3x-ui** - Build API to install 3x-ui service on server
- [ ] **Phase 3.5: Service Uninstall APIs** - Build APIs to uninstall both VPN services
- [ ] **Phase 3.6: Auto-restart Logic** - Implement service monitoring with automatic restart and notifications
- [ ] **Phase 3.7: Configuration Display** - Create component to show current VPN configuration (ports, interfaces, DNS)
- [ ] **Phase 4.1: User Database Models** - Extend Prisma schema for users with limits and protocol assignments
- [ ] **Phase 4.2: User List Component** - Create admin view showing all users with status and services
- [ ] **Phase 4.3: User Creation Form** - Build form to create new users with name, limits, and protocol selection
- [ ] **Phase 4.4: User Creation API** - Create backend API to add users to both AWG and 3x-ui systems
- [ ] **Phase 4.5: User Edit Form** - Build form to edit user settings (name, limits, protocols)
- [ ] **Phase 4.6: User Edit API** - Create API to update users in both systems
- [ ] **Phase 4.7: User Delete API** - Create API to remove users from both AWG and 3x-ui
- [ ] **Phase 4.8: Block/Unblock APIs** - Build APIs to block and unblock users in both systems
- [ ] **Phase 4.9: User Sync System** - Implement background sync between AWG and 3x-ui user states
- [ ] **Phase 5.1: Configuration Templates** - Create template system for AWG and 3x-ui configurations
- [ ] **Phase 5.2: Protocol Templates** - Build WireGuard, AmneziaWG, VLESS, VMess, Trojan templates
- [ ] **Phase 5.3: Auto-gen Configuration API** - Create backend to generate configs with recommended settings
- [ ] **Phase 5.4: Export Configurations** - Build API to export all configurations for backup
- [ ] **Phase 5.5: Import Configurations** - Build API to import configurations for restore
- [ ] **Phase 5.6: Configuration Presets** - Create preset system for common deployment scenarios
- [ ] **Phase 5.7: Configuration Manager UI** - Create admin interface for managing configurations
- [ ] **Phase 6.1: Traffic Quotas System** - Build UI and API to set traffic quotas per user
- [ ] **Phase 6.2: Speed Limits System** - Build UI and API to set speed limits per user
- [ ] **Phase 6.3: Routing Rules API** - Create API for creating routing rules by user, protocol, time
- [ ] **Phase 6.4: Routing Rules UI** - Create admin interface to view, edit, and reorder routing rules
- [ ] **Phase 6.5: Rule Enforcement** - Implement routing rule application in VPN systems
- [ ] **Phase 7.1: Dashboard Metrics** - Create dashboard showing key metrics (users online, traffic, services)
- [ ] **Phase 7.2: Traffic Statistics API** - Build API for user traffic stats by time period
- [ ] **Phase 7.3: Stats Display UI** - Create UI to show traffic statistics per user
- [ ] **Phase 7.4: Resource Monitoring API** - Create API for CPU, RAM, disk usage monitoring
- [ ] **Phase 7.5: Resource Display UI** - Create dashboard component for server resource monitoring
- [ ] **Phase 7.6: Real-time Updates** - Implement WebSocket connection for live traffic monitoring
- [ ] **Phase 8.1: Multi-server Management** - Create system to add and manage multiple VPN servers
- [ ] **Phase 8.2: Server Configuration** - Build UI for configuring multiple server endpoints
- [ ] **Phase 8.3: Chain Templates System** - Create templates for 2-hop, 3-hop, and split-routing topologies
- [ ] **Phase 8.4: Auto-configure Routing** - Implement WireGuard/Xray routing rule auto-configuration
- [ ] **Phase 9.1: Visual Chain Builder** - Create drag-and-drop interface for VPN chain topologies
- [ ] **Phase 9.2: Geo-Routing Rules** - Implement routing based on destination geography
- [ ] **Phase 9.3: Whitelist Management** - Build interface for local/regional service whitelists per node
- [ ] **Phase 9.4: Live Chain Visualization** - Create real-time visualization with traffic flow indicators
- [ ] **Phase 10.1: Service Alert System** - Build alert notifications for VPN service failures
- [ ] **Phase 10.2: Quota Alert System** - Build alert notifications for traffic quota exceedances
- [ ] **Phase 10.3: Resource Alert System** - Build alert notifications for resource threshold alerts
- [ ] **Phase 10.4: UI Polish & Responsive Design** - Final styling, responsive design, and performance optimization

## Phase Details

### Phase 1.1: Project Initialization
**Goal**: Initialize Next.js 15 project with TypeScript configuration
**Depends on**: Nothing (first phase)
**Requirements**: None (infrastructure phase)
**Success Criteria** (what must be TRUE):
  1. Next.js 15 project created with TypeScript configuration
  2. Package.json includes all required dependencies
**Plans**: TBD
**UI hint**: yes

### Phase 1.2: Core Dependencies
**Goal**: Install React 19, Prisma, SQLite, and Socket.io
**Depends on**: Phase 1.1
**Requirements**: None (infrastructure phase)
**Success Criteria** (what must be TRUE):
  1. All dependencies installed and available in node_modules
  2. Dependencies properly configured in TypeScript config
**Plans**: TBD
**UI hint**: no

### Phase 1.3: Database Schema Setup
**Goal**: Initialize Prisma and create schema for users, services, configurations
**Depends on**: Phase 1.2
**Requirements**: None (infrastructure phase)
**Success Criteria** (what must be TRUE):
  1. Prisma schema created with models for users, services, configurations
  2. Database migration run successfully
  3. SQLite database file created with tables
**Plans**: TBD
**UI hint**: no

### Phase 1.4: Basic Project Structure
**Goal**: Create directories (components, pages, api, lib) and base files
**Depends on**: Phase 1.3
**Requirements**: None (infrastructure phase)
**Success Criteria** (what must be TRUE):
  1. Project structure organized with appropriate directories
  2. Base layout, page templates, and API route structure created
  3. TypeScript types defined
**Plans**: TBD
**UI hint**: yes

### Phase 1.5: Dev Environment Setup
**Goal**: Configure Tailwind CSS, ESLint, and start development server
**Depends on**: Phase 1.4
**Requirements**: None (infrastructure phase)
**Success Criteria** (what must be TRUE):
  1. Tailwind CSS configured with base styles
  2. ESLint configured with TypeScript rules
  3. Development server running successfully
  4. Basic page loads without errors
**Plans**: TBD
**UI hint**: yes

### Phase 1.6: Layout & Navigation
**Goal**: Create main layout with header, sidebar navigation, and footer
**Depends on**: Phase 1.5
**Requirements**: None (infrastructure phase)
**Success Criteria** (what must be TRUE):
  1. Main layout component with header, sidebar, and footer
  2. Navigation items defined for all main sections
  3. Responsive layout working on different screen sizes
**Plans**: TBD
**UI hint**: yes

### Phase 1.7: Login Page UI
**Goal**: Design and implement responsive login page with credentials form
**Depends on**: Phase 1.6
**Requirements**: None (infrastructure phase)
**Success Criteria** (what must be TRUE):
  1. Login page with username/password form
  2. Form validation for required fields
  3. Responsive design for mobile and desktop
  4. Login button with loading state
**Plans**: TBD
**UI hint**: yes

### Phase 2.1: Authentication Context
**Goal**: Create React context for authentication state management
**Depends on**: Phase 1.7
**Requirements**: None (infrastructure phase)
**Success Criteria** (what must be TRUE):
  1. Auth context provider with state for login status
  2. Methods for login, logout, and check auth status
  3. Context available to all components
**Plans**: TBD
**UI hint**: no

### Phase 2.2: Login API Endpoint
**Goal**: Build backend API for admin username/password authentication
**Depends on**: Phase 2.1
**Requirements**: AUTH-01
**Success Criteria** (what must be TRUE):
  1. API endpoint /api/auth/login created
  2. Username/password validation logic implemented
  3. JWT token generation for authenticated admin
**Plans**: TBD
**UI hint**: no

### Phase 2.3: Session Management
**Goal**: Implement session creation and JWT token management
**Depends on**: Phase 2.2
**Requirements**: AUTH-02
**Success Criteria** (what must be TRUE):
  1. Token stored in secure HTTP-only cookie
  2. Token persists across page refreshes
  3. Token validation middleware for protected routes
**Plans**: TBD
**UI hint**: no

### Phase 2.4: Protected Routes
**Goal**: Create authentication guards for protected pages/routes
**Depends on**: Phase 2.3
**Requirements**: None (infrastructure phase)
**Success Criteria** (what must be TRUE):
  1. Route protection implemented for admin pages
  2. Redirect to login if not authenticated
  3. Loading state while checking authentication
**Plans**: TBD
**UI hint**: no

### Phase 2.5: Logout Functionality
**Goal**: Build logout endpoint and clear session on client
**Depends on**: Phase 2.4
**Requirements**: AUTH-03
**Success Criteria** (what must be TRUE):
  1. API endpoint /api/auth/logout created
  2. Logout button in header that clears client session
  3. Redirect to login page after logout
**Plans**: TBD
**UI hint**: yes

### Phase 3.1: Service Status API
**Goal**: Create API endpoints to check AWG and 3x-ui service status
**Depends on**: Phase 2.5
**Requirements**: SERV-01, SERV-02
**Success Criteria** (what must be TRUE):
  1. API endpoint /api/services/awg/status to check Amnezia AWG service
  2. API endpoint /api/services/3x-ui/status to check 3x-ui service
  3. Both APIs return online/offline status with timestamp
**Plans**: TBD
**UI hint**: no

### Phase 3.2: Status Display Component
**Goal**: Create component to show real-time service status indicators
**Depends on**: Phase 3.1
**Requirements**: None (UI phase)
**Success Criteria** (what must be TRUE):
  1. Service status component with color indicators (green=online, red=offline)
  2. Status labels and refresh button
  3. Component updates when status changes
**Plans**: TBD
**UI hint**: yes

### Phase 3.3: Service Install API - AWG
**Goal**: Build API to install Amnezia AWG service on server
**Depends on**: Phase 3.2
**Requirements**: SERV-03
**Success Criteria** (what must be TRUE):
  1. API endpoint /api/services/awg/install created
  2. Installation script for Amnezia AWG service
  3. Returns installation status and error messages
**Plans**: TBD
**UI hint**: no

### Phase 3.4: Service Install API - 3x-ui
**Goal**: Build API to install 3x-ui service on server
**Depends on**: Phase 3.3
**Requirements**: SERV-04
**Success Criteria** (what must be TRUE):
  1. API endpoint /api/services/3x-ui/install created
  2. Installation script for 3x-ui service
  3. Returns installation status and error messages
**Plans**: TBD
**UI hint**: no

### Phase 3.5: Service Uninstall APIs
**Goal**: Build APIs to uninstall both VPN services
**Depends on**: Phase 3.4
**Requirements**: SERV-05, SERV-06
**Success Criteria** (what must be TRUE):
  1. API endpoint /api/services/awg/uninstall created
  2. API endpoint /api/services/3x-ui/uninstall created
  3. Both APIs return uninstall status and cleanup results
**Plans**: TBD
**UI hint**: no

### Phase 3.6: Auto-restart Logic
**Goal**: Implement service monitoring with automatic restart and notifications
**Depends on**: Phase 3.5
**Requirements**: SERV-07
**Success Criteria** (what must be TRUE):
  1. Background service monitoring logic
  2. Auto-restart when service goes down
  3. Notification system for service failures and restarts
**Plans**: TBD
**UI hint**: no

### Phase 3.7: Configuration Display
**Goal**: Create component to show current VPN configuration (ports, interfaces, DNS)
**Depends on**: Phase 3.6
**Requirements**: SERV-08
**Success Criteria** (what must be TRUE):
  1. Configuration display component for AWG settings
  2. Configuration display component for 3x-ui settings
  3. Shows ports, interfaces, DNS, and protocol settings
**Plans**: TBD
**UI hint**: yes

### Phase 4.1: User Database Models
**Goal**: Extend Prisma schema for users with limits and protocol assignments
**Depends on**: Phase 3.7
**Requirements**: None (infrastructure phase)
**Success Criteria** (what must be TRUE):
  1. User model extended with traffic limits, speed limits, protocol preferences
  2. Service relationship model for AWG and 3x-ui assignments
  3. Database migration updated and applied
**Plans**: TBD
**UI hint**: no

### Phase 4.2: User List Component
**Goal**: Create admin view showing all users with status and services
**Depends on**: Phase 4.1
**Requirements**: USER-06
**Success Criteria** (what must be TRUE):
  1. User list table showing all users
  2. Status indicators (active/blocked) for each user
  3. Assigned services (AWG, 3x-ui) displayed
**Plans**: TBD
**UI hint**: yes

### Phase 4.3: User Creation Form
**Goal**: Build form to create new users with name, limits, and protocol selection
**Depends on**: Phase 4.2
**Requirements**: USER-01
**Success Criteria** (what must be TRUE):
  1. Form component with fields for name, traffic limits, speed limits
  2. Protocol selection dropdown for VPN services
  3. Form validation and submission handling
**Plans**: TBD
**UI hint**: yes

### Phase 4.4: User Creation API
**Goal**: Create backend API to add users to both AWG and 3x-ui systems
**Depends on**: Phase 4.3
**Requirements**: USER-01
**Success Criteria** (what must be TRUE):
  1. API endpoint /api/users/create for creating users
  2. Logic to add user to both AWG and 3x-ui systems
  3. User created in database with correct limits
**Plans**: TBD
**UI hint**: no

### Phase 4.5: User Edit Form
**Goal**: Build form to edit user settings (name, limits, protocols)
**Depends on**: Phase 4.4
**Requirements**: USER-02
**Success Criteria** (what must be TRUE):
  1. Edit form component pre-filled with user data
  2. Fields for updating all user settings
  3. Update button with confirmation dialog
**Plans**: TBD
**UI hint**: yes

### Phase 4.6: User Edit API
**Goal**: Create API to update users in both systems
**Depends on**: Phase 4.5
**Requirements**: USER-02
**Success Criteria** (what must be TRUE):
  1. API endpoint /api/users/update for editing users
  2. Logic to update user in both AWG and 3x-ui
  3. Database record updated correctly
**Plans**: TBD
**UI hint**: no

### Phase 4.7: User Delete API
**Goal**: Create API to remove users from both AWG and 3x-ui
**Depends on**: Phase 4.6
**Requirements**: USER-03
**Success Criteria** (what must be TRUE):
  1. API endpoint /api/users/delete for removing users
  2. Logic to delete user from both systems
  3. Database record removed correctly
**Plans**: TBD
**UI hint**: no

### Phase 4.8: Block/Unblock APIs
**Goal**: Build APIs to block and unblock users in both systems
**Depends on**: Phase 4.7
**Requirements**: USER-04
**Success Criteria** (what must be TRUE):
  1. API endpoints for /api/users/block and /api/users/unblock
  2. Logic to manage blocked state in both systems
  3. User status updated in database
**Plans**: TBD
**UI hint**: no

### Phase 4.9: User Sync System
**Goal**: Implement background sync between AWG and 3x-ui user states
**Depends on**: Phase 4.8
**Requirements**: USER-05
**Success Criteria** (what must be TRUE):
  1. Background process for user state synchronization
  2. Handles changes in both systems to maintain consistency
  3. Sync status logging for troubleshooting
**Plans**: TBD
**UI hint**: no

### Phase 5.1: Configuration Templates
**Goal**: Create template system for AWG and 3x-ui configurations
**Depends on**: Phase 4.9
**Requirements**: CONF-01, CONF-02
**Success Criteria** (what must be TRUE):
  1. Template system for AWG configurations
  2. Template system for 3x-ui configurations
  3. Templates stored in database with placeholder variables
**Plans**: TBD
**UI hint**: no

### Phase 5.2: Protocol Templates
**Goal**: Build WireGuard, AmneziaWG, VLESS, VMess, Trojan templates
**Depends on**: Phase 5.1
**Requirements**: CONF-03, CONF-04
**Success Criteria** (what must be TRUE):
  1. Protocol templates for AWG (WireGuard, AmneziaWG)
  2. Protocol templates for 3x-ui (VLESS, VMess, Trojan, Shadowsocks)
  3. Templates include common presets and security settings
**Plans**: TBD
**UI hint**: no

### Phase 5.3: Auto-gen Configuration API
**Goal**: Create backend to generate configs with recommended settings
**Depends on**: Phase 5.2
**Requirements**: CONF-01, CONF-02
**Success Criteria** (what must be TRUE):
  1. API endpoint /api/configs/generate for auto-generation
  2. Logic to apply templates with user-specific values
  3. Returns generated configuration files
**Plans**: TBD
**UI hint**: no

### Phase 5.4: Export Configurations
**Goal**: Build API to export all configurations for backup
**Depends on**: Phase 5.3
**Requirements**: CONF-05
**Success Criteria** (what must be TRUE):
  1. API endpoint /api/configs/export to download all configs
  2. Configurations packaged in archive format
  3. Export includes metadata and timestamps
**Plans**: TBD
**UI hint**: no

### Phase 5.5: Import Configurations
**Goal**: Build API to import configurations for restore
**Depends on**: Phase 5.4
**Requirements**: CONF-06
**Success Criteria** (what must be TRUE):
  1. API endpoint /api/configs/upload to import configuration files
  2. Parser for various configuration formats
  3. Imports and validates configurations before application
**Plans**: TBD
**UI hint**: no

### Phase 5.6: Configuration Presets
**Goal**: Create preset system for common deployment scenarios
**Depends on**: Phase 5.5
**Requirements**: CONF-07
**Success Criteria** (what must be TRUE):
  1. Preset system for common deployment scenarios
  2. Pre-built configurations for home office, business, etc.
  3. Presets can be customized and applied
**Plans**: TBD
**UI hint**: no

### Phase 5.7: Configuration Manager UI
**Goal**: Create admin interface for managing configurations
**Depends on**: Phase 5.6
**Requirements**: None (UI phase)
**Success Criteria** (what must be TRUE):
  1. Configuration management interface with templates list
  2. Export/import buttons with file upload
  3. Preset selection and management
**Plans**: TBD
**UI hint**: yes

### Phase 6.1: Traffic Quotas System
**Goal**: Build UI and API to set traffic quotas per user
**Depends on**: Phase 5.7
**Requirements**: ROUTE-01
**Success Criteria** (what must be TRUE):
  1. UI component to set traffic quotas per user
  2. API endpoint to update user traffic quotas
  3. Quota limits enforced in VPN systems
**Plans**: TBD
**UI hint**: yes

### Phase 6.2: Speed Limits System
**Goal**: Build UI and API to set speed limits per user
**Depends on**: Phase 6.1
**Requirements**: ROUTE-02
**Success Criteria** (what must be TRUE):
  1. UI component to set speed limits per user
  2. API endpoint to update user speed limits
  3. Speed limits enforced in VPN systems
**Plans**: TBD
**UI hint**: yes

### Phase 6.3: Routing Rules API
**Goal**: Create API for creating routing rules by user, protocol, time
**Depends on**: Phase 6.2
**Requirements**: ROUTE-03
**Success Criteria** (what must be TRUE):
  1. API endpoints for managing routing rules
  2. Rules creation by user, protocol, or time schedule
  3. Rules stored in database with priority ordering
**Plans**: TBD
**UI hint**: no

### Phase 6.4: Routing Rules UI
**Goal**: Create admin interface to view, edit, and reorder routing rules
**Depends on**: Phase 6.3
**Requirements**: ROUTE-04
**Success Criteria** (what must be TRUE):
  1. UI to view all active routing rules
  2. Edit interface for rule parameters
  3. Drag-and-drop or buttons to reorder rules
**Plans**: TBD
**UI hint**: yes

### Phase 6.5: Rule Enforcement
**Goal**: Implement routing rule application in VPN systems
**Depends on**: Phase 6.4
**Requirements**: ROUTE-04
**Success Criteria** (what must be TRUE):
  1. Logic to apply routing rules to VPN configurations
  2. Rules applied to both AWG and 3x-ui systems
  3. Priority-based rule execution
**Plans**: TBD
**UI hint**: no

### Phase 7.1: Dashboard Metrics
**Goal**: Create dashboard showing key metrics (users online, traffic, services)
**Depends on**: Phase 6.5
**Requirements**: MON-01
**Success Criteria** (what must be TRUE):
  1. Dashboard with real-time metrics cards
  2. Users online counter with status
  3. Total traffic display with breakdown
  4. Service status overview widget
**Plans**: TBD
**UI hint**: yes

### Phase 7.2: Traffic Statistics API
**Goal**: Build API for user traffic stats by time period
**Depends on**: Phase 7.1
**Requirements**: MON-02
**Success Criteria** (what must be TRUE):
  1. API endpoints for traffic statistics by period
  2. Hourly, daily, weekly, monthly aggregation
  3. Per-user traffic data retrieval
**Plans**: TBD
**UI hint**: no

### Phase 7.3: Stats Display UI
**Goal**: Create UI to show traffic statistics per user
**Depends on**: Phase 7.2
**Requirements**: MON-02
**Success Criteria** (what must be TRUE):
  1. Traffic statistics table with time period selection
  2. Per-user breakdown with sortable columns
  3. Export functionality for statistics
**Plans**: TBD
**UI hint**: yes

### Phase 7.4: Resource Monitoring API
**Goal**: Create API for CPU, RAM, disk usage monitoring
**Depends on**: Phase 7.3
**Requirements**: MON-03
**Success Criteria** (what must be TRUE):
  1. API endpoints for server resource metrics
  2. CPU, RAM, disk usage collection
  3. Historical data storage and retrieval
**Plans**: TBD
**UI hint**: no

### Phase 7.5: Resource Display UI
**Goal**: Create dashboard component for server resource monitoring
**Depends on**: Phase 7.4
**Requirements**: MON-03
**Success Criteria** (what must be TRUE):
  1. Resource monitoring dashboard widget
  2. Charts for CPU, RAM, disk usage over time
  3. Threshold indicators for critical usage
**Plans**: TBD
**UI hint**: yes

### Phase 7.6: Real-time Updates
**Goal**: Implement WebSocket connection for live traffic monitoring
**Depends on**: Phase 7.5
**Requirements**: MON-04
**Success Criteria** (what must be TRUE):
  1. WebSocket connection established
  2. Real-time traffic updates received
  3. Dashboard auto-updates with new data
**Plans**: TBD
**UI hint**: yes

### Phase 8.1: Multi-server Management
**Goal**: Create system to add and manage multiple VPN servers
**Depends on**: Phase 7.6
**Requirements**: CHAIN-01
**Success Criteria** (what must be TRUE):
  1. Server management interface
  2. Add/remove server functionality
  3. Server connection testing and status
**Plans**: TBD
**UI hint**: yes

### Phase 8.2: Server Configuration
**Goal**: Build UI for configuring multiple server endpoints
**Depends on**: Phase 8.1
**Requirements**: None (UI phase)
**Success Criteria** (what must be TRUE):
  1. Server configuration form for each endpoint
  2. API key management for remote servers
  3. Save/apply configuration options
**Plans**: TBD
**UI hint**: yes

### Phase 8.3: Chain Templates System
**Goal**: Create templates for 2-hop, 3-hop, and split-routing topologies
**Depends on**: Phase 8.2
**Requirements**: CHAIN-06
**Success Criteria** (what must be TRUE):
  1. Template system for common chain topologies
  2. Pre-built templates for 2-hop, 3-hop, split-routing
  3. Template selection and customization
**Plans**: TBD
**UI hint**: no

### Phase 8.4: Auto-configure Routing
**Goal**: Implement WireGuard/Xray routing rule auto-configuration
**Depends on**: Phase 8.3
**Requirements**: CHAIN-03
**Success Criteria** (what must be TRUE):
  1. Auto-configuration logic for chain routing rules
  2. Rule generation for server-to-server connections
  3. Configuration applied to all chain nodes
**Plans**: TBD
**UI hint**: no

### Phase 9.1: Visual Chain Builder
**Goal**: Create drag-and-drop interface for VPN chain topologies
**Depends on**: Phase 8.4
**Requirements**: CHAIN-02
**Success Criteria** (what must be TRUE):
  1. Drag-and-drop chain builder interface
  2. Server nodes that can be connected visually
  3. Save/load chain configurations
**Plans**: TBD
**UI hint**: yes

### Phase 9.2: Geo-Routing Rules
**Goal**: Implement routing based on destination geography
**Depends on**: Phase 9.1
**Requirements**: CHAIN-04
**Success Criteria** (what must be TRUE):
  1. Geographic routing rule system
  2. Country/region-based traffic routing
  3. Rules applied to chain configurations
**Plans**: TBD
**UI hint**: no

### Phase 9.3: Whitelist Management
**Goal**: Build interface for local/regional service whitelists per node
**Depends on**: Phase 9.2
**Requirements**: CHAIN-05
**Success Criteria** (what must be TRUE):
  1. Whitelist management interface
  2. Add/remove services from whitelists
  3. Apply whitelists to chain nodes
**Plans**: TBD
**UI hint**: yes

### Phase 9.4: Live Chain Visualization
**Goal**: Create real-time visualization with traffic flow indicators
**Depends on**: Phase 9.3
**Requirements**: CHAIN-07
**Success Criteria** (what must be TRUE):
  1. Live chain visualization widget
  2. Traffic flow indicators showing active connections
  3. Real-time updates for traffic volume and latency
**Plans**: TBD
**UI hint**: yes

### Phase 10.1: Service Alert System
**Goal**: Build alert notifications for VPN service failures
**Depends on**: Phase 9.4
**Requirements**: ALERT-01
**Success Criteria** (what must be TRUE):
  1. Alert notification system for service failures
  2. In-app alerts with clear recovery actions
  3. Alert history and management interface
**Plans**: TBD
**UI hint**: yes

### Phase 10.2: Quota Alert System
**Goal**: Build alert notifications for traffic quota exceedances
**Depends on**: Phase 10.1
**Requirements**: ALERT-02
**Success Criteria** (what must be TRUE):
  1. Alert notifications for traffic quota thresholds
  2. Configurable threshold percentages (80%, 90%, 100%)
  3. User-specific quota alert management
**Plans**: TBD
**UI hint**: yes

### Phase 10.3: Resource Alert System
**Goal**: Build alert notifications for resource threshold alerts
**Depends on**: Phase 10.2
**Requirements**: ALERT-03
**Success Criteria** (what must be TRUE):
  1. Alert notifications for resource usage thresholds
  2. Configurable CPU, RAM, disk limits
  3. Alert history and escalation settings
**Plans**: TBD
**UI hint**: yes

### Phase 10.4: UI Polish & Responsive Design
**Goal**: Final styling, responsive design, and performance optimization
**Depends on**: Phase 10.3
**Requirements**: None (polish phase)
**Success Criteria** (what must be TRUE):
  1. Consistent styling across all components
  2. Mobile-responsive design for all pages
  3. Performance optimizations and loading states
  4. Final testing and bug fixes
**Plans**: TBD
**UI hint**: yes

## Progress Table

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1.1 - Project Initialization | 0/1 | Not started | - |
| 1.2 - Core Dependencies | 0/1 | Not started | - |
| 1.3 - Database Schema Setup | 0/1 | Not started | - |
| 1.4 - Basic Project Structure | 0/1 | Not started | - |
| 1.5 - Dev Environment Setup | 0/1 | Not started | - |
| 1.6 - Layout & Navigation | 0/1 | Not started | - |
| 1.7 - Login Page UI | 0/1 | Not started | - |
| 2.1 - Authentication Context | 0/1 | Not started | - |
| 2.2 - Login API Endpoint | 0/1 | Not started | - |
| 2.3 - Session Management | 0/1 | Not started | - |
| 2.4 - Protected Routes | 0/1 | Not started | - |
| 2.5 - Logout Functionality | 0/1 | Not started | - |
| 3.1 - Service Status API | 0/1 | Not started | - |
| 3.2 - Status Display Component | 0/1 | Not started | - |
| 3.3 - Service Install API - AWG | 0/1 | Not started | - |
| 3.4 - Service Install API - 3x-ui | 0/1 | Not started | - |
| 3.5 - Service Uninstall APIs | 0/1 | Not started | - |
| 3.6 - Auto-restart Logic | 0/1 | Not started | - |
| 3.7 - Configuration Display | 0/1 | Not started | - |
| 4.1 - User Database Models | 0/1 | Not started | - |
| 4.2 - User List Component | 0/1 | Not started | - |
| 4.3 - User Creation Form | 0/1 | Not started | - |
| 4.4 - User Creation API | 0/1 | Not started | - |
| 4.5 - User Edit Form | 0/1 | Not started | - |
| 4.6 - User Edit API | 0/1 | Not started | - |
| 4.7 - User Delete API | 0/1 | Not started | - |
| 4.8 - Block/Unblock APIs | 0/1 | Not started | - |
| 4.9 - User Sync System | 0/1 | Not started | - |
| 5.1 - Configuration Templates | 0/1 | Not started | - |
| 5.2 - Protocol Templates | 0/1 | Not started | - |
| 5.3 - Auto-gen Configuration API | 0/1 | Not started | - |
| 5.4 - Export Configurations | 0/1 | Not started | - |
| 5.5 - Import Configurations | 0/1 | Not started | - |
| 5.6 - Configuration Presets | 0/1 | Not started | - |
| 5.7 - Configuration Manager UI | 0/1 | Not started | - |
| 6.1 - Traffic Quotas System | 0/1 | Not started | - |
| 6.2 - Speed Limits System | 0/1 | Not started | - |
| 6.3 - Routing Rules API | 0/1 | Not started | - |
| 6.4 - Routing Rules UI | 0/1 | Not started | - |
| 6.5 - Rule Enforcement | 0/1 | Not started | - |
| 7.1 - Dashboard Metrics | 0/1 | Not started | - |
| 7.2 - Traffic Statistics API | 0/1 | Not started | - |
| 7.3 - Stats Display UI | 0/1 | Not started | - |
| 7.4 - Resource Monitoring API | 0/1 | Not started | - |
| 7.5 - Resource Display UI | 0/1 | Not started | - |
| 7.6 - Real-time Updates | 0/1 | Not started | - |
| 8.1 - Multi-server Management | 0/1 | Not started | - |
| 8.2 - Server Configuration | 0/1 | Not started | - |
| 8.3 - Chain Templates System | 0/1 | Not started | - |
| 8.4 - Auto-configure Routing | 0/1 | Not started | - |
| 9.1 - Visual Chain Builder | 0/1 | Not started | - |
| 9.2 - Geo-Routing Rules | 0/1 | Not started | - |
| 9.3 - Whitelist Management | 0/1 | Not started | - |
| 9.4 - Live Chain Visualization | 0/1 | Not started | - |
| 10.1 - Service Alert System | 0/1 | Not started | - |
| 10.2 - Quota Alert System | 0/1 | Not started | - |
| 10.3 - Resource Alert System | 0/1 | Not started | - |
| 10.4 - UI Polish & Responsive Design | 0/1 | Not started | - |

## Success Criteria Preview

**Phase 1.1: Project Initialization**
1. Next.js 15 project created with TypeScript configuration

**Phase 1.2: Core Dependencies**
1. All dependencies installed and available in node_modules

**Phase 1.3: Database Schema Setup**
1. Prisma schema created with models for users, services, configurations

**Phase 1.4: Basic Project Structure**
1. Project structure organized with appropriate directories

**Phase 1.5: Dev Environment Setup**
1. Development server running successfully

**Phase 1.6: Layout & Navigation**
1. Main layout component with header, sidebar, and footer

**Phase 1.7: Login Page UI**
1. Login page with username/password form

**Phase 2.1: Authentication Context**
1. Auth context provider with state for login status

**Phase 2.2: Login API Endpoint**
1. API endpoint /api/auth/login created

**Phase 2.3: Session Management**
1. Token stored in secure HTTP-only cookie

**Phase 2.4: Protected Routes**
1. Route protection implemented for admin pages

**Phase 2.5: Logout Functionality**
1. Logout button in header that clears client session

**Phase 3.1: Service Status API**
1. API endpoint /api/services/awg/status to check Amnezia AWG service

**Phase 3.2: Status Display Component**
1. Service status component with color indicators

**Phase 3.3: Service Install API - AWG**
1. API endpoint /api/services/awg/install created

**Phase 3.4: Service Install API - 3x-ui**
1. API endpoint /api/services/3x-ui/install created

**Phase 3.5: Service Uninstall APIs**
1. API endpoint /api/services/awg/uninstall created

**Phase 3.6: Auto-restart Logic**
1. Background service monitoring logic

**Phase 3.7: Configuration Display**
1. Configuration display component for AWG settings

**Phase 4.1: User Database Models**
1. User model extended with traffic limits, speed limits, protocol preferences

**Phase 4.2: User List Component**
1. User list table showing all users

**Phase 4.3: User Creation Form**
1. Form component with fields for name, traffic limits, speed limits

**Phase 4.4: User Creation API**
1. API endpoint /api/users/create for creating users

**Phase 4.5: User Edit Form**
1. Edit form component pre-filled with user data

**Phase 4.6: User Edit API**
1. API endpoint /api/users/update for editing users

**Phase 4.7: User Delete API**
1. API endpoint /api/users/delete for removing users

**Phase 4.8: Block/Unblock APIs**
1. API endpoints for /api/users/block and /api/users/unblock

**Phase 4.9: User Sync System**
1. Background process for user state synchronization

**Phase 5.1: Configuration Templates**
1. Template system for AWG configurations

**Phase 5.2: Protocol Templates**
1. Protocol templates for AWG (WireGuard, AmneziaWG)

**Phase 5.3: Auto-gen Configuration API**
1. API endpoint /api/configs/generate for auto-generation

**Phase 5.4: Export Configurations**
1. API endpoint /api/configs/export to download all configs

**Phase 5.5: Import Configurations**
1. API endpoint /api/configs/upload to import configuration files

**Phase 5.6: Configuration Presets**
1. Preset system for common deployment scenarios

**Phase 5.7: Configuration Manager UI**
1. Configuration management interface with templates list

**Phase 6.1: Traffic Quotas System**
1. UI component to set traffic quotas per user

**Phase 6.2: Speed Limits System**
1. UI component to set speed limits per user

**Phase 6.3: Routing Rules API**
1. API endpoints for managing routing rules

**Phase 6.4: Routing Rules UI**
1. UI to view all active routing rules

**Phase 6.5: Rule Enforcement**
1. Logic to apply routing rules to VPN configurations

**Phase 7.1: Dashboard Metrics**
1. Dashboard with real-time metrics cards

**Phase 7.2: Traffic Statistics API**
1. API endpoints for traffic statistics by period

**Phase 7.3: Stats Display UI**
1. Traffic statistics table with time period selection

**Phase 7.4: Resource Monitoring API**
1. API endpoints for server resource metrics

**Phase 7.5: Resource Display UI**
1. Resource monitoring dashboard widget

**Phase 7.6: Real-time Updates**
1. WebSocket connection established

**Phase 8.1: Multi-server Management**
1. Server management interface

**Phase 8.2: Server Configuration**
1. Server configuration form for each endpoint

**Phase 8.3: Chain Templates System**
1. Template system for common chain topologies

**Phase 8.4: Auto-configure Routing**
1. Auto-configuration logic for chain routing rules

**Phase 9.1: Visual Chain Builder**
1. Drag-and-drop chain builder interface

**Phase 9.2: Geo-Routing Rules**
1. Geographic routing rule system

**Phase 9.3: Whitelist Management**
1. Whitelist management interface

**Phase 9.4: Live Chain Visualization**
1. Live chain visualization widget

**Phase 10.1: Service Alert System**
1. Alert notification system for service failures

**Phase 10.2: Quota Alert System**
1. Alert notifications for traffic quota thresholds

**Phase 10.3: Resource Alert System**
1. Alert notifications for resource usage thresholds

**Phase 10.4: UI Polish & Responsive Design**
1. Consistent styling across all components

## Coverage

✓ All 42 v1 requirements mapped
✓ No orphaned requirements

### Requirement Mapping

| Phase | Requirements |
|-------|--------------|
| 2.2 - Login API Endpoint | AUTH-01 |
| 2.3 - Session Management | AUTH-02 |
| 2.5 - Logout Functionality | AUTH-03 |
| 3.1 - Service Status API | SERV-01, SERV-02 |
| 3.3 - Service Install API - AWG | SERV-03 |
| 3.4 - Service Install API - 3x-ui | SERV-04 |
| 3.5 - Service Uninstall APIs | SERV-05, SERV-06 |
| 3.6 - Auto-restart Logic | SERV-07 |
| 3.7 - Configuration Display | SERV-08 |
| 4.1 - User Database Models | None (infrastructure) |
| 4.2 - User List Component | USER-06 |
| 4.3 - User Creation Form | USER-01 |
| 4.4 - User Creation API | USER-01 |
| 4.5 - User Edit Form | USER-02 |
| 4.6 - User Edit API | USER-02 |
| 4.7 - User Delete API | USER-03 |
| 4.8 - Block/Unblock APIs | USER-04 |
| 4.9 - User Sync System | USER-05 |
| 5.1 - Configuration Templates | CONF-01, CONF-02 |
| 5.2 - Protocol Templates | CONF-03, CONF-04 |
| 5.3 - Auto-gen Configuration API | CONF-01, CONF-02 |
| 5.4 - Export Configurations | CONF-05 |
| 5.5 - Import Configurations | CONF-06 |
| 5.6 - Configuration Presets | CONF-07 |
| 6.1 - Traffic Quotas System | ROUTE-01 |
| 6.2 - Speed Limits System | ROUTE-02 |
| 6.3 - Routing Rules API | ROUTE-03 |
| 6.4 - Routing Rules UI | ROUTE-04 |
| 6.5 - Rule Enforcement | ROUTE-04 |
| 7.1 - Dashboard Metrics | MON-01 |
| 7.2 - Traffic Statistics API | MON-02 |
| 7.3 - Stats Display UI | MON-02 |
| 7.4 - Resource Monitoring API | MON-03 |
| 7.5 - Resource Display UI | MON-03 |
| 7.6 - Real-time Updates | MON-04 |
| 8.1 - Multi-server Management | CHAIN-01 |
| 8.3 - Chain Templates System | CHAIN-06 |
| 8.4 - Auto-configure Routing | CHAIN-03 |
| 9.1 - Visual Chain Builder | CHAIN-02 |
| 9.2 - Geo-Routing Rules | CHAIN-04 |
| 9.3 - Whitelist Management | CHAIN-05 |
| 9.4 - Live Chain Visualization | CHAIN-07 |
| 10.1 - Service Alert System | ALERT-01 |
| 10.2 - Quota Alert System | ALERT-02 |
| 10.3 - Resource Alert System | ALERT-03 |

---

*Roadmap created: 2026-04-27*
*Last updated: 2026-04-27 - Phases broken into smaller 10-minute tasks*