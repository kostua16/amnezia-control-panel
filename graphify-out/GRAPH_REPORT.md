# Graph Report - .  (2026-06-11)

## Corpus Check
- 293 files · ~116,121 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1393 nodes · 2861 edges · 101 communities (91 shown, 10 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 77 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Batch & Config API|Batch & Config API]]
- [[_COMMUNITY_Chain Presets & Import|Chain Presets & Import]]
- [[_COMMUNITY_Dashboard Fleet UI|Dashboard Fleet UI]]
- [[_COMMUNITY_Dashboard Metrics Panels|Dashboard Metrics Panels]]
- [[_COMMUNITY_Tailscale Route Advertise|Tailscale Route Advertise]]
- [[_COMMUNITY_GeoIP Lookup|GeoIP Lookup]]
- [[_COMMUNITY_VPN Services Core|VPN Services Core]]
- [[_COMMUNITY_Config Generate & API Response|Config Generate & API Response]]
- [[_COMMUNITY_Server Management UI|Server Management UI]]
- [[_COMMUNITY_Service Monitor|Service Monitor]]
- [[_COMMUNITY_Login & Panel Selector|Login & Panel Selector]]
- [[_COMMUNITY_Routing Geo Rules|Routing Geo Rules]]
- [[_COMMUNITY_App Layout & Providers|App Layout & Providers]]
- [[_COMMUNITY_Auth Guard & Dashboard Layout|Auth Guard & Dashboard Layout]]
- [[_COMMUNITY_User Block & Sync|User Block & Sync]]
- [[_COMMUNITY_Chain Config & Templates|Chain Config & Templates]]
- [[_COMMUNITY_Chain Flow Editor|Chain Flow Editor]]
- [[_COMMUNITY_Users Page UI|Users Page UI]]
- [[_COMMUNITY_Chain Router Apply|Chain Router Apply]]
- [[_COMMUNITY_Chain Builder Visualization|Chain Builder Visualization]]
- [[_COMMUNITY_Config Diff Engine|Config Diff Engine]]
- [[_COMMUNITY_Routing Templates UI|Routing Templates UI]]
- [[_COMMUNITY_Sync WebSocket & Hooks|Sync WebSocket & Hooks]]
- [[_COMMUNITY_Server Reachability|Server Reachability]]
- [[_COMMUNITY_Push Config|Push Config]]
- [[_COMMUNITY_Server Detail|Server Detail]]
- [[_COMMUNITY_User Actions UI|User Actions UI]]
- [[_COMMUNITY_Shared UI Components|Shared UI Components]]
- [[_COMMUNITY_User Sync Hooks|User Sync Hooks]]
- [[_COMMUNITY_Dashboard Health Data|Dashboard Health Data]]
- [[_COMMUNITY_Next.js Config|Next.js Config]]
- [[_COMMUNITY_WebSocket Events|WebSocket Events]]
- [[_COMMUNITY_Layout Navigation|Layout Navigation]]
- [[_COMMUNITY_Panel Status UI|Panel Status UI]]
- [[_COMMUNITY_Config Push API|Config Push API]]
- [[_COMMUNITY_Dashboard Data Hooks|Dashboard Data Hooks]]
- [[_COMMUNITY_Chain Status Hooks|Chain Status Hooks]]
- [[_COMMUNITY_Sync API Route|Sync API Route]]
- [[_COMMUNITY_Auth Login API|Auth Login API]]
- [[_COMMUNITY_Database Schema|Database Schema]]
- [[_COMMUNITY_Prisma Seed|Prisma Seed]]
- [[_COMMUNITY_Middleware Auth|Middleware Auth]]
- [[_COMMUNITY_Page SSR Actions|Page SSR Actions]]
- [[_COMMUNITY_Error Handling|Error Handling]]
- [[_COMMUNITY_API Health Check|API Health Check]]
- [[_COMMUNITY_Server CRUD API|Server CRUD API]]
- [[_COMMUNITY_Main Entry Point|Main Entry Point]]
- [[_COMMUNITY_Xray Proxy Config|Xray Proxy Config]]
- [[_COMMUNITY_Prisma Client|Prisma Client]]
- [[_COMMUNITY_Dashboard Panel Card|Dashboard Panel Card]]
- [[_COMMUNITY_GeoIP Download Pipeline|GeoIP Download Pipeline]]
- [[_COMMUNITY_SSH Key Gen|SSH Key Gen]]
- [[_COMMUNITY_Dashboard Component Tree|Dashboard Component Tree]]
- [[_COMMUNITY_Top Bar Navigation|Top Bar Navigation]]
- [[_COMMUNITY_Panel Status Card|Panel Status Card]]
- [[_COMMUNITY_Prisma Migration|Prisma Migration]]
- [[_COMMUNITY_Server Reachability Check|Server Reachability Check]]
- [[_COMMUNITY_UI Utilities|UI Utilities]]
- [[_COMMUNITY_Component Exports|Component Exports]]
- [[_COMMUNITY_Toast Notifications|Toast Notifications]]
- [[_COMMUNITY_Sidebar Navigation|Sidebar Navigation]]
- [[_COMMUNITY_Server Configuration Form|Server Configuration Form]]
- [[_COMMUNITY_Auth Token Utils|Auth Token Utils]]
- [[_COMMUNITY_Panel Selector State|Panel Selector State]]
- [[_COMMUNITY_Tailwind Config|Tailwind Config]]
- [[_COMMUNITY_Build Scripts|Build Scripts]]
- [[_COMMUNITY_Zod Validation Schemas|Zod Validation Schemas]]
- [[_COMMUNITY_HMAC Auth Utility|HMAC Auth Utility]]
- [[_COMMUNITY_Panel API Key Auth|Panel API Key Auth]]
- [[_COMMUNITY_Panel Connection|Panel Connection]]
- [[_COMMUNITY_Layout Types|Layout Types]]
- [[_COMMUNITY_Notification Sound|Notification Sound]]
- [[_COMMUNITY_Server List Item|Server List Item]]
- [[_COMMUNITY_Dashboard Context|Dashboard Context]]
- [[_COMMUNITY_Panel Status Hooks|Panel Status Hooks]]
- [[_COMMUNITY_Dashboard Loading|Dashboard Loading]]
- [[_COMMUNITY_Theme Utilities|Theme Utilities]]
- [[_COMMUNITY_Chain Builder Types|Chain Builder Types]]
- [[_COMMUNITY_Server Detail State|Server Detail State]]
- [[_COMMUNITY_Routing Rule Types|Routing Rule Types]]
- [[_COMMUNITY_User Types|User Types]]
- [[_COMMUNITY_GeoIP Types|GeoIP Types]]
- [[_COMMUNITY_Panel Selector Types|Panel Selector Types]]
- [[_COMMUNITY_Panel Status Types|Panel Status Types]]
- [[_COMMUNITY_Build Config|Build Config]]
- [[_COMMUNITY_Xray Route Tags|Xray Route Tags]]

## God Nodes (most connected - your core abstractions)
1. `writeAuditLog()` - 60 edges
2. `Button` - 42 edges
3. `error()` - 34 edges
4. `success()` - 33 edges
5. `Card` - 28 edges
6. `CardContent` - 28 edges
7. `CardHeader` - 23 edges
8. `CardTitle` - 23 edges
9. `Input` - 18 edges
10. `createAwgUser()` - 17 edges

## Surprising Connections (you probably didn't know these)
- `DELETE()` --calls--> `writeAuditLog()`  [INFERRED]
  src/app/api/panels/[id]/route.ts → src/lib/audit-log.ts
- `DELETE()` --calls--> `writeAuditLog()`  [INFERRED]
  src/app/api/routing/geo/[id]/route.ts → src/lib/audit-log.ts
- `PUT()` --calls--> `error()`  [INFERRED]
  src/app/api/alerts/[id]/route.ts → src/lib/api-response.ts
- `PUT()` --calls--> `success()`  [INFERRED]
  src/app/api/alerts/[id]/route.ts → src/lib/api-response.ts
- `DELETE()` --calls--> `error()`  [INFERRED]
  src/app/api/alerts/[id]/route.ts → src/lib/api-response.ts

## Import Cycles
- None detected.

## Communities (101 total, 10 thin omitted)

### Community 0 - "Batch & Config API"
Cohesion: 0.05
Nodes (41): batchCreateRuleSchema, batchDeleteSchema, DELETE(), POST(), PUT(), RouteContext, updateConfigSchema, serverResponse() (+33 more)

### Community 1 - "Chain Presets & Import"
Cohesion: 0.07
Nodes (36): paramsSchema, createSchema, GET(), POST(), POST(), importSchema, BUILTIN_CHAIN_PRESETS, ChainPresetDef (+28 more)

### Community 2 - "Dashboard Fleet UI"
Cohesion: 0.07
Nodes (28): EmptyPanelCTA(), FleetHealthStrip(), FleetHealthStripProps, FleetHealthSummary, MultiPanelSection(), formatTimeAgo(), PanelCard(), PanelCardProps (+20 more)

### Community 3 - "Dashboard Metrics Panels"
Cohesion: 0.07
Nodes (29): MetricCardProps, MetricsCards(), getUsageColor(), getUsageTextColor(), PanelCardExpanded(), PanelCardExpandedProps, ResourceBar(), ResourceBarProps (+21 more)

### Community 4 - "Tailscale Route Advertise"
Cohesion: 0.10
Nodes (35): advertiseSchema, POST(), advertiseRoutes(), CliResult, execFileAsync, getBackendState(), getNodeIP(), getNodes() (+27 more)

### Community 5 - "GeoIP Lookup"
Cohesion: 0.10
Nodes (18): GET(), lookupSchema, CachedCountry, formatMiB(), GEOIP_DIR, GEOIP_DOWNLOAD_URLS, GEOIP_FILE, GeoIPManager (+10 more)

### Community 6 - "VPN Services Core"
Cohesion: 0.13
Nodes (35): addAwgPeer(), allocateAwgAddress(), awgBinary(), awgClientAddressPrefix(), awgClientRoutes(), awgInterface(), awgPeerAllowedIps(), AwgUserConfig (+27 more)

### Community 7 - "Config Generate & API Response"
Cohesion: 0.14
Nodes (25): generateConfigSchema, POST(), PATCH(), updateTemplateSchema, error(), firstZodError(), success(), validationError() (+17 more)

### Community 8 - "Server Management UI"
Cohesion: 0.08
Nodes (22): AddServerForm(), AddServerFormProps, FormErrors, ServerItem, ServerList(), SaveTemplateDialog(), SaveTemplateDialogProps, Dialog() (+14 more)

### Community 9 - "Service Monitor"
Cohesion: 0.07
Nodes (23): SERVICE_MAP, ServiceHealth, ServiceKey, ServiceMonitor, {
  buildFlowVisibility,
  collectCheckEvidence,
  decisionWithDispatchError,
  getLabelsForDecision,
  makeDecision,
  readConfig,
  renderFlowComment,
  resolvePrNumber,
}, Check, CheckStatus, config (+15 more)

### Community 10 - "Login & Panel Selector"
Cohesion: 0.15
Nodes (18): PanelSelectorPanel, PanelSelectorProps, ServerConfigData, ServerConfigProps, ServiceInfo, ServiceCardProps, ChainPresetsGrid(), ChainPresetsGridProps (+10 more)

### Community 11 - "Routing Geo Rules"
Cohesion: 0.09
Nodes (20): ErrorBoundaryProps, ErrorBoundaryState, GEO_STARTER_RULES, EmptyStateStarter(), EmptyStateStarterProps, ACTION_OPTIONS, FormErrors, GeoRuleDrawer() (+12 more)

### Community 12 - "App Layout & Providers"
Cohesion: 0.10
Nodes (20): geistMono, geistSans, metadata, Providers(), ProvidersProps, WebSocketContext, WebSocketContextValue, WS_EVENTS (+12 more)

### Community 13 - "Auth Guard & Dashboard Layout"
Cohesion: 0.10
Nodes (15): AuthGuard(), AuthGuardProps, DashboardLayout(), DashboardLayoutProps, ErrorBoundary, Header(), HeaderProps, Sidebar() (+7 more)

### Community 14 - "User Block & Sync"
Cohesion: 0.18
Nodes (24): POST(), RouteContext, syncAllUsers(), SyncReport, syncUser(), blockAwgUser(), blockThreeXuiUser(), buildXuiClient() (+16 more)

### Community 15 - "Chain Config & Templates"
Cohesion: 0.13
Nodes (19): chainConfigRequestSchema, generateWireGuardPeers(), generateXrayRoutingRules(), POST(), ChainTemplatesList(), ChainTemplatesListProps, iconMap, topologyLabel (+11 more)

### Community 16 - "Chain Flow Editor"
Cohesion: 0.15
Nodes (16): defaultEdgeOptions, topologyOptions, ChainFlowNode, protocolBadge, roleColors, roleLabels, PanelGroupNode, ChainBuilderNode (+8 more)

### Community 17 - "Users Page UI"
Cohesion: 0.11
Nodes (14): UserListItem, UsersListParams, UsersResponse, useUsers(), UserEmptyState(), UserEmptyStateProps, SortOption, sortOptions (+6 more)

### Community 18 - "Chain Router Apply"
Cohesion: 0.16
Nodes (14): applyChainSchema, applyChainConfig(), ChainApplyResult, generateChainConfig(), generateWireGuardPeers(), generateXrayRoutingRules(), getTemplateById(), ResolvedTransport (+6 more)

### Community 19 - "Chain Builder Visualization"
Cohesion: 0.13
Nodes (17): ChainBuilder(), ChainVisualization(), ChainVisualizationProps, statusColors, statusGlow, ChainStatus, ChainStatusConnection, ChainStatusNode (+9 more)

### Community 20 - "Config Diff Engine"
Cohesion: 0.17
Nodes (18): diffRequestSchema, POST(), buildChainNodesDiff(), buildRoutingRulesDiff(), buildWireGuardPeersDiff(), chainNodeEquals(), computeConfigDiff(), formatChainNode() (+10 more)

### Community 21 - "Routing Templates UI"
Cohesion: 0.15
Nodes (13): TemplateApplyDrawer(), TemplateApplyDrawerProps, TemplateRuleDef, TemplateGalleryProps, ProtocolTemplatesGrid(), RoutingPresetsGrid(), RoutingPresetsGridProps, PreviewItem (+5 more)

### Community 22 - "Sync WebSocket & Hooks"
Cohesion: 0.10
Nodes (15): AutoSaveStatus, ChainNodeRoutingDrawer(), ChainNodeRoutingDrawerProps, GEO_ACTION_OPTIONS, GeoFormErrors, MATCH_TYPE_OPTIONS, PROTOCOL_OPTIONS, REGION_OPTIONS (+7 more)

### Community 23 - "Server Reachability"
Cohesion: 0.13
Nodes (16): ConfigDiffView(), ConfigDiffViewProps, PanelSelector(), PushProgressTracker(), PushProgressTrackerProps, PushResultSummary(), PushResultSummaryProps, PushWizardPanel (+8 more)

### Community 24 - "Push Config"
Cohesion: 0.12
Nodes (12): AddPanelForm(), AddPanelFormProps, FormErrors, EditPanelForm(), EditPanelFormProps, FormErrors, PanelDetailsDrawer(), PanelDetailsDrawerProps (+4 more)

### Community 25 - "Server Detail"
Cohesion: 0.18
Nodes (14): Alert, AlertSummary, ApiResponse, PaginatedResponse, AuthState, AuthUser, LoginPayload, LoginResponse (+6 more)

### Community 26 - "User Actions UI"
Cohesion: 0.18
Nodes (15): clearStaleConnections(), connectionPool, ConnectionPoolEntry, execFileAsync, executeOnServer(), getCachedStatus(), getPoolEntry(), invalidateConnection() (+7 more)

### Community 27 - "Shared UI Components"
Cohesion: 0.16
Nodes (15): ChainBuilderNode, ChainBuilderProps, topologyOptions, ChainNodeCard(), ChainNodeCardProps, protocolBadge, roleColors, roleLabels (+7 more)

### Community 28 - "User Sync Hooks"
Cohesion: 0.25
Nodes (13): useWebSocketContext(), AlertBanner(), AlertItem(), formatTimeAgo(), severityConfig, AlertsParams, AlertsResponse, useAlerts() (+5 more)

### Community 29 - "Dashboard Health Data"
Cohesion: 0.14
Nodes (10): ServiceStatusData, useAllServiceStatuses(), useServiceStatus(), AWG_CONFIG, ConfigEntry, ConfigSection, configSections, ConfigurationDisplay() (+2 more)

### Community 30 - "Next.js Config"
Cohesion: 0.16
Nodes (11): generateConfig(), validateConfig(), PreviewItem, RuleRow, TemplatePreviewModal(), TemplatePreviewModalProps, topologyBadgeClasses, ConfigPreset (+3 more)

### Community 31 - "WebSocket Events"
Cohesion: 0.23
Nodes (12): cachePanelApiKey(), triggerAutoResync(), pushConfigToAllPanels(), pushConfigToPanel(), RETRY_DELAYS, sleep(), rollbackPanelConfig(), rollbackPanelConfigWithPush() (+4 more)

### Community 32 - "Layout Navigation"
Cohesion: 0.18
Nodes (14): actionOptions, CreateRoutingRuleForm(), CreateRoutingRuleFormProps, FormErrors, InitialRuleData, protocolOptions, RuleWithUser, ReorderPair (+6 more)

### Community 33 - "Panel Status UI"
Cohesion: 0.22
Nodes (11): classifyDomesticForeign(), evaluateGeoRules(), evaluateGeoRulesFromDB(), GeoRoutingResult, lookupGeoIP(), matchesTarget(), GeoMatchType, GeoRoutingRule (+3 more)

### Community 34 - "Config Push API"
Cohesion: 0.26
Nodes (10): applyThreeXuiRules(), applyWireguardConfig(), execFileAsync, runCommand(), syncApplyPayloadSchema, verifySignature(), storePreviousConfig(), panelSyncPayloadSchema (+2 more)

### Community 35 - "Dashboard Data Hooks"
Cohesion: 0.16
Nodes (11): ChainFlowEditor(), ChainFlowEditorProps, PanelItem, ViewTab, PanelConnectionRecord, PanelConnectionStatus, PanelTestResult, RemotePanel (+3 more)

### Community 36 - "Chain Status Hooks"
Cohesion: 0.21
Nodes (9): POST(), resolveBodySchema, resolveGeoRoute(), ApplyRulesResult, enforceXrayRules(), isDestinationBlockedByGeo(), resolveGeoRoutingForDestination(), RuleEnforcementResult (+1 more)

### Community 37 - "Sync API Route"
Cohesion: 0.29
Nodes (10): applyAwgConfig(), applyPanelConfig(), applyThreeXuiConfig(), validateNoInjection(), enrichError(), ERROR_PATTERNS, ErrorCategory, ErrorPattern (+2 more)

### Community 38 - "Auth Login API"
Cohesion: 0.14
Nodes (11): __resetDeps(), __setDeps(), mockGetNodeIP, mockIsReachable, PanelChainNode, PanelRole, PanelRoutingRule, SyncApplyResponse (+3 more)

### Community 39 - "Database Schema"
Cohesion: 0.24
Nodes (9): deleteAlert(), GetAlertsOptions, markAlertRead(), markAllRead(), toAlertData(), POST(), DELETE(), paramsSchema (+1 more)

### Community 40 - "Prisma Seed"
Cohesion: 0.18
Nodes (6): GeoRulesList(), RoutingRulesList(), RoutingRulesTabs(), TabId, TABS, TemplateGallery()

### Community 41 - "Middleware Auth"
Cohesion: 0.22
Nodes (10): {
  buildDispatchArgs,
  hasCurrentReadyStatus,
  runWatchdog,
  selectStalePrs,
  selectStaleDraftPrs,
}, Label, leadingSpaces(), listPullRequests(), prFixture(), readTopLevelMapping(), readWorkflow(), readWorkflowList() (+2 more)

### Community 42 - "Page SSR Actions"
Cohesion: 0.19
Nodes (11): formatBytes(), formatResetDate(), periodOptions, QuotaData, QuotaPeriod, UserQuotaForm(), UserQuotaFormProps, QuotaData (+3 more)

### Community 43 - "Error Handling"
Cohesion: 0.29
Nodes (9): POST(), createAlert(), broadcastFallbackStatusChange(), checkQuotaThreshold(), checkUserQuotas(), getExceededQuotaThresholds(), getUserUsagePercent(), QUOTA_THRESHOLDS (+1 more)

### Community 44 - "API Health Check"
Cohesion: 0.17
Nodes (8): serviceTypeEnum, updateUserSchema, VpnServiceResult, RouteContext, createUserSchema, listUsersSchema, POST(), serviceTypeEnum

### Community 45 - "Server CRUD API"
Cohesion: 0.33
Nodes (9): applyPreset(), getPreset(), getPresets(), getPresetsByServiceType(), PRESETS, applyPresetSchema, GET(), POST() (+1 more)

### Community 46 - "Main Entry Point"
Cohesion: 0.26
Nodes (9): createTemplate(), getTemplate(), getTemplates(), mapTemplate(), updateTemplate(), createTemplateSchema, POST(), serviceTypeEnum (+1 more)

### Community 47 - "Xray Proxy Config"
Cohesion: 0.26
Nodes (9): CreateUserPayload, UpdateUserPayload, User, UserWithServices, CreateUserForm(), CreateUserFormProps, FormErrors, CreateUserModal() (+1 more)

### Community 48 - "Prisma Client"
Cohesion: 0.31
Nodes (7): formatBytes(), getUsageColor(), getUsageTextColor(), ResourceBar(), ResourceBarProps, ResourceMonitor(), useSystemResources()

### Community 49 - "Dashboard Panel Card"
Cohesion: 0.29
Nodes (8): createGeoRuleSchema, deriveMatchType(), geoTargetSchema, GET(), mapToGeoRoutingRule(), POST(), ensureGeoRulesMigrated(), MigrationResult

### Community 50 - "GeoIP Download Pipeline"
Cohesion: 0.36
Nodes (7): checkResourceThresholds(), classifyResourceSeverity(), createResourceAlert(), RESOURCE_THRESHOLDS, ResourceCheckResult, ResourceThreshold, POST()

### Community 51 - "SSH Key Gen"
Cohesion: 0.25
Nodes (4): ConfigImportReport, ConfigList(), ConfigPresetItem, ConfigTemplateItem

### Community 52 - "Dashboard Component Tree"
Cohesion: 0.39
Nodes (7): CachedResources, getAverageLoad(), getCpuUsage(), getDiskUsage(), getSystemResources(), GET(), SystemResources

### Community 53 - "Top Bar Navigation"
Cohesion: 0.28
Nodes (6): typeColors, typeLabels, WhitelistCreate, WhitelistEntry, WhitelistType, WhitelistUpdate

### Community 54 - "Panel Status Card"
Cohesion: 0.22
Nodes (4): policyPath, prFlowConfigPath, repoRoot, scriptPath

### Community 55 - "Prisma Migration"
Cohesion: 0.46
Nodes (6): GET(), serviceTypeEnum, buildExport(), exportAllConfigs(), exportConfigsByService(), ConfigExport

### Community 56 - "Server Reachability Check"
Cohesion: 0.36
Nodes (7): deriveMatchType(), geoTargetSchema, mapToGeoRoutingRule(), updateGeoRuleSchema, DELETE(), GET(), PUT()

### Community 57 - "UI Utilities"
Cohesion: 0.32
Nodes (4): buildServerPanelMap(), extractHostname(), PanelInfo, ServerInfo

### Community 58 - "Component Exports"
Cohesion: 0.25
Nodes (5): {
  classifyAuditFix,
}, {
  evaluatePrPolicy,
}, policy, require, {
  validateRichBody,
}

### Community 59 - "Toast Notifications"
Cohesion: 0.38
Nodes (6): panelResponse(), updatePanelSchema, DELETE(), GET(), PUT(), RouteContext

### Community 60 - "Sidebar Navigation"
Cohesion: 0.48
Nodes (5): importConfigs(), importConfigurationList(), importTemplateList(), POST(), ConfigImportReport

### Community 61 - "Server Configuration Form"
Cohesion: 0.52
Nodes (5): ALERT_SEVERITY_ORDER, TRAFFIC_PERIODS, TrafficPeriod, VPN_SERVICES, VpnService

### Community 62 - "Auth Token Utils"
Cohesion: 0.38
Nodes (4): getProtocolTemplate(), getProtocolTemplates(), PROTOCOL_TEMPLATES, ProtocolTemplate

### Community 63 - "Panel Selector State"
Cohesion: 0.43
Nodes (6): config, getJwtSecret(), isApiRoute(), isPublicApiRoute(), middleware(), PUBLIC_API_ROUTES

### Community 64 - "Tailwind Config"
Cohesion: 0.29
Nodes (3): {
  buildClaudeLogScan,
  buildFindings,
  writeGithubOutputs,
}, {
  parseClaudeExecution,
}, require

### Community 65 - "Build Scripts"
Cohesion: 0.29
Nodes (5): PullRequestTrigger, repoRoot, require, Workflow, yaml

### Community 66 - "Zod Validation Schemas"
Cohesion: 0.40
Nodes (5): alertSeverityEnum, createAlertSchema, GET(), listAlertsSchema, getAlerts()

### Community 67 - "HMAC Auth Utility"
Cohesion: 0.53
Nodes (5): applyBodySchema, applyAllRules(), applyRoutingRules(), generateXrayRulesFromDB(), POST()

### Community 68 - "Panel API Key Auth"
Cohesion: 0.53
Nodes (4): seedAdmin(), getJwtSecret(), loginSchema, POST()

### Community 69 - "Panel Connection"
Cohesion: 0.40
Nodes (4): calculateResetAt(), PUT(), RouteContext, updateQuotaSchema

### Community 72 - "Server List Item"
Cohesion: 0.40
Nodes (5): getUserStatus(), statusConfig, UserStatus, UserStatusBadge(), UserStatusBadgeProps

### Community 73 - "Dashboard Context"
Cohesion: 0.33
Nodes (3): createWhitelistSchema, whitelistEntries, whitelistTypeSchema

### Community 76 - "Theme Utilities"
Cohesion: 0.50
Nodes (4): ERROR_TYPE_COLORS, ErrorRecommendation(), ErrorRecommendationProps, StructuredPushError

### Community 77 - "Chain Builder Types"
Cohesion: 0.40
Nodes (3): ChainStatusConnection, ChainStatusNode, ChainStatusResponse

### Community 78 - "Server Detail State"
Cohesion: 0.40
Nodes (4): { duplicateSameSha, secondsBetween, summarizeWorkflowRunTiming }, repoRoot, require, WorkflowRunTimingHelper

### Community 81 - "GeoIP Types"
Cohesion: 0.50
Nodes (3): {
  mergeClaudeMetrics,
  renderClaudeExecutionSection,
}, {
  parseClaudeExecution,
  redactSecrets,
}, require

## Knowledge Gaps
- **363 isolated node(s):** `PanelItem`, `ViewTab`, `paramsSchema`, `alertSeverityEnum`, `listAlertsSchema` (+358 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Button` connect `Routing Templates UI` to `Layout Navigation`, `Dashboard Metrics Panels`, `Prisma Seed`, `Server Management UI`, `Login & Panel Selector`, `Routing Geo Rules`, `Page SSR Actions`, `Auth Guard & Dashboard Layout`, `Xray Proxy Config`, `Chain Flow Editor`, `Users Page UI`, `SSH Key Gen`, `Top Bar Navigation`, `Sync WebSocket & Hooks`, `Server Reachability`, `Push Config`, `Shared UI Components`?**
  _High betweenness centrality (0.069) - this node is a cross-community bridge._
- **Why does `writeAuditLog()` connect `Batch & Config API` to `Config Push API`, `HMAC Auth Utility`, `Tailscale Route Advertise`, `Panel Connection`, `API Health Check`, `User Block & Sync`, `Chain Config & Templates`, `Dashboard Panel Card`, `Chain Router Apply`, `Server Reachability Check`, `Toast Notifications`, `WebSocket Events`?**
  _High betweenness centrality (0.039) - this node is a cross-community bridge._
- **Why does `Card` connect `Login & Panel Selector` to `Dashboard Fleet UI`, `Dashboard Metrics Panels`, `Prisma Seed`, `Server Management UI`, `Routing Geo Rules`, `Chain Config & Templates`, `Chain Flow Editor`, `Prisma Client`, `Users Page UI`, `SSH Key Gen`, `Routing Templates UI`, `Top Bar Navigation`, `Server Reachability`, `Push Config`, `Shared UI Components`, `Dashboard Health Data`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Are the 16 inferred relationships involving `writeAuditLog()` (e.g. with `POST()` and `DELETE()`) actually correct?**
  _`writeAuditLog()` has 16 INFERRED edges - model-reasoned connections that need verification._
- **Are the 9 inferred relationships involving `error()` (e.g. with `PATCH()` and `DELETE()`) actually correct?**
  _`error()` has 9 INFERRED edges - model-reasoned connections that need verification._
- **Are the 9 inferred relationships involving `success()` (e.g. with `PATCH()` and `DELETE()`) actually correct?**
  _`success()` has 9 INFERRED edges - model-reasoned connections that need verification._
- **What connects `PanelItem`, `ViewTab`, `paramsSchema` to the rest of the system?**
  _363 weakly-connected nodes found - possible documentation gaps or missing edges._