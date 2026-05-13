/**
 * Arc Summary Builder
 *
 * Builds a compact, deterministic summary of the negotiation arc from message
 * history. Passed to the persona-renderer so the LLM can produce contextually
 * aware responses that reference the journey.
 *
 * Hard boundary rules:
 * - ONLY uses vendor-visible information (prices both parties stated, terms, actions)
 * - NEVER includes: utility scores, weights, thresholds, target/max prices, config
 * - Deterministic: pure function from message history, no LLM involved
 * - Compact: targets ~100–150 words for the entire arc string
 */

export interface ArcRound {
  round: number;
  vendorPrice: number | null;
  vendorTerms: string | null;
  pmAction: string | null;
  pmPrice: number | null;
  pmTerms: string | null;
}

export interface ArcMessage {
  role: string;
  content: string;
  extractedOffer?: any;
  counterOffer?: any;
  decisionAction?: string | null;
}

/**
 * Extract structured round-by-round data from message history.
 * Messages are paired: VENDOR message → ACCORDO response = one round.
 */
export function extractArcRounds(messages: ArcMessage[]): ArcRound[] {
  const rounds: ArcRound[] = [];
  let currentRound: Partial<ArcRound> = { round: 1 };

  for (const msg of messages) {
    if (msg.role === "VENDOR") {
      const offer = msg.extractedOffer as any;
      currentRound.vendorPrice = offer?.total_price ?? null;
      currentRound.vendorTerms = offer?.payment_terms ?? null;
    } else if (msg.role === "ACCORDO" && msg.decisionAction) {
      const counter = msg.counterOffer as any;
      currentRound.pmAction = msg.decisionAction;
      currentRound.pmPrice = counter?.total_price ?? null;
      currentRound.pmTerms = counter?.payment_terms ?? null;

      rounds.push({
        round: currentRound.round ?? rounds.length + 1,
        vendorPrice: currentRound.vendorPrice ?? null,
        vendorTerms: currentRound.vendorTerms ?? null,
        pmAction: currentRound.pmAction,
        pmPrice: currentRound.pmPrice ?? null,
        pmTerms: currentRound.pmTerms ?? null,
      });

      currentRound = { round: rounds.length + 1 };
    }
  }

  return rounds;
}

/**
 * Build a compact, human-readable negotiation arc summary.
 *
 * Format: "Round 1: Vendor offered $X, you countered at $Y. Round 2: ..."
 * Only includes rounds where prices were exchanged.
 *
 * @param messages - All messages for this deal, in chronological order
 * @param currencySymbol - Currency symbol for formatting (e.g. "$", "£")
 * @returns Arc summary string, or empty string if insufficient history
 */
export function buildArcSummary(
  messages: ArcMessage[],
  currencySymbol: string = "$",
): string {
  const rounds = extractArcRounds(messages);

  // Need at least 2 completed rounds for an arc to be meaningful
  if (rounds.length < 2) return "";

  const formatPrice = (price: number | null): string =>
    price != null
      ? `${currencySymbol}${price.toLocaleString("en-US")}`
      : "no price stated";

  const lines: string[] = [];

  if (rounds.length > 5) {
    // Summarize early rounds, detail the most recent 3
    const earlyRounds = rounds.slice(0, rounds.length - 3);
    const firstVendorPrice = earlyRounds.find(
      (r) => r.vendorPrice != null,
    )?.vendorPrice;
    const lastEarlyVendorPrice = [...earlyRounds]
      .reverse()
      .find((r) => r.vendorPrice != null)?.vendorPrice;

    const counterCount = earlyRounds.filter(
      (r) => r.pmAction === "COUNTER",
    ).length;

    lines.push(
      `Rounds 1–${earlyRounds.length}: Vendor started at ${formatPrice(firstVendorPrice ?? null)}` +
        (lastEarlyVendorPrice != null &&
        lastEarlyVendorPrice !== firstVendorPrice
          ? ` and moved to ${formatPrice(lastEarlyVendorPrice)}`
          : "") +
        `. ${counterCount} counters exchanged.`,
    );

    const recentRounds = rounds.slice(rounds.length - 3);
    for (const r of recentRounds) {
      const vendorPart =
        r.vendorPrice != null
          ? `Vendor: ${formatPrice(r.vendorPrice)}`
          : "Vendor restated";
      const pmPart =
        r.pmAction === "COUNTER" && r.pmPrice != null
          ? `you countered ${formatPrice(r.pmPrice)}`
          : r.pmAction
            ? `you ${r.pmAction.toLowerCase().replace("_", " ")}ed`
            : "";
      const termsPart = r.vendorTerms ? ` (${r.vendorTerms})` : "";
      lines.push(`Round ${r.round}: ${vendorPart}${termsPart}, ${pmPart}.`);
    }
  } else {
    for (const r of rounds) {
      const vendorPart =
        r.vendorPrice != null
          ? `Vendor offered ${formatPrice(r.vendorPrice)}`
          : "Vendor message (no price)";
      const pmPart =
        r.pmAction === "COUNTER" && r.pmPrice != null
          ? `you countered at ${formatPrice(r.pmPrice)}`
          : r.pmAction
            ? `you ${r.pmAction.toLowerCase().replace("_", " ")}ed`
            : "you responded";
      const termsPart = r.vendorTerms ? ` (${r.vendorTerms})` : "";
      lines.push(`Round ${r.round}: ${vendorPart}${termsPart}, ${pmPart}.`);
    }
  }

  const summary = `Negotiation history (${rounds.length} rounds so far):\n${lines.join("\n")}`;

  // Safety: cap at ~150 words to stay within token budget
  const words = summary.split(/\s+/);
  if (words.length > 150) {
    return words.slice(0, 150).join(" ") + "...";
  }

  return summary;
}
