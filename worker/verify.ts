export interface ReviewJob {
  fileKey: string;
  nodeId: string;
  version?: string;
  frameName?: string;
  triggeredBy?: string;
  status: string;
}

export interface WebhookPayload {
  event_type?: string;
  passcode?: string;
  file_key?: string;
  file_name?: string;
  node_id?: string;
  status?: string;
  triggered_by?: { id?: string };
}

export function verifyAndBuildJob(
  payload: WebhookPayload,
  expectedPasscode: string,
): { ok: true; job: ReviewJob | null } | { ok: false; reason: string } {
  if (!payload.passcode || payload.passcode !== expectedPasscode) {
    return { ok: false, reason: 'bad passcode' };
  }
  if (payload.event_type !== 'DEV_MODE_STATUS_UPDATE' || !payload.node_id || !payload.file_key) {
    return { ok: true, job: null };
  }
  return {
    ok: true,
    job: {
      fileKey: payload.file_key,
      nodeId: payload.node_id,
      version: undefined,
      frameName: payload.file_name,
      triggeredBy: payload.triggered_by?.id,
      status: payload.status ?? 'READY_FOR_DEV',
    },
  };
}
