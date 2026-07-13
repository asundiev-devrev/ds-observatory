// worker/index.ts
import { handleWebhook } from './handlers/receiver.js';
import type { ReceiverEnv } from './handlers/receiver.js';
import { handleQueue } from './handlers/consumer.js';
import type { ConsumerEnv } from './handlers/consumer.js';

export type Env = ReceiverEnv & ConsumerEnv;

// ONE default export with BOTH handlers — this is the entire Worker.
export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleWebhook(request, env);
  },
  queue(batch: { messages: { body: any; ack(): void }[] }, env: Env): Promise<void> {
    return handleQueue(batch, env);
  },
};
