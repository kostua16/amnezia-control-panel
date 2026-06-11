# Graph Report - .  (2026-06-11)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1426 nodes · 2889 edges · 97 communities (87 shown, 10 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 77 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `51d7a97c`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Audit Log Rules|Audit Log Rules]]
- [[_COMMUNITY_Chain Presets|Chain Presets]]
- [[_COMMUNITY_Fleet Health Panel|Fleet Health Panel]]
- [[_COMMUNITY_Dashboard Stats Hooks|Dashboard Stats Hooks]]
- [[_COMMUNITY_Tailscale Routes|Tailscale Routes]]
- [[_COMMUNITY_GeoIP Manager|GeoIP Manager]]
- [[_COMMUNITY_AWG VPN Users|AWG VPN Users]]
- [[_COMMUNITY_Alert Management|Alert Management]]
- [[_COMMUNITY_Config List Templates|Config List Templates]]
- [[_COMMUNITY_Service Monitor|Service Monitor]]
- [[_COMMUNITY_Panel UI Components|Panel UI Components]]
- [[_COMMUNITY_Geo Rules Monitoring|Geo Rules Monitoring]]
- [[_COMMUNITY_App Layout WebSocket|App Layout WebSocket]]
- [[_COMMUNITY_Auth Guard Alerts|Auth Guard Alerts]]
- [[_COMMUNITY_User Sync VPN|User Sync VPN]]
- [[_COMMUNITY_Chain Templates|Chain Templates]]
- [[_COMMUNITY_Chain Flow Editor|Chain Flow Editor]]
- [[_COMMUNITY_User Edit Forms|User Edit Forms]]
- [[_COMMUNITY_Chain Config Apply|Chain Config Apply]]
- [[_COMMUNITY_Chain Visualization|Chain Visualization]]
- [[_COMMUNITY_Config Diff|Config Diff]]
- [[_COMMUNITY_Template Apply Drawer|Template Apply Drawer]]
- [[_COMMUNITY_Chain Node Routing|Chain Node Routing]]
- [[_COMMUNITY_Config Diff Push|Config Diff Push]]
- [[_COMMUNITY_Panel Management|Panel Management]]
- [[_COMMUNITY_Alert Auth Types|Alert Auth Types]]
- [[_COMMUNITY_Server Connection Pool|Server Connection Pool]]
- [[_COMMUNITY_Chain Builder|Chain Builder]]
- [[_COMMUNITY_Panel Card Expanded|Panel Card Expanded]]
- [[_COMMUNITY_Users List Page|Users List Page]]
- [[_COMMUNITY_Config Export Import|Config Export Import]]
- [[_COMMUNITY_Panel Sync Client|Panel Sync Client]]
- [[_COMMUNITY_Routing Rule Form|Routing Rule Form]]
- [[_COMMUNITY_Geo Routing|Geo Routing]]
- [[_COMMUNITY_Config Apply HMAC|Config Apply HMAC]]
- [[_COMMUNITY_Remote Panel Types|Remote Panel Types]]
- [[_COMMUNITY_Server Management|Server Management]]
- [[_COMMUNITY_Config Applier Errors|Config Applier Errors]]
- [[_COMMUNITY_Panel Sync Test|Panel Sync Test]]
- [[_COMMUNITY_Cache Service Infra|Cache Service Infra]]
- [[_COMMUNITY_Service Status Display|Service Status Display]]
- [[_COMMUNITY_PR Flow Watchdog|PR Flow Watchdog]]
- [[_COMMUNITY_Server Types|Server Types]]
- [[_COMMUNITY_Panel Management UI|Panel Management UI]]
- [[_COMMUNITY_VPN User API|VPN User API]]
- [[_COMMUNITY_Chain Config API|Chain Config API]]
- [[_COMMUNITY_Panel Group Node|Panel Group Node]]
- [[_COMMUNITY_User Create Forms|User Create Forms]]
- [[_COMMUNITY_Dashboard Metrics|Dashboard Metrics]]
- [[_COMMUNITY_Geo Rule Migration|Geo Rule Migration]]
- [[_COMMUNITY_Panel Sync Receive|Panel Sync Receive]]
- [[_COMMUNITY_Panel Sync Concept|Panel Sync Concept]]
- [[_COMMUNITY_Actions Cache Constants|Actions Cache Constants]]
- [[_COMMUNITY_Panel Server Forms|Panel Server Forms]]
- [[_COMMUNITY_PR Trigger Policy|PR Trigger Policy]]
- [[_COMMUNITY_User Quota Forms|User Quota Forms]]
- [[_COMMUNITY_Geo Rule CRUD|Geo Rule CRUD]]
- [[_COMMUNITY_Push Config Page|Push Config Page]]
- [[_COMMUNITY_Audit Safe Policy|Audit Safe Policy]]
- [[_COMMUNITY_Panel CRUD API|Panel CRUD API]]
- [[_COMMUNITY_App Constants|App Constants]]
- [[_COMMUNITY_Auth Middleware|Auth Middleware]]
- [[_COMMUNITY_Claude Log Scan|Claude Log Scan]]
- [[_COMMUNITY_Workflow Triggers|Workflow Triggers]]
- [[_COMMUNITY_Admin Seed Login|Admin Seed Login]]
- [[_COMMUNITY_Quota Reset API|Quota Reset API]]
- [[_COMMUNITY_Build Metrics|Build Metrics]]
- [[_COMMUNITY_Repair Planning Intake|Repair Planning Intake]]
- [[_COMMUNITY_User Status Badge|User Status Badge]]
- [[_COMMUNITY_Whitelist API|Whitelist API]]
- [[_COMMUNITY_Whitelist Update API|Whitelist Update API]]
- [[_COMMUNITY_Loading Spinner|Loading Spinner]]
- [[_COMMUNITY_Error Recommendation|Error Recommendation]]
- [[_COMMUNITY_Chain Status API|Chain Status API]]
- [[_COMMUNITY_Workflow Run Timings|Workflow Run Timings]]
- [[_COMMUNITY_Service Status API|Service Status API]]
- [[_COMMUNITY_Build Automation PR|Build Automation PR]]
- [[_COMMUNITY_Claude Execution Parse|Claude Execution Parse]]
- [[_COMMUNITY_Upsert Planning PR|Upsert Planning PR]]
- [[_COMMUNITY_Claude Retry Classification|Claude Retry Classification]]
- [[_COMMUNITY_Duplicate PR Detection|Duplicate PR Detection]]
- [[_COMMUNITY_Upsert PR Action|Upsert PR Action]]

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
- `GET()` --calls--> `getChainPreset()`  [INFERRED]
  src/app/api/chain-presets/[id]/route.ts → src/lib/chain-presets.ts
- `POST()` --calls--> `writeAuditLog()`  [INFERRED]
  src/app/api/chains/apply/route.ts → src/lib/audit-log.ts
- `POST()` --calls--> `cachePanelApiKey()`  [INFERRED]
  src/app/api/chains/apply/route.ts → src/lib/panel-health-checker.ts

## Import Cycles
- None detected.

## Communities (97 total, 10 thin omitted)

### Community 0 - "Audit Log Rules"
Cohesion: 0.05
Nodes (41): batchCreateRuleSchema, batchDeleteSchema, DELETE(), POST(), PUT(), RouteContext, updateConfigSchema, serverResponse() (+33 more)

### Community 1 - "Chain Presets"
Cohesion: 0.07
Nodes (36): paramsSchema, createSchema, GET(), POST(), POST(), importSchema, BUILTIN_CHAIN_PRESETS, ChainPresetDef (+28 more)

### Community 2 - "Fleet Health Panel"
Cohesion: 0.16
Nodes (11): EmptyPanelCTA(), FleetHealthStrip(), FleetHealthStripProps, FleetHealthSummary, MultiPanelSection(), formatTimeAgo(), PanelCard(), PanelCardProps (+3 more)

### Community 3 - "Dashboard Stats Hooks"
Cohesion: 0.13
Nodes (11): useTopUserTraffic(), TrafficStatsParams, CpuInfo, DashboardStats, DiskInfo, MemoryInfo, ServerResources, TopUserTraffic (+3 more)

### Community 4 - "Tailscale Routes"
Cohesion: 0.10
Nodes (35): advertiseSchema, POST(), advertiseRoutes(), CliResult, execFileAsync, getBackendState(), getNodeIP(), getNodes() (+27 more)

### Community 5 - "GeoIP Manager"
Cohesion: 0.10
Nodes (18): GET(), lookupSchema, CachedCountry, formatMiB(), GEOIP_DIR, GEOIP_DOWNLOAD_URLS, GEOIP_FILE, GeoIPManager (+10 more)

### Community 6 - "AWG VPN Users"
Cohesion: 0.13
Nodes (35): addAwgPeer(), allocateAwgAddress(), awgBinary(), awgClientAddressPrefix(), awgClientRoutes(), awgInterface(), awgPeerAllowedIps(), AwgUserConfig (+27 more)

### Community 7 - "Alert Management"
Cohesion: 0.06
Nodes (64): alertSeverityEnum, createAlertSchema, GET(), listAlertsSchema, POST(), generateConfigSchema, POST(), PATCH() (+56 more)

### Community 8 - "Config List Templates"
Cohesion: 0.18
Nodes (7): ConfigImportReport, ConfigList(), ConfigPresetItem, ConfigTemplateItem, SaveTemplateDialogProps, Dialog(), DialogProps

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

### Community 10 - "Panel UI Components"
Cohesion: 0.14
Nodes (19): PanelSelectorPanel, PanelSelectorProps, TemplateGalleryProps, ServerConfigData, ServerConfigProps, ServiceInfo, ServerItem, ServerList() (+11 more)

### Community 11 - "Geo Rules Monitoring"
Cohesion: 0.09
Nodes (15): EmptyStateStarter(), EmptyStateStarterProps, GeoRulesList(), GeoIPStatusBadge(), GeoIPStatusData, RoutingRulesList(), RoutingRulesTabs(), TabId (+7 more)

### Community 12 - "App Layout WebSocket"
Cohesion: 0.05
Nodes (37): geistMono, geistSans, metadata, Providers(), ProvidersProps, WebSocketContext, WebSocketContextValue, WS_EVENTS (+29 more)

### Community 13 - "Auth Guard Alerts"
Cohesion: 0.07
Nodes (30): AuthGuard(), AuthGuardProps, useWebSocketContext(), AlertBanner(), AlertItem(), formatTimeAgo(), severityConfig, AlertsParams (+22 more)

### Community 14 - "User Sync VPN"
Cohesion: 0.18
Nodes (24): POST(), RouteContext, syncAllUsers(), SyncReport, syncUser(), blockAwgUser(), blockThreeXuiUser(), buildXuiClient() (+16 more)

### Community 15 - "Chain Templates"
Cohesion: 0.21
Nodes (10): ChainTemplatesListProps, iconMap, topologyLabel, BUILTIN_CHAIN_TEMPLATES, getTemplates(), ChainTemplateSelectorProps, TOPOLOGY_BADGES, listTemplatesSchema (+2 more)

### Community 16 - "Chain Flow Editor"
Cohesion: 0.21
Nodes (13): defaultEdgeOptions, topologyOptions, ChainFlowNode, protocolBadge, roleColors, roleLabels, ChainBuilderNode, generateNodeId() (+5 more)

### Community 17 - "User Edit Forms"
Cohesion: 0.11
Nodes (16): EditUserForm(), EditUserFormData, EditUserFormProps, FormErrors, EditUserModal(), EditUserModalProps, UserData, UserEmptyState() (+8 more)

### Community 18 - "Chain Config Apply"
Cohesion: 0.15
Nodes (16): applyChainSchema, applyChainConfig(), ChainApplyResult, generateChainConfig(), generateWireGuardPeers(), generateXrayRoutingRules(), getTemplateById(), __resetDeps() (+8 more)

### Community 19 - "Chain Visualization"
Cohesion: 0.14
Nodes (16): ChainVisualization(), ChainVisualizationProps, statusColors, statusGlow, ChainStatus, ChainStatusConnection, ChainStatusNode, useChainStatus() (+8 more)

### Community 20 - "Config Diff"
Cohesion: 0.17
Nodes (18): diffRequestSchema, POST(), buildChainNodesDiff(), buildRoutingRulesDiff(), buildWireGuardPeersDiff(), chainNodeEquals(), computeConfigDiff(), formatChainNode() (+10 more)

### Community 21 - "Template Apply Drawer"
Cohesion: 0.11
Nodes (15): TemplateApplyDrawer(), TemplateApplyDrawerProps, TemplateRuleDef, ChainPresetsGrid(), ChainPresetsGridProps, topologyBadgeClasses, topologyLabels, ProtocolTemplatesGrid() (+7 more)

### Community 22 - "Chain Node Routing"
Cohesion: 0.10
Nodes (15): AutoSaveStatus, ChainNodeRoutingDrawer(), ChainNodeRoutingDrawerProps, GEO_ACTION_OPTIONS, GeoFormErrors, MATCH_TYPE_OPTIONS, PROTOCOL_OPTIONS, REGION_OPTIONS (+7 more)

### Community 23 - "Config Diff Push"
Cohesion: 0.12
Nodes (17): ChainTemplateSelector(), ConfigDiffView(), ConfigDiffViewProps, PanelSelector(), PushProgressTracker(), PushProgressTrackerProps, PushResultSummary(), PushResultSummaryProps (+9 more)

### Community 24 - "Panel Management"
Cohesion: 0.13
Nodes (13): PanelConnectionStatus, AddPanelForm(), EditPanelForm(), EditPanelFormProps, FormErrors, PanelDetailsDrawer(), PanelDetailsDrawerProps, StatusData (+5 more)

### Community 25 - "Alert Auth Types"
Cohesion: 0.17
Nodes (15): Alert, AlertSummary, ApiResponse, PaginatedResponse, AuthState, AuthUser, LoginPayload, LoginResponse (+7 more)

### Community 26 - "Server Connection Pool"
Cohesion: 0.18
Nodes (15): clearStaleConnections(), connectionPool, ConnectionPoolEntry, execFileAsync, executeOnServer(), getCachedStatus(), getPoolEntry(), invalidateConnection() (+7 more)

### Community 27 - "Chain Builder"
Cohesion: 0.21
Nodes (11): ChainBuilder(), ChainBuilderNode, ChainBuilderProps, topologyOptions, ChainNodeCard(), ChainNodeCardProps, protocolBadge, roleColors (+3 more)

### Community 28 - "Panel Card Expanded"
Cohesion: 0.21
Nodes (10): getUsageColor(), getUsageTextColor(), PanelCardExpanded(), PanelCardExpandedProps, ResourceBar(), ResourceBarProps, TrafficChart(), TrafficChartProps (+2 more)

### Community 29 - "Users List Page"
Cohesion: 0.22
Nodes (5): UserListItem, UsersListParams, UsersResponse, useUsers(), UserList()

### Community 30 - "Config Export Import"
Cohesion: 0.06
Nodes (41): GET(), serviceTypeEnum, buildExport(), exportAllConfigs(), exportConfigsByService(), importConfigs(), importConfigurationList(), importTemplateList() (+33 more)

### Community 31 - "Panel Sync Client"
Cohesion: 0.23
Nodes (12): cachePanelApiKey(), triggerAutoResync(), pushConfigToAllPanels(), pushConfigToPanel(), RETRY_DELAYS, sleep(), rollbackPanelConfig(), rollbackPanelConfigWithPush() (+4 more)

### Community 32 - "Routing Rule Form"
Cohesion: 0.18
Nodes (14): actionOptions, CreateRoutingRuleForm(), CreateRoutingRuleFormProps, FormErrors, InitialRuleData, protocolOptions, RuleWithUser, ReorderPair (+6 more)

### Community 33 - "Geo Routing"
Cohesion: 0.07
Nodes (34): applyBodySchema, POST(), resolveBodySchema, classifyDomesticForeign(), evaluateGeoRules(), evaluateGeoRulesFromDB(), GeoRoutingResult, lookupGeoIP() (+26 more)

### Community 34 - "Config Apply HMAC"
Cohesion: 0.26
Nodes (10): applyThreeXuiRules(), applyWireguardConfig(), execFileAsync, runCommand(), syncApplyPayloadSchema, verifySignature(), storePreviousConfig(), panelSyncPayloadSchema (+2 more)

### Community 35 - "Remote Panel Types"
Cohesion: 0.33
Nodes (6): ChainFlowEditorProps, PanelConnectionStatus, RemotePanel, RemotePanelCreate, RemotePanelUpdate, RemotePanelWithHistory

### Community 36 - "Server Management"
Cohesion: 0.25
Nodes (8): API Key, Server Test API Route, Servers API Route, Add Server Form Component, Server List Component, Server Connection Library, Ping, SSH Port

### Community 37 - "Config Applier Errors"
Cohesion: 0.29
Nodes (10): applyAwgConfig(), applyPanelConfig(), applyThreeXuiConfig(), validateNoInjection(), enrichError(), ERROR_PATTERNS, ErrorCategory, ErrorPattern (+2 more)

### Community 38 - "Panel Sync Test"
Cohesion: 0.15
Nodes (10): __setDeps(), mockGetNodeIP, mockIsReachable, PanelChainNode, PanelRole, PanelRoutingRule, SyncApplyResponse, SyncApplyResponseData (+2 more)

### Community 39 - "Cache Service Infra"
Cohesion: 0.25
Nodes (8): Docker Compose, FalconDev GitHub Actions Cache Server, Filesystem Storage, GitHub Actions Cache Service, maxnowack/local-cache, S3/MinIO Storage, SQLite, zstd

### Community 40 - "Service Status Display"
Cohesion: 0.14
Nodes (10): ServiceStatusData, useAllServiceStatuses(), useServiceStatus(), AWG_CONFIG, ConfigEntry, ConfigSection, configSections, ConfigurationDisplay() (+2 more)

### Community 41 - "PR Flow Watchdog"
Cohesion: 0.22
Nodes (10): {
  buildDispatchArgs,
  hasCurrentReadyStatus,
  runWatchdog,
  selectStalePrs,
  selectStaleDraftPrs,
}, Label, leadingSpaces(), listPullRequests(), prFixture(), readTopLevelMapping(), readWorkflow(), readWorkflowList() (+2 more)

### Community 42 - "Server Types"
Cohesion: 0.33
Nodes (6): WhitelistManagerProps, Server, ServerCreate, ServerTestResult, ServerUpdate, ServerWithServices

### Community 43 - "Panel Management UI"
Cohesion: 0.33
Nodes (6): Panel Test API Route, Panels API Route, Add Panel Form Component, Edit Panel Form Component, Panel List Component, Panel Health Checker Library

### Community 44 - "VPN User API"
Cohesion: 0.17
Nodes (8): serviceTypeEnum, updateUserSchema, VpnServiceResult, RouteContext, createUserSchema, listUsersSchema, POST(), serviceTypeEnum

### Community 45 - "Chain Config API"
Cohesion: 0.47
Nodes (5): chainConfigRequestSchema, generateWireGuardPeers(), generateXrayRoutingRules(), POST(), WireGuardPeerConfig

### Community 46 - "Panel Group Node"
Cohesion: 0.40
Nodes (3): PanelGroupNode, CrossPanelEdgeData, PanelGroupData

### Community 47 - "User Create Forms"
Cohesion: 0.26
Nodes (9): CreateUserPayload, UpdateUserPayload, User, UserWithServices, CreateUserForm(), CreateUserFormProps, FormErrors, CreateUserModal() (+1 more)

### Community 48 - "Dashboard Metrics"
Cohesion: 0.13
Nodes (15): MetricCardProps, MetricsCards(), formatBytes(), getUsageColor(), getUsageTextColor(), ResourceBar(), ResourceBarProps, ResourceMonitor() (+7 more)

### Community 49 - "Geo Rule Migration"
Cohesion: 0.29
Nodes (8): createGeoRuleSchema, deriveMatchType(), geoTargetSchema, GET(), mapToGeoRoutingRule(), POST(), ensureGeoRulesMigrated(), MigrationResult

### Community 50 - "Panel Sync Receive"
Cohesion: 0.50
Nodes (5): API Key, Sync Receive API Route, bcrypt, HMAC, Panel Sync Client Library

### Community 51 - "Panel Sync Concept"
Cohesion: 0.67
Nodes (3): Central Panel, Remote Panel, Sync

### Community 52 - "Actions Cache Constants"
Cohesion: 0.67
Nodes (3): ACTIONS_CACHE_SERVICE_V2, ACTIONS_RESULTS_URL, Runner.Worker.dll

### Community 53 - "Panel Server Forms"
Cohesion: 0.10
Nodes (17): AddPanelFormProps, FormErrors, typeColors, typeLabels, AddServerForm(), AddServerFormProps, FormErrors, WhitelistCreate (+9 more)

### Community 54 - "PR Trigger Policy"
Cohesion: 0.22
Nodes (4): policyPath, prFlowConfigPath, repoRoot, scriptPath

### Community 55 - "User Quota Forms"
Cohesion: 0.19
Nodes (11): formatBytes(), formatResetDate(), periodOptions, QuotaData, QuotaPeriod, UserQuotaForm(), UserQuotaFormProps, QuotaData (+3 more)

### Community 56 - "Geo Rule CRUD"
Cohesion: 0.36
Nodes (7): deriveMatchType(), geoTargetSchema, mapToGeoRoutingRule(), updateGeoRuleSchema, DELETE(), GET(), PUT()

### Community 57 - "Push Config Page"
Cohesion: 0.19
Nodes (7): ChainFlowEditor(), buildServerPanelMap(), extractHostname(), PanelInfo, ServerInfo, PanelItem, ViewTab

### Community 58 - "Audit Safe Policy"
Cohesion: 0.25
Nodes (5): {
  classifyAuditFix,
}, {
  evaluatePrPolicy,
}, policy, require, {
  validateRichBody,
}

### Community 59 - "Panel CRUD API"
Cohesion: 0.38
Nodes (6): panelResponse(), updatePanelSchema, DELETE(), GET(), PUT(), RouteContext

### Community 61 - "App Constants"
Cohesion: 0.52
Nodes (5): ALERT_SEVERITY_ORDER, TRAFFIC_PERIODS, TrafficPeriod, VPN_SERVICES, VpnService

### Community 63 - "Auth Middleware"
Cohesion: 0.43
Nodes (6): config, getJwtSecret(), isApiRoute(), isPublicApiRoute(), middleware(), PUBLIC_API_ROUTES

### Community 64 - "Claude Log Scan"
Cohesion: 0.29
Nodes (3): {
  buildClaudeLogScan,
  buildFindings,
  writeGithubOutputs,
}, {
  parseClaudeExecution,
}, require

### Community 65 - "Workflow Triggers"
Cohesion: 0.29
Nodes (5): PullRequestTrigger, repoRoot, require, Workflow, yaml

### Community 68 - "Admin Seed Login"
Cohesion: 0.53
Nodes (4): seedAdmin(), getJwtSecret(), loginSchema, POST()

### Community 69 - "Quota Reset API"
Cohesion: 0.40
Nodes (4): calculateResetAt(), PUT(), RouteContext, updateQuotaSchema

### Community 72 - "User Status Badge"
Cohesion: 0.40
Nodes (5): getUserStatus(), statusConfig, UserStatus, UserStatusBadge(), UserStatusBadgeProps

### Community 73 - "Whitelist API"
Cohesion: 0.33
Nodes (3): createWhitelistSchema, whitelistEntries, whitelistTypeSchema

### Community 76 - "Error Recommendation"
Cohesion: 0.50
Nodes (4): ERROR_TYPE_COLORS, ErrorRecommendation(), ErrorRecommendationProps, StructuredPushError

### Community 77 - "Chain Status API"
Cohesion: 0.40
Nodes (3): ChainStatusConnection, ChainStatusNode, ChainStatusResponse

### Community 78 - "Workflow Run Timings"
Cohesion: 0.40
Nodes (4): { duplicateSameSha, secondsBetween, summarizeWorkflowRunTiming }, repoRoot, require, WorkflowRunTimingHelper

### Community 81 - "Claude Execution Parse"
Cohesion: 0.50
Nodes (3): {
  mergeClaudeMetrics,
  renderClaudeExecutionSection,
}, {
  parseClaudeExecution,
  redactSecrets,
}, require

## Knowledge Gaps
- **384 isolated node(s):** `PanelItem`, `ViewTab`, `paramsSchema`, `alertSeverityEnum`, `listAlertsSchema` (+379 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Button` connect `Panel UI Components` to `Routing Rule Form`, `Geo Routing`, `Config List Templates`, `Geo Rules Monitoring`, `Auth Guard Alerts`, `User Create Forms`, `Chain Flow Editor`, `Dashboard Metrics`, `User Edit Forms`, `Panel Server Forms`, `Chain Node Routing`, `Config Diff Push`, `Panel Management`, `Template Apply Drawer`, `User Quota Forms`, `Chain Builder`?**
  _High betweenness centrality (0.066) - this node is a cross-community bridge._
- **Why does `writeAuditLog()` connect `Audit Log Rules` to `Geo Routing`, `Config Apply HMAC`, `Tailscale Routes`, `Quota Reset API`, `VPN User API`, `Chain Config API`, `User Sync VPN`, `Geo Rule Migration`, `Chain Config Apply`, `Geo Rule CRUD`, `Panel CRUD API`, `Panel Sync Client`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **Why does `Card` connect `Panel UI Components` to `Fleet Health Panel`, `Config List Templates`, `Service Status Display`, `Geo Rules Monitoring`, `Chain Templates`, `Chain Flow Editor`, `Dashboard Metrics`, `User Edit Forms`, `Panel Server Forms`, `Template Apply Drawer`, `Config Diff Push`, `Panel Management`, `Chain Builder`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **Are the 16 inferred relationships involving `writeAuditLog()` (e.g. with `POST()` and `DELETE()`) actually correct?**
  _`writeAuditLog()` has 16 INFERRED edges - model-reasoned connections that need verification._
- **Are the 9 inferred relationships involving `error()` (e.g. with `PATCH()` and `DELETE()`) actually correct?**
  _`error()` has 9 INFERRED edges - model-reasoned connections that need verification._
- **Are the 9 inferred relationships involving `success()` (e.g. with `PATCH()` and `DELETE()`) actually correct?**
  _`success()` has 9 INFERRED edges - model-reasoned connections that need verification._
- **What connects `PanelItem`, `ViewTab`, `paramsSchema` to the rest of the system?**
  _384 weakly-connected nodes found - possible documentation gaps or missing edges._