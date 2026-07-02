/**
 * P0 pipeline timing — frontend PM-response timeout should match backend capacity.
 *
 * Calculation (Jul 2026, 40–150 word LLM replies):
 * - classify + dispatch + persist:        ~1.5s
 * - LLM generation (150 words ≈ 400 tok): ~3.5s per attempt (avg)
 * - validation retries (max 4 attempts):  ×4 worst case, ~2 attempts typical
 * - buffer for network / cold model:      ~2s
 *
 * Typical path: 1.5 + (2 × 3.5) + 2 ≈ 10.5s
 * P95 path:    1.5 + (4 × 3.5) + 2 ≈ 17.5s → round to 18s
 */
export const PIPELINE_CLASSIFY_PERSIST_MS = 1500;
export const PIPELINE_LLM_ATTEMPT_MS = 3500;
export const PIPELINE_MAX_LLM_ATTEMPTS = 4;
export const PIPELINE_NETWORK_BUFFER_MS = 2000;

export const PM_RESPONSE_TIMEOUT_MS =
  PIPELINE_CLASSIFY_PERSIST_MS +
  PIPELINE_MAX_LLM_ATTEMPTS * PIPELINE_LLM_ATTEMPT_MS +
  PIPELINE_NETWORK_BUFFER_MS;
