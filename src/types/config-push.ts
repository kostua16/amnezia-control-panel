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
  type: 'connection_timeout' | 'auth_failure' | 'invalid_config' | 'service_error' | 'docker_error' | 'unknown';
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
