// Thin wrapper around the Anthropic SDK for Dealoop's agents. Every agent call
// asks for JSON that matches a schema (structured outputs), then validates it
// again with zod, because agent output is untrusted input to the core.
//
// Defaults: Claude Opus 5.5 with server-side refusal fallbacks enabled
// ("default" routing). Override the models with DEALOOP_FOUNDER_MODEL and
// DEALOOP_CREATOR_MODEL.

import Anthropic from '@anthropic-ai/sdk';
import type {z} from 'zod';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface JsonRequest<T> {
  /** Label for usage accounting and logs, e.g. "founder.estimate". */
  purpose: string;
  model: string;
  effort: Effort;
  system: string;
  user: string;
  /** JSON Schema sent to the API (structured outputs). Keep it to types, required and additionalProperties. */
  jsonSchema: Record<string, unknown>;
  /** zod schema the parsed output must also pass, including bounds the JSON Schema cannot express. */
  validate: z.ZodType<T>;
  maxTokens?: number;
}

export type JsonResult<T> =
  | {ok: true; value: T; model: string}
  | {ok: false; error: string};

export interface Usage {
  calls: number;
  failures: number;
  inputTokens: number;
  outputTokens: number;
  byPurpose: Record<string, {calls: number; inputTokens: number; outputTokens: number}>;
}

/** The one interface agents depend on, so tests can substitute a fake. */
export interface JsonClient {
  json<T>(request: JsonRequest<T>): Promise<JsonResult<T>>;
  readonly usage: Usage;
}

export const DEFAULT_MODEL = 'claude-opus-5-5';
export const founderModel = () => process.env.DEALOOP_FOUNDER_MODEL || DEFAULT_MODEL;
export const creatorModel = () => process.env.DEALOOP_CREATOR_MODEL || DEFAULT_MODEL;

// Published per-million-token prices used only for the cost estimate the CLI prints.
const PRICES: Record<string, {input: number; output: number}> = {
  'claude-opus-5-5': {input: 4, output: 20},
  'claude-sonnet-5-5': {input: 2, output: 10},
  'claude-haiku-5-5': {input: 0.1, output: 0.5},
};

export function emptyUsage(): Usage {
  return {calls: 0, failures: 0, inputTokens: 0, outputTokens: 0, byPurpose: {}};
}

export function estimateCostUsd(usage: Usage, model: string): number | null {
  const price = PRICES[model];
  if (!price) return null;
  return (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000;
}

function record(usage: Usage, purpose: string, input: number, output: number) {
  usage.calls += 1;
  usage.inputTokens += input;
  usage.outputTokens += output;
  const p = (usage.byPurpose[purpose] ??= {calls: 0, inputTokens: 0, outputTokens: 0});
  p.calls += 1;
  p.inputTokens += input;
  p.outputTokens += output;
}

export class AnthropicJsonClient implements JsonClient {
  readonly usage: Usage = emptyUsage();
  private readonly client: Anthropic;

  constructor(client: Anthropic = new Anthropic()) {
    this.client = client;
  }

  async json<T>(request: JsonRequest<T>): Promise<JsonResult<T>> {
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await this.client.beta.messages.create({
        model: request.model,
        max_tokens: request.maxTokens ?? 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: request.system,
        output_config: {effort: request.effort, format: {type: 'json_schema', schema: request.jsonSchema}},
        messages: [{role: 'user', content: request.user}],
      });
    } catch (error) {
      this.usage.failures += 1;
      if (error instanceof Anthropic.RateLimitError) return {ok: false, error: 'rate limited'};
      if (error instanceof Anthropic.AuthenticationError) return {ok: false, error: 'authentication failed'};
      if (error instanceof Anthropic.BadRequestError) return {ok: false, error: `bad request: ${error.message}`};
      if (error instanceof Anthropic.APIError) return {ok: false, error: `API error ${error.status}`};
      if (error instanceof Anthropic.APIConnectionError) return {ok: false, error: 'connection error'};
      throw error;
    }
    record(this.usage, request.purpose, response.usage.input_tokens, response.usage.output_tokens);

    if (response.stop_reason === 'refusal') {
      this.usage.failures += 1;
      return {ok: false, error: 'refused'};
    }
    if (response.stop_reason === 'max_tokens') {
      this.usage.failures += 1;
      return {ok: false, error: 'hit max_tokens'};
    }
    const text = response.content.flatMap(b => (b.type === 'text' ? [b.text] : [])).join('');
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      this.usage.failures += 1;
      return {ok: false, error: 'output was not JSON'};
    }
    const checked = request.validate.safeParse(parsed);
    if (!checked.success) {
      this.usage.failures += 1;
      return {ok: false, error: 'output failed validation'};
    }
    return {ok: true, value: checked.data, model: response.model};
  }
}

/** Run async jobs with at most `limit` in flight, preserving input order in the results. */
export async function mapLimit<I, O>(items: I[], limit: number, fn: (item: I) => Promise<O>): Promise<O[]> {
  const out = new Array<O>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({length: Math.min(limit, items.length)}, worker));
  return out;
}
