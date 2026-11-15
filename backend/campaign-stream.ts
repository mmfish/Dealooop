// Live updates for the public campaign pages (app/campaigns).
//
// A page subscribes and, on each `change`, re-renders from the database; the
// stream carries only "something newer exists, up to sequence N", never data,
// so it cannot show anything the page would not. Writes come from several
// processes (the web server, the Claude Desktop MCP server, the simulation),
// so the database is polled; the in-process commit hook only makes local
// writes arrive sooner.

export const campaignStreamLimits = {pollMs: 500, heartbeatMs: 15_000, lifetimeMs: 300_000, total: 200};

type EventDB = D1Database & {onEventCommit?: (listener: () => void) => () => void};

let open = 0;

export class StreamError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/** Opens the stream for one campaign (`?campaign=<id>`) or for all of them. `after` (or Last-Event-ID) is the sequence the page already shows. */
export async function openCampaignStream(req: Request, db: EventDB, overrides: Partial<typeof campaignStreamLimits> = {}): Promise<Response> {
  const limits = {...campaignStreamLimits, ...overrides};
  const url = new URL(req.url);
  if (req.headers.has('origin') && req.headers.get('origin') !== url.origin) throw new StreamError(403, 'Use a same-origin page.');
  const campaign = url.searchParams.get('campaign');
  if (campaign !== null && !/^[\w-]{1,100}$/.test(campaign)) throw new StreamError(400, 'Invalid campaign id.');
  const after = req.headers.get('last-event-id') ?? url.searchParams.get('after') ?? '0';
  if (!/^(0|[1-9][0-9]{0,15})$/.test(after)) throw new StreamError(400, 'after must be a nonnegative integer.');
  if (open >= limits.total) throw new StreamError(429, 'Too many open streams; retry later.');

  const latest = campaign
    ? db.prepare('SELECT COALESCE(MAX(sequence),0) AS s FROM campaign_events WHERE campaign_id=?').bind(campaign)
    : db.prepare('SELECT COALESCE(MAX(sequence),0) AS s FROM campaign_events');
  let cursor = Number(after);
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let closed = false, running = false, again = false, lastFrame = Date.now();
  let timer: ReturnType<typeof setInterval> | undefined, deadline: ReturnType<typeof setTimeout> | undefined, unsubscribe: (() => void) | undefined;
  open++;

  const emit = (text: string) => { if (closed) return; controller.enqueue(encoder.encode(text)); lastFrame = Date.now(); };
  const cleanup = () => {
    if (closed) return;
    closed = true; open--;
    if (timer) clearInterval(timer);
    if (deadline) clearTimeout(deadline);
    unsubscribe?.();
    req.signal.removeEventListener('abort', abort);
  };
  const close = () => { if (closed) return; cleanup(); try { controller.close(); } catch { /* already closed by the reader */ } };
  const abort = () => close();

  async function check() {
    if (closed) return;
    if (running) { again = true; return; }
    running = true;
    try {
      do {
        again = false;
        const s = Number((await latest.first<{s: number}>())?.s ?? 0);
        if (closed) return;
        if (s > cursor) {
          cursor = s;
          emit(`id: ${s}\nevent: change\ndata: ${JSON.stringify({sequence: s})}\n\n`);
        } else if (Date.now() - lastFrame >= limits.heartbeatMs) {
          emit(': heartbeat\n\n');
        }
      } while (again && !closed);
    } catch {
      close();
    } finally {
      running = false;
    }
  }

  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      emit(`retry: 2000\nevent: ready\ndata: ${JSON.stringify({sequence: cursor})}\n\n`);
      if (req.signal.aborted) { close(); return; }
      req.signal.addEventListener('abort', abort, {once: true});
      unsubscribe = db.onEventCommit?.(() => void check());
      timer = setInterval(() => void check(), limits.pollMs);
      deadline = setTimeout(close, limits.lifetimeMs);
      void check();
    },
    cancel() { cleanup(); },
  });
  return new Response(body, {headers: {'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no'}});
}
