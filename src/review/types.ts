export type FindingKind = 'deprecated' | 'detached';

export interface Finding {
  kind: FindingKind;
  nodeId: string;
  nodeName: string;
  detail: string;
}

export interface ReviewTarget {
  fileKey: string;
  nodeId: string;
  version?: string;
  frameName?: string;      // filled from webhook file_name/node name if known
  triggeredBy?: string;    // Figma user id
  status?: 'READY_FOR_DEV' | 'COMPLETED' | 'NONE';
}

export interface ReviewResult {
  fileKey: string;
  version?: string;
  frameNodeId: string;
  frameName: string;
  reviewedAt: string;
  triggeredBy?: string;
  status: 'READY_FOR_DEV' | 'COMPLETED' | 'NONE';
  findings: Finding[];
  counts: Record<FindingKind, number>;
  cleanScore: number | null;
  tooLarge?: { reason: 'immediate-breadth' | 'ceiling' | 'fetch-failed'; nodeCount?: number };
}
