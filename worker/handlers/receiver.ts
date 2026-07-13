// worker/handlers/receiver.ts
import { verifyAndBuildJob } from '../verify.js';
import type { ReviewJob } from '../verify.js';

export interface ReceiverEnv {
  REVIEW_QUEUE: { send(body: ReviewJob): Promise<void> };
  WEBHOOK_PASSCODE: string;
}

export async function handleWebhook(request: Request, env: ReceiverEnv): Promise<Response> {
  if (request.method !== 'POST') return new Response('ok', { status: 200 });
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return new Response('bad json', { status: 400 });
  }
  const result = verifyAndBuildJob(payload as any, env.WEBHOOK_PASSCODE);
  if (!result.ok) return new Response('forbidden', { status: 403 });
  if (result.job) await env.REVIEW_QUEUE.send(result.job);
  return new Response('ok', { status: 200 });  // fast ack — always
}
