export const negotiationConfig = {
  parameters: {
    total_price: {
      weight: 0.6,
      direction: "lower_better",
      anchor: 75,
      min_total_price: 85,
      max_total_price: 100,
      target: 85,
      max_acceptable: 100,
      concession_step: 2
    },
    payment_terms: {
      weight: 0.4,
      options: ["Net 30", "Net 60", "Net 90"] as const,
      utility: { "Net 30": 0.2, "Net 60": 0.6, "Net 90": 1.0 }
    }
  },
  accept_threshold: 0.70,
  walkaway_threshold: 0.45,
  max_rounds: 6
} as const;

