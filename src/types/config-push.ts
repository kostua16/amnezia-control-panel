/** A single line in a config diff */
export interface ConfigDiffLine {
  type: 'added' | 'removed' | 'unchanged';
  content: string;
}

/** A section of the diff (e.g., "WireGuard Peers", "Routing Rules") */
export interface ConfigDiffSection {
  label: string;
  lines: ConfigDiffLine[];
  /** Summary of changes in this section */
  summary: { added: number; removed: number; unchanged: number };
}

/** Diff result for a single panel */
export interface ConfigDiffResult {
  panelId: number;
  panelName: string;
  hasChanges: boolean;
  sections: ConfigDiffSection[];
  /** The full current config as formatted JSON string (for display) */
  currentConfigFormatted: string | null;
  /** The full new config as formatted JSON string (for display) */
  newConfigFormatted: string;
}

/** Result of applying config to a single service on a panel */
export interface ConfigApplierResult {
  success: boolean;
  service: 'awg' | 'three_xui';
  panelName: string;
  latencyMs: number;
  error: StructuredPushError | null;
}

/** Structured error with actionable recommendations */
export interface StructuredPushError {
  /** Error category for pattern matching in UI */
  type:
    | 'connection_timeout'
    | 'auth_failure'
    | 'invalid_config'
    | 'service_error'
    | 'docker_error'
    | 'unknown';
  /** Human-readable error message */
  message: string;
  /** Recommended action for the admin */
  recommendation: string;
  /** Specific fix command or step, if available */
  knownFix: string | null;
  /** Raw error from the service for debugging */
  rawError: string | null;
}

/** WebSocket event payload for push progress tracking */
export interface PushProgressEvent {
  panelId: number;
  panelName: string;
  status: 'pending' | 'pushing' | 'applying' | 'success' | 'failed';
  service?: 'awg' | 'three_xui';
  latencyMs?: number;
  error?: StructuredPushError;
  timestamp: string;
}
