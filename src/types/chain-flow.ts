/** Data attached to a React Flow Group node representing a panel boundary */
export interface PanelGroupData {
  [key: string]: unknown;
  panelId: number;
  panelName: string;
  isActive: boolean;
}

/** Data attached to cross-panel edges for tooltip rendering */
export interface CrossPanelEdgeData {
  [key: string]: unknown;
  crossPanel: true;
  sourcePanelName: string;
  targetPanelName: string;
}
