import { Annotation, MessagesAnnotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";

/**
 * NegotiationState represents the single source of truth for the entire agentic workflow.
 * This interface is the immutable contract shared between all three tracks (Vatsal, Yug, Adarsh).
 */
export const NegotiationStateAnnotation = Annotation.Root({
  /**
   * History of all messages (vendor, accordo, system).
   * MessagesAnnotation handles standard message merging logic.
   */
  ...MessagesAnnotation.spec,

  /**
   * The core deal metadata.
   */
  dealId: Annotation<string>,
  
  /**
   * The current negotiation round number.
   */
  round: Annotation<number>,

  /**
   * The parsed offer extracted from the latest vendor message.
   */
  parsedOffer: Annotation<any | null>({
    reducer: (old, newest) => newest ?? old,
    default: () => null,
  }),

  /**
   * Analysis results from intelligence agents (Track 2: Yug).
   */
  analysis: Annotation<{
    tone?: string;
    behavioralSignals?: string[];
    sentiment?: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
  }>({
    reducer: (old, newest) => ({ ...old, ...newest }),
    default: () => ({}),
  }),

  /**
   * Strategic decision from the brain (Track 1: Vatsal).
   */
  decision: Annotation<{
    action: "ACCEPT" | "COUNTER" | "ESCALATE" | "STALL" | "WAIT";
    reasoning: string;
    confidence: number;
  } | null>({
    reducer: (old, newest) => newest ?? old,
    default: () => null,
  }),

  /**
   * Proposed counter-offer details (Track 3: Adarsh).
   */
  counterOffer: Annotation<any | null>({
    reducer: (old, newest) => newest ?? old,
    default: () => null,
  }),

  /**
   * Flag for Human-in-the-Loop interruptions.
   */
  waitingForHuman: Annotation<boolean>({
    reducer: (old, newest) => newest ?? old,
    default: () => false,
  }),

  /**
   * Metadata for tracing and debugging.
   */
  metadata: Annotation<Record<string, any>>({
    reducer: (old, newest) => ({ ...old, ...newest }),
    default: () => ({}),
  }),
});

export type NegotiationState = typeof NegotiationStateAnnotation.State;
