/**
 * Conversation Context Summary (internal LLM context only — never shown to vendor)
 *
 * Hybrid format:
 * - Structured round-by-round: price, payment terms, delivery, PM action
 * - Last 1–2 prior message snippets for tone and continuity
 *
 * @source arc-summary.ts (structured rounds)
 */

import {
  extractArcRounds,
  type ArcMessage,
} from "./arc-summary.js";

export type { ArcMessage as ContextMessage };

const MAX_SUMMARY_WORDS = 220;
const SNIPPET_MAX_CHARS = 160;
const SNIPPET_COUNT = 2;

function formatPrice(
  price: number | null,
  currencySymbol: string,
): string {
  if (price == null) return "no price stated";
  const locale = currencySymbol === "₹" ? "en-IN" : "en-US";
  return `${currencySymbol}${price.toLocaleString(locale)}`;
}

function deliveryFromOffer(offer: unknown): string | null {
  if (!offer || typeof offer !== "object") return null;
  const o = offer as Record<string, unknown>;
  if (typeof o.delivery_date === "string" && o.delivery_date) {
    return `delivery ${o.delivery_date}`;
  }
  if (typeof o.delivery_days === "number" && o.delivery_days > 0) {
    return `delivery ${o.delivery_days} days`;
  }
  return null;
}

function truncateSnippet(text: string, maxChars: number): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxChars) return cleaned;
  return `${cleaned.slice(0, maxChars - 1)}…`;
}

function roleLabel(role: string): string {
  return role === "VENDOR" ? "Vendor" : role === "ACCORDO" ? "PM" : role;
}

function buildStructuredSection(
  messages: ArcMessage[],
  rounds: ReturnType<typeof extractArcRounds>,
  currencySymbol: string,
): string[] {
  if (rounds.length === 0) return [];

  const lines: string[] = ["Structured history:"];
  let vendorMsgIdx = 0;

  for (const r of rounds) {
    let vendorOffer: unknown = null;
    let pmOffer: unknown = null;
    while (vendorMsgIdx < messages.length) {
      const msg = messages[vendorMsgIdx];
      vendorMsgIdx++;
      if (msg.role === "VENDOR") {
        vendorOffer = msg.extractedOffer;
        break;
      }
    }
    for (let j = vendorMsgIdx; j < messages.length; j++) {
      const msg = messages[j];
      if (msg.role === "ACCORDO" && msg.decisionAction) {
        pmOffer = msg.counterOffer;
        break;
      }
    }

    const vendorParts: string[] = [];
    if (r.vendorPrice != null) {
      vendorParts.push(formatPrice(r.vendorPrice, currencySymbol));
    }
    if (r.vendorTerms) vendorParts.push(r.vendorTerms);
    const vendorDelivery = deliveryFromOffer(vendorOffer);
    if (vendorDelivery) vendorParts.push(vendorDelivery);

    const pmParts: string[] = [];
    if (r.pmAction === "COUNTER" && r.pmPrice != null) {
      pmParts.push(`counter ${formatPrice(r.pmPrice, currencySymbol)}`);
    } else if (r.pmAction) {
      pmParts.push(r.pmAction.toLowerCase().replace(/_/g, " "));
    }
    if (r.pmTerms) pmParts.push(r.pmTerms);
    const pmDelivery = deliveryFromOffer(pmOffer);
    if (pmDelivery) pmParts.push(pmDelivery);

    const vendorLine =
      vendorParts.length > 0 ? vendorParts.join(", ") : "message (no price)";
    const pmLine = pmParts.length > 0 ? pmParts.join(", ") : "response";

    lines.push(`Round ${r.round}: Vendor — ${vendorLine}; PM — ${pmLine}.`);
  }

  return lines;
}

function buildPositionLine(
  rounds: ReturnType<typeof extractArcRounds>,
  currencySymbol: string,
): string {
  if (rounds.length === 0) return "";
  const last = rounds[rounds.length - 1];
  const parts: string[] = [];
  if (last.pmPrice != null) {
    parts.push(`last PM counter ${formatPrice(last.pmPrice, currencySymbol)}`);
  }
  if (last.vendorPrice != null) {
    parts.push(`last vendor ${formatPrice(last.vendorPrice, currencySymbol)}`);
  }
  if (parts.length === 0) return "";
  return `Current thread: ${parts.join("; ")}. Stay consistent with this arc — do not reset to an unrelated price level.`;
}

function buildSnippetSection(messages: ArcMessage[]): string[] {
  const nonEmpty = messages.filter((m) => m.content?.trim());
  if (nonEmpty.length === 0) return [];

  const recent = nonEmpty.slice(-SNIPPET_COUNT);
  const lines: string[] = ["Recent messages:"];
  for (const msg of recent) {
    lines.push(
      `${roleLabel(msg.role)}: "${truncateSnippet(msg.content, SNIPPET_MAX_CHARS)}"`,
    );
  }
  return lines;
}

function capWordCount(text: string, maxWords: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text;
  return `${words.slice(0, maxWords).join(" ")}…`;
}

/**
 * Build internal negotiation context for the LLM from prior persisted messages.
 * Excludes the current inbound vendor message when its text matches the last
 * vendor row (async two-phase flow where vendor message is already saved).
 */
export function buildConversationContextSummary(
  messages: ArcMessage[],
  currencySymbol: string = "$",
  options?: { currentVendorMessage?: string },
): string {
  let prior = messages;

  const current = options?.currentVendorMessage?.trim();
  if (current) {
    const lastVendorIdx = [...prior]
      .map((m, i) => ({ m, i }))
      .reverse()
      .find(({ m }) => m.role === "VENDOR")?.i;
    if (
      lastVendorIdx != null &&
      prior[lastVendorIdx]?.content?.trim() === current
    ) {
      prior = prior.filter((_, i) => i !== lastVendorIdx);
    }
  }

  if (prior.length === 0) return "";

  const rounds = extractArcRounds(prior);
  const structured = buildStructuredSection(prior, rounds, currencySymbol);
  const snippets = buildSnippetSection(prior);
  const position = buildPositionLine(rounds, currencySymbol);

  const parts = [
    ...structured,
    ...(structured.length && (snippets.length || position) ? [""] : []),
    ...snippets,
    ...(snippets.length && position ? [""] : []),
    ...(position ? [position] : []),
  ];
  if (parts.length === 0) return "";

  return capWordCount(
    `Conversation so far (${prior.length} prior message${prior.length === 1 ? "" : "s"}):\n${parts.join("\n")}`,
    MAX_SUMMARY_WORDS,
  );
}
