# LLM Provider Migration

Living document for the OpenAI GPT-3.5 → open-source LLM migration. Update
when behavior, env vars, or call sites change.

## Goal

One env-var-controlled swap point for every LLM call in the system. Local dev
uses Ollama + Llama 3.1 8B. Production stays on OpenAI GPT-3.5 by default;
staging will later switch to AWS Bedrock + Llama 3.3 70B.

## Architecture

All chat-completion calls go through a single entry point:

```ts
import { generateChatCompletion } from "src/services/llm-provider";

const response = await generateChatCompletion(messages, {
  temperature: 0.7,
  maxTokens: 260,
});
```

The `LLM_PROVIDER` environment variable routes the call to one of three
backends. Provider selection happens once at first call; the singleton is
reused for the lifetime of the process.

```
LLM_PROVIDER=openai   → OpenAIProvider  → openai.service.ts → OpenAI API
LLM_PROVIDER=ollama   → OllamaProvider  → http://localhost:11434 (Llama 3.1 8B)
LLM_PROVIDER=bedrock  → BedrockProvider → (Phase B, currently throws)
```

### What the abstraction preserves

- Token counting + `ApiUsageLog` writes (via `OpenAIProvider` wrapping the
  legacy service)
- Per-provider retry/backoff (3 attempts, exponential delay)
- Health checks via `checkLlmHealth()`
- Existing validation gate in `persona-renderer.ts` → `validateLlmOutput()`
- Fallback templates in `fallback-templates.ts` for negotiation responses

### What's deliberately out of scope

- Streaming responses. Frontend is batch-only; `streamChatCompletion()` on
  `llm.service.ts` stays direct-Ollama and bypasses the abstraction.
- INSIGHTS-mode LLM call in `engine/response-generator.ts:392`. Only the
  CONVERSATION-mode + summarization paths go through the abstraction.

## Migrated call sites

| File                                                      | Mode                               | Notes                                                              |
| --------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------ |
| `src/llm/persona-renderer.ts`                             | CONVERSATION (vendor chat)         | Primary negotiation LLM call                                       |
| `src/modules/bid-analysis/bid-analysis.controller.ts`     | PDF narrative summary              | Has its own 10s `Promise.race` timeout, falls back to empty string |
| `src/modules/chat/chat.service.ts`                        | Generic chat sessions (batch only) | Streaming path bypasses abstraction by design                      |
| `src/modules/bid-comparison/summary/summary-generator.ts` | Deal summary                       | Has its own `generateFallbackSummary` if LLM fails                 |

## Embedding providers

Separate axis, same pattern. `EMBEDDING_PROVIDER` selects:

| Value             | Where                 | Model                                                               |
| ----------------- | --------------------- | ------------------------------------------------------------------- |
| `local` (default) | `local.provider.ts`   | `Xenova/bge-large-en-v1.5` via @huggingface/transformers (CPU ONNX) |
| `ollama`          | `ollama.provider.ts`  | `bge-m3` via Ollama daemon (1024d, multilingual, 8192 ctx)          |
| `openai`          | `openai.provider.ts`  | `text-embedding-3-small`                                            |
| `bedrock`         | `bedrock.provider.ts` | `amazon.titan-embed-text-v2:0`                                      |

All providers return L2-normalized vectors at `EMBEDDING_DIMENSION` (default 1024) so cosine-similarity math matches across providers.

## Local setup

### 1. Install Ollama

```bash
brew install ollama
brew services start ollama   # or: ollama serve
```

### 2. Pull models

```bash
ollama pull llama3.1:8b      # ~5 GB, chat
ollama pull bge-m3           # ~1.2 GB, embeddings
```

Verify:

```bash
ollama list
curl http://localhost:11434/api/tags
```

### 3. Configure backend

In `.env`:

```env
LLM_PROVIDER=ollama
LLM_OLLAMA_BASE_URL=http://localhost:11434
LLM_OLLAMA_MODEL=llama3.1:8b

EMBEDDING_PROVIDER=ollama
# EMBEDDING_MODEL defaults to bge-m3 for the ollama provider
```

Restart `npm run dev`. From this point all CONVERSATION-mode chat and
summarizations route through Llama 3.1 8B; embeddings route through bge-m3.

### 4. Quick verification

```bash
# Should reply with a coherent negotiation sentence
curl -s http://localhost:11434/api/generate \
  -d '{"model":"llama3.1:8b","prompt":"Reply with one sentence: counter offer at $42K","stream":false}' \
  | python3 -c "import sys, json; print(json.load(sys.stdin)['response'])"

# Should return a 1024-element array
curl -s http://localhost:11434/api/embeddings \
  -d '{"model":"bge-m3","prompt":"hello"}' \
  | python3 -c "import sys, json; print('dim:', len(json.load(sys.stdin)['embedding']))"
```

## Latency expectations

Measured locally on M-series Mac:

| Model                           | Per-paragraph latency | Hits 5s frontend timeout? |
| ------------------------------- | --------------------- | ------------------------- |
| GPT-3.5 Turbo (OpenAI)          | 500ms-1s              | No                        |
| Llama 3.1 8B (Ollama, M-series) | 1-2s typical          | Comfortable headroom      |
| Llama 3.3 70B (Bedrock managed) | 1-2s                  | Comfortable headroom      |
| gpt-oss-20b (Ollama, M-series)  | 5-8s                  | **Hits timeout**          |

The 5-second frontend timeout in `useDealActions.ts` (`PM_RESPONSE_TIMEOUT_MS`)
fires when LLM responses exceed 5s and triggers the deterministic template
fallback path. Llama 3.1 8B should sit comfortably under that.

## Defaults — production safety

`LLM_PROVIDER=openai` is the default in `.env.example` and in `env.ts`. No
matter what state local `.env` files are in, prod environments without the
variable explicitly set stay on OpenAI. Flipping to ollama/bedrock requires an
explicit env var change in the production deploy.

## Adding a new provider (when Bedrock lands)

1. Implement `BedrockProvider extends LlmProvider` in
   `src/services/llm-provider/bedrock.provider.ts` — replace the current stub.
2. The factory + env var routing is already wired; no changes needed there.
3. Add `LLM_BEDROCK_MODEL` and AWS credential env vars to `.env.example`.
4. Test by setting `LLM_PROVIDER=bedrock` and running the negotiation smoke.

## Files

```
src/services/llm-provider/
  ├── types.ts                      # Shared types (ChatMessage, etc.)
  ├── llm-provider.interface.ts     # Abstract base class
  ├── openai.provider.ts            # Wraps existing openai.service.ts
  ├── ollama.provider.ts            # Direct Ollama daemon client
  ├── bedrock.provider.ts           # Phase B stub
  ├── provider.factory.ts           # Lazy singleton + env var routing
  └── index.ts                      # Public surface

src/modules/vector/providers/
  ├── embedding-provider.interface.ts   # (existing) Abstract base
  ├── local.provider.ts                 # (existing) HF Transformers ONNX
  ├── openai.provider.ts                # (existing) OpenAI embeddings API
  ├── bedrock.provider.ts               # (existing) AWS Titan v2
  ├── ollama.provider.ts                # (new) Ollama bge-m3
  └── provider.factory.ts               # (updated) added 'ollama' case
```
