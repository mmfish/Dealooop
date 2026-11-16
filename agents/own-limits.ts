// An agent's own guardrails, for the simulated negotiators (sim/negotiation-run.ts).
//
// These run inside the agent, never on the platform: Dealoop does not know an
// owner's limits. A real agent (Claude Code, Codex, ...) keeps its owner's
// instructions in its own way; these helpers are how the demo's built-in
// negotiators keep theirs.

import type {Cents} from '../core/campaign.ts';
import type {Move, Side, Terms} from '../core/negotiation.ts';

export interface CreatorMandate {
  /** Lowest price per sign-up the creator accepts. */
  minPriceCents: Cents;
}

export interface FounderMandate {
  /** Highest price per sign-up the founder pays one creator. */
  maxPriceCents: Cents;
  /** Most sign-ups the founder covers at that price for one creator. */
  maxVolume: number;
}

export interface Mandates {
  creator: CreatorMandate;
  founder: FounderMandate;
}

/** Every way the owner's own limit could be written in a message. */
export function privateNumbers(side: Side, mandate: CreatorMandate | FounderMandate): string[] {
  const c = side === 'creator' ? (mandate as CreatorMandate).minPriceCents : (mandate as FounderMandate).maxPriceCents;
  const dollars = (c / 100).toFixed(2);
  const out = [`$${dollars}`, dollars];
  if (c % 100 === 0) out.push(`$${c / 100}`, `${c / 100} dollars`);
  if (side === 'founder') {
    const v = (mandate as FounderMandate).maxVolume;
    out.push(`${v} sign-ups`, `${v} users`, `up to ${v}`);
  }
  return out;
}

/** Would this message reveal a limit not already public as terms on the table? */
export function revealsLimit(message: string, side: Side, mandate: CreatorMandate | FounderMandate, openTerms: Terms[]): string | null {
  const text = message.toLowerCase();
  const price = side === 'creator' ? (mandate as CreatorMandate).minPriceCents : (mandate as FounderMandate).maxPriceCents;
  const pricePublic = openTerms.some(t => t.priceCents === price);
  const volumePublic = side === 'founder' && openTerms.some(t => t.volumeCap === (mandate as FounderMandate).maxVolume);
  for (const s of privateNumbers(side, mandate)) {
    const isVolume = /sign-ups|users|up to/.test(s);
    if (isVolume ? volumePublic : pricePublic) continue;
    const needle = s.toLowerCase();
    const at = text.indexOf(needle);
    // Whole numbers only: "$6.40" must not match "$16.40".
    if (at >= 0 && !/[\d.]/.test(text[at - 1] ?? '') && !/\d/.test(text[at + needle.length] ?? '')) return s;
  }
  return null;
}

/** Are these terms within the owner's limit? */
export function outsideLimit(side: Side, terms: Terms, mandate: CreatorMandate | FounderMandate): string | null {
  if (side === 'creator' && terms.priceCents < (mandate as CreatorMandate).minPriceCents) return 'below your owner\'s minimum price';
  if (side === 'founder' && terms.priceCents > (mandate as FounderMandate).maxPriceCents) return 'above your owner\'s maximum price';
  if (side === 'founder' && terms.volumeCap > (mandate as FounderMandate).maxVolume) return 'more sign-ups than your owner allows';
  return null;
}

/** The agent's own check before it sends a move: within its owner's limit, and not revealing it. */
export function ownLimitProblem(side: Side, move: Move, onTable: Terms | null, history: {terms?: Terms}[], mandate: CreatorMandate | FounderMandate): string | null {
  const openTerms = [...history.flatMap(t => (t.terms ? [t.terms] : [])), ...(move.action === 'propose' ? [move.terms] : [])];
  const leaked = revealsLimit(move.message, side, mandate, openTerms);
  if (leaked) return `The message reveals your owner's private limit (${leaked}). Rewrite it without that number.`;
  const terms = move.action === 'propose' ? move.terms : move.action === 'accept' ? onTable : null;
  const outside = terms && outsideLimit(side, terms, mandate);
  return outside ? `These terms are ${outside}.` : null;
}
