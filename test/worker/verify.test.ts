import { describe, it, expect } from 'vitest';
import { verifyAndBuildJob } from '../../worker/verify.js';

const good = {
  event_type: 'DEV_MODE_STATUS_UPDATE', passcode: 'SECRET',
  file_key: 'F', file_name: 'Nav', node_id: '43:2', status: 'READY_FOR_DEV', triggered_by: { id: 'u1' },
};

describe('verifyAndBuildJob', () => {
  it('rejects a bad passcode', () => {
    const r = verifyAndBuildJob({ ...good, passcode: 'WRONG' }, 'SECRET');
    expect(r.ok).toBe(false);
  });
  it('acks non-dev-mode events with no job', () => {
    const r = verifyAndBuildJob({ event_type: 'FILE_UPDATE', passcode: 'SECRET' }, 'SECRET');
    expect(r).toEqual({ ok: true, job: null });
  });
  it('builds a job for a valid dev-mode event', () => {
    const r = verifyAndBuildJob(good, 'SECRET');
    expect(r).toEqual({ ok: true, job: { fileKey: 'F', nodeId: '43:2', frameName: 'Nav', triggeredBy: 'u1', status: 'READY_FOR_DEV', version: undefined } });
  });
});
