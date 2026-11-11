// Founder agent, intake role: turn the founder's one-sentence goal into campaign
// fields (SPEC §4 steps 1–2, ACCEPTANCE S1).
//
// Claude reads the sentence; code decides what counts. Every number Claude
// returns must come with the exact words it was read from, and those words must
// appear in what the founder wrote. Anything that cannot be traced is treated as
// missing, so the founder is asked instead of the agent guessing. The deadline
// is never assumed: no stated deadline or duration means a question, not a default.

import {z} from 'zod';
import {founderModel, type Effort, type JsonClient} from './claude.ts';

const DAY = 86_400_000;

export interface ParsedBrief {
  productName: string;
  productPitch: string;
  goalCount: number;
  budgetCents: number;
  maxCacCents: number;
  /** End of the deadline day, UTC milliseconds. */
  deadline: number;
  days: number;
}

export type BriefField = 'budget' | 'maxCac' | 'deadline' | 'goal';

export type BriefResult =
  | {status: 'complete'; brief: ParsedBrief; assumptions: string[]; notes: string[]}
  | {status: 'needs_info'; missing: BriefField[]; question: string; partial: Partial<ParsedBrief>; notes: string[]}
  | {status: 'invalid'; problems: string[]; partial: Partial<ParsedBrief>}
  | {status: 'unavailable'; error: string};

const SYSTEM = `You read a founder's request for a promotion campaign on Dealoop and extract its fields. Dealoop pays creators per verified sign-up, up to a maximum cost per acquisition (CAC).

Extract only what the founder actually wrote. Never fill in a value they did not state, and never compute one from the others. For each value you extract, also return the exact words from the founder's text that state it (copied character for character, in the original language). When a value is not stated, return 0 (or an empty string) and an empty quote.

- goal_count: the number of sign-ups or users they want.
- budget_dollars: the total budget in US dollars.
- max_cac_dollars: the most they will pay per sign-up or user (CAC, cost per user, per sign-up).
- deadline_date: the date the campaign should end, as YYYY-MM-DD, computed from today's date if they gave a duration ("in two weeks", "by Friday"). Empty if they gave no date or duration at all.
- quantity_intent: "more_is_better" if they want as many as possible, "exactly" if they want a fixed number and no more, "unstated" otherwise.
- product_name and product_description: from the text, or empty.`;

const jsonSchema = {
  type: 'object',
  properties: {
    product_name: {type: 'string'},
    product_description: {type: 'string'},
    goal_count: {type: 'integer'},
    goal_quote: {type: 'string'},
    budget_dollars: {type: 'number'},
    budget_quote: {type: 'string'},
    max_cac_dollars: {type: 'number'},
    max_cac_quote: {type: 'string'},
    deadline_date: {type: 'string'},
    deadline_quote: {type: 'string'},
    quantity_intent: {type: 'string', enum: ['more_is_better', 'exactly', 'unstated']},
  },
  required: ['product_name', 'product_description', 'goal_count', 'goal_quote', 'budget_dollars', 'budget_quote', 'max_cac_dollars', 'max_cac_quote', 'deadline_date', 'deadline_quote', 'quantity_intent'],
  additionalProperties: false,
};

const validate = z.object({
  product_name: z.string().max(200),
  product_description: z.string().max(2000),
  goal_count: z.number().int().min(0).max(10_000_000),
  goal_quote: z.string().max(400),
  budget_dollars: z.number().min(0).max(100_000_000),
  budget_quote: z.string().max(400),
  max_cac_dollars: z.number().min(0).max(1_000_000),
  max_cac_quote: z.string().max(400),
  deadline_date: z.string().max(40),
  deadline_quote: z.string().max(400),
  quantity_intent: z.enum(['more_is_better', 'exactly', 'unstated']),
});

export type Extraction = z.infer<typeof validate>;

const QUESTIONS: Record<BriefField, string> = {
  deadline: 'When should the campaign end? A date or a duration works, for example "in two weeks".',
  budget: 'What is your total budget for this campaign, in US dollars?',
  maxCac: 'What is the most you will pay per sign-up?',
  goal: 'How many sign-ups are you aiming for?',
};

const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

/** The quote must appear in the founder's text and, for a number, contain a digit or a number word. */
export function grounded(text: string, quote: string, numeric: boolean): boolean {
  const q = norm(quote);
  if (!q || !norm(text).includes(q)) return false;
  if (!numeric) return true;
  return /\d/.test(q) || /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|thousand|a week|a month)\b/.test(q) || /[一二两三四五六七八九十百千万]/.test(q);
}

/** Numbers written with digits in a quote, with k / 千 / 万 multipliers applied. */
export function numbersIn(quote: string): number[] {
  const out: number[] = [];
  for (const m of quote.normalize('NFKC').matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(k|K|千|万)?/g)) {
    const base = Number(m[1].replace(/,/g, ''));
    const mult = m[2] === 'k' || m[2] === 'K' || m[2] === '千' ? 1_000 : m[2] === '万' ? 10_000 : 1;
    if (Number.isFinite(base)) out.push(base * mult);
  }
  return out;
}

/** The value must be one of the digit-written numbers in its quote (number words are accepted as written). */
function matchesQuote(value: number, quote: string): boolean {
  const nums = numbersIn(quote);
  return nums.length === 0 || nums.some(n => Math.abs(n - value) < 0.005);
}

/** Pure validation of Claude's extraction against the founder's text. Exported for tests. */
export function judgeExtraction(text: string, x: Extraction, now: number): BriefResult {
  const notes: string[] = [];
  const missing: BriefField[] = [];
  const partial: Partial<ParsedBrief> = {
    productName: x.product_name.trim() || 'Your product',
    productPitch: x.product_description.trim(),
  };

  const take = (field: BriefField, value: number, quote: string, label: string) => {
    if (value <= 0) { missing.push(field); return null; }
    if (!grounded(text, quote, true) || !matchesQuote(value, quote)) {
      notes.push(`Ignored a ${label} of ${value} because it does not appear in what you wrote.`);
      missing.push(field);
      return null;
    }
    return value;
  };

  const budget = take('budget', x.budget_dollars, x.budget_quote, 'budget');
  const maxCac = take('maxCac', x.max_cac_dollars, x.max_cac_quote, 'maximum CAC');
  if (budget !== null) partial.budgetCents = Math.round(budget * 100);
  if (maxCac !== null) partial.maxCacCents = Math.round(maxCac * 100);

  const goalValue = x.goal_count > 0 && grounded(text, x.goal_quote, true) && matchesQuote(x.goal_count, x.goal_quote) ? x.goal_count : null;
  if (x.goal_count > 0 && goalValue === null) notes.push(`Ignored a goal of ${x.goal_count} because it does not appear in what you wrote.`);
  if (goalValue !== null) partial.goalCount = goalValue;

  // The deadline: stated words required, a valid future date, within a year.
  let deadline: number | null = null;
  if (x.deadline_date) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(x.deadline_date);
    const at = m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59) : NaN;
    if (!grounded(text, x.deadline_quote, false)) notes.push('Ignored a deadline because it does not appear in what you wrote.');
    else if (!Number.isFinite(at)) notes.push(`Could not read the deadline "${x.deadline_quote}".`);
    else if (at <= now) notes.push(`The deadline "${x.deadline_quote}" is not in the future.`);
    else if (at > now + 366 * DAY) notes.push(`The deadline "${x.deadline_quote}" is more than a year away.`);
    else deadline = at;
  }
  if (deadline === null) missing.push('deadline');
  else {
    partial.deadline = deadline;
    partial.days = Math.max(1, Math.floor((deadline - now) / DAY));
  }

  if (x.quantity_intent === 'exactly') {
    notes.push('You asked for a fixed number of sign-ups. This version treats the goal as a minimum and keeps buying sign-ups within your budget and maximum CAC.');
  }

  const problems: string[] = [];
  if (partial.budgetCents !== undefined && partial.maxCacCents !== undefined && partial.maxCacCents > partial.budgetCents) {
    problems.push('The maximum CAC is larger than the whole budget.');
  }
  if (problems.length) return {status: 'invalid', problems, partial};

  if (missing.length) {
    const order: BriefField[] = ['deadline', 'budget', 'maxCac', 'goal'];
    const asks = order.filter(f => missing.includes(f));
    return {status: 'needs_info', missing: asks, question: asks.map(f => QUESTIONS[f]).join(' '), partial, notes};
  }

  const assumptions: string[] = [];
  if (partial.goalCount === undefined) {
    partial.goalCount = Math.max(1, Math.floor(partial.budgetCents! / partial.maxCacCents!));
    assumptions.push(`No sign-up goal was stated, so the goal is budget ÷ maximum CAC = ${partial.goalCount}.`);
  }
  if (partial.goalCount! * partial.maxCacCents! > partial.budgetCents!) {
    notes.push(`At the maximum CAC the budget covers ${Math.floor(partial.budgetCents! / partial.maxCacCents!)} sign-ups, fewer than the goal of ${partial.goalCount}; the goal is reachable only if the price settles lower.`);
  }
  return {status: 'complete', brief: partial as ParsedBrief, assumptions, notes};
}

export function buildBriefPrompt(text: string, now: number): string {
  const today = new Date(now).toISOString().slice(0, 10);
  return `Today's date: ${today}.\n\nThe founder wrote:\n"""\n${text}\n"""`;
}

/**
 * Parse a founder's brief. Pass every message the founder has written so far
 * (the original sentence plus any answers), in order.
 */
export async function parseBrief(client: JsonClient, messages: string[], now: number, options: {model?: string; effort?: Effort} = {}): Promise<BriefResult> {
  const text = messages.map(m => m.trim()).filter(Boolean).join('\n');
  const result = await client.json({
    purpose: 'founder.brief',
    model: options.model ?? founderModel(),
    effort: options.effort ?? 'low',
    system: SYSTEM,
    user: buildBriefPrompt(text, now),
    jsonSchema,
    validate,
    maxTokens: 4000,
  });
  if (!result.ok) return {status: 'unavailable', error: result.error};
  return judgeExtraction(text, result.value, now);
}
