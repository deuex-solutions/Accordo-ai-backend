# Chatbot Message Pipeline

New orchestration layer for the unified vendor message flow.

**Plan:** [`chatbot_pipeline_implementation_plan.md`](../../../../chatbot_pipeline_implementation_plan.md) (repo root)

## Terminology

```text
Every turn:  inbound VENDOR (seller)  →  outbound ACCORDO (PM / procurement manager)
```

| Name | Meaning |
|------|---------|
| `entryChannel: internal_app` | Authenticated negotiation room HTTP surface |
| `entryChannel: vendor_portal` | Public vendor chat HTTP surface |
| `dealOwnerUserId` | Deal owner auth on internal_app — not the message author |

## Status

| Slice | Module | Wired to HTTP |
|-------|--------|---------------|
| **P0.1** | `message-classifier.ts` → `classifyMessage()` | Yes (via `runAgentTurn`) |
| **P0.2** | `run-agent-turn.ts` → `runAgentTurn()` | Yes |
| **P0.3** | `compose-chat-response.ts` → chat-mode LLM | Yes |
| **P0.4** | `negotiation-path-p0.ts` → counter-only LLM (MESO suppressed) | Yes |
| **P0.5** | HTTP wiring | Yes |

## HTTP entry points (P0.5)

| Entry | Path |
|-------|------|
| Internal app single-shot | `chatbot.controller.ts` → `sendMessage`, `sendConversationMessage` → `runVendorTurnFromInternalApp` |
| Async PM (both surfaces) | `generatePMResponseAsyncService` → `runPmResponseViaPipeline` → `runAgentTurn({ existingVendorMessageId })` |
| Vendor public chat | `vendor-chat` Phase 2 → `generatePMResponse` → pipeline wrapper |

Phase-1 instant save (`saveVendorMessageOnlyService`, `vendorSendMessageInstant`) unchanged — still saves **VENDOR** message before async ACCORDO reply.

## Temporary P0 UI test mode

Set `VITE_PIPELINE_P0_TEST_MODE=true` on the frontend. See [`P0_MANUAL_UI_TEST.md`](../../../../P0_MANUAL_UI_TEST.md) at repo root.

## P0 cleanup notes (no deletions)

These legacy files are **not imported** by active runtime paths; kept until P4:

- `convo/process-conversation-turn.ts`
- `convo/enhanced-convo-router.ts`
- `engine/process-negotiation-core.ts`
- `convo/conversation-service.ts` (full legacy pipeline — replaced at HTTP layer in P0.5)
