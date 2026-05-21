# Accordo AI Multi-Agent Architecture Catalog

## Overview

This document catalogs all components from the existing backend that will be converted into LangGraph agents, organized by priority tiers.

---

## File-to-Agent Consolidation Logic

### Why 19 Agents from 50+ Files?

The initial file count (~50+) included many non-agent components:

- **Model files (20+)** - Data schemas, not logic engines
- **Route/Controller files (~15)** - HTTP handlers, not agents
- **Utility functions (~10)** - Formatters, helpers, simple services

**Consolidation Principle**: "An Agent = A Decision-Making Unit with State"

| Category          | Files Count                                          | Consolidated To             | Agents        |
| ----------------- | ---------------------------------------------------- | --------------------------- | ------------- |
| Decision Engines  | 4 files (decide.ts, weighted-utility.ts, etc.)       | 1 decision pipeline         | 1 agent       |
| Parsing           | 1 file (parse-offer.ts)                              | Standalone                  | 1 agent       |
| State Management  | 1 file (negotiation-state-machine.ts)                | Standalone                  | 1 agent       |
| Tone/Behavior     | 5 files (tone-_, behavioral-_, preference-\*)        | 2 analysis pipelines        | 2 agents      |
| Response          | 4 files (persona-renderer, response-generator, etc.) | 1 generation pipeline       | 1 agent       |
| Vendor Simulation | 4 files (vendor-simulator, vendor-agent, etc.)       | 1 simulation engine         | 1 agent       |
| MESO System       | 1 file (meso.ts - ~2,000 lines)                      | Complex single agent        | 1 agent       |
| Models            | 20+ files                                            | Data structures, not agents | 0 agents      |
| Simple Services   | ~10 files                                            | Utilities/email/formatters  | 5 agents      |
| **Total**         | **~50 files**                                        | **Logical groupings**       | **19 agents** |

---

## TIER 1: MUST-HAVE CORE AGENTS (Critical Path)

| #   | Agent Name                   | Current Files                                                                              | Purpose                                                                                       | Conversion Benefit                                                                                                                                                                                   |
| --- | ---------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **NegotiationDecisionAgent** | `src/modules/chatbot/engine/decide.ts`<br>`src/modules/chatbot/engine/weighted-utility.ts` | Makes all strategic decisions (ACCEPT/COUNTER/ESCALATE/WALK_AWAY) based on utility thresholds | • Isolated decision logic enables independent testing<br>• Parallel utility calculations<br>• Easier threshold tuning without touching orchestration<br>• Deterministic guarantees in agent boundary |
| 2   | **OfferParsingAgent**        | `src/modules/chatbot/engine/parse-offer.ts`                                                | Extracts price, terms, delivery from vendor messages using regex patterns                     | • Dedicated parsing logic with retry mechanisms<br>• Can leverage LLM for ambiguous cases<br>• Parallel extraction of multiple offer components<br>• Stateful parser with context memory             |
| 3   | **StateManagementAgent**     | `src/modules/chatbot/engine/negotiation-state-machine.ts`                                  | Manages deal state transitions and enforces state validity                                    | • Centralized state authority<br>• Event-sourced state tracking<br>• Parallel deal state monitoring<br>• Rollback capabilities for failed transitions                                                |

---

## TIER 2: HIGH-VALUE INTELLIGENCE AGENTS

| #   | Agent Name                  | Current Files                                                                                              | Purpose                                                                    | Conversion Benefit                                                                                                                                               |
| --- | --------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4   | **ToneAnalysisAgent**       | `src/modules/chatbot/engine/tone-detector.ts`                                                              | Classifies vendor communication style (formal/casual/urgent/firm/friendly) | • Real-time tone adaptation<br>• Historical tone tracking across deals<br>• A/B testing different tone responses<br>• Multi-modal tone detection (text + timing) |
| 5   | **BehavioralAnalysisAgent** | `src/modules/chatbot/engine/behavioral-analyzer.ts`<br>`src/modules/chatbot/engine/preference-detector.ts` | Tracks vendor concessions, detects rigidity, analyzes negotiation patterns | • Pattern recognition across multiple deals<br>• Predictive behavior modeling<br>• Shared learning across vendor profiles<br>• Real-time strategy adjustment     |
| 6   | **VendorProfilingAgent**    | `src/modules/chatbot/engine/meso.ts` (profile builder)<br>`src/models/vendor-negotiation-profile.ts`       | Builds and maintains vendor preference profiles from interactions          | • Persistent vendor memory<br>• Cross-deal learning<br>• Preference evolution tracking<br>• Automated profile updates                                            |
| 7   | **ConcernExtractionAgent**  | `src/modules/chatbot/engine/concern-extractor.ts`                                                          | Identifies vendor concerns (supply chain, timeline, budget) from messages  | • Proactive concern addressing<br>• Concern resolution tracking<br>• LLM-powered semantic extraction<br>• Concern-to-strategy mapping                            |

---

## TIER 3: ADVANCED STRATEGY AGENTS

| #   | Agent Name                  | Current Files                                                                                            | Purpose                                                             | Conversion Benefit                                                                                                                                       |
| --- | --------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8   | **MESOGenerationAgent**     | `src/modules/chatbot/engine/meso.ts`                                                                     | Generates 2-3 Pareto-optimal offer packages with equivalent utility | • Dynamic option generation based on context<br>• Preference-learned option tuning<br>• Multi-parameter optimization<br>• A/B testing MESO effectiveness |
| 9   | **ResponseGenerationAgent** | `src/llm/persona-renderer.ts`<br>`src/modules/chatbot/engine/response-generator.ts`                      | Generates human-like PM responses using LLM or templates            | • Multi-model response generation<br>• Response quality validation loop<br>• Style-consistent response chains<br>• Fallback orchestration                |
| 10  | **VendorSimulationAgent**   | `src/modules/chatbot/vendor/vendor-simulator.service.ts`<br>`src/modules/chatbot/vendor/vendor-agent.ts` | Generates realistic vendor personas for testing and training        | • Parallel scenario simulation<br>• Multi-vendor strategy testing<br>• Automated training data generation<br>• Policy optimization through simulation    |
| 11  | **StallRecoveryAgent**      | `src/modules/chatbot/engine/stall-detector.ts`                                                           | Detects negotiation stalls and triggers recovery probes             | • Proactive stall prevention<br>• Recovery strategy testing<br>• Escalation timing optimization<br>• Automated nudge generation                          |

---

## TIER 4: ORCHESTRATION AGENTS

| #   | Agent Name                         | Current Files                                                                                                    | Purpose                                                             | Conversion Benefit                                                                                                             |
| --- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 12  | **NegotiationOrchestratorAgent**   | `src/modules/chatbot/engine/process-negotiation-core.ts`                                                         | Coordinates the deterministic negotiation pipeline                  | • Visual workflow management<br>• Parallel sub-workflows<br>• Retry and recovery orchestration<br>• Decision audit trails      |
| 13  | **ConversationOrchestratorAgent**  | `src/modules/chatbot/convo/process-conversation-turn.ts`<br>`src/modules/chatbot/convo/enhanced-convo-router.ts` | Manages conversation flow, intent classification, state transitions | • Complex conversation branching<br>• Multi-turn context management<br>• Intent conflict resolution<br>• Conversation recovery |
| 14  | **BidComparisonOrchestratorAgent** | `src/modules/bid-comparison/bid-comparison.service.ts`                                                           | Manages vendor bid collection and comparison workflows              | • Parallel vendor bid processing<br>• Automated comparison triggers<br>• Deadline management<br>• Multi-criteria ranking       |

---

## TIER 5: AUXILIARY SERVICE AGENTS

| #   | Agent Name                  | Current Files                                                                                                | Purpose                                                     | Conversion Benefit                                                                                                   |
| --- | --------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 15  | **VectorSearchAgent**       | `src/modules/vector/vector.service.ts`                                                                       | Semantic search across negotiation history                  | • Parallel embedding generation<br>• Multi-provider fallback<br>• Context-aware retrieval<br>• Search result ranking |
| 16  | **RAGContextAgent**         | `src/services/context.service.ts`<br>`src/modules/vector/embedding.client.ts`                                | Manages retrieval-augmented generation context              | • Dynamic context assembly<br>• Relevance scoring<br>• Context window optimization<br>• Multi-source context fusion  |
| 17  | **EmailNotificationAgent**  | `src/services/email.service.ts`<br>`src/modules/bid-comparison/bid-comparison.email.ts`                      | Sends notification emails (deal updates, summaries)         | • Async email queue processing<br>• Template personalization<br>• Delivery tracking<br>• Multi-channel fallbacks     |
| 18  | **DocumentGenerationAgent** | `src/modules/bid-comparison/pdf/pdf-generator.ts`<br>`src/modules/chatbot/pdf/deal-summary-pdf-generator.ts` | Generates PDF reports and summaries                         | • Async document generation<br>• Template management<br>• Batch processing<br>• Format adaptation                    |
| 19  | **ValidationAgent**         | `src/llm/validate-llm-output.ts`<br>`src/modules/chatbot/engine/scope-guard.ts`                              | Validates LLM outputs and guards against off-topic requests | • Multi-layer validation<br>• Policy enforcement<br>• Content filtering<br>• Automated corrections                   |

---

## AGENT INTERACTION MAP

```
┌─────────────────────────────────────────────────────────────────────┐
│                    CONVERSATION ORCHESTRATOR                         │
│     (Entry point - manages vendor message flow)                      │
└──────────────┬────────────────────────────────────────────────────────┘
               │
       ┌───────┴───────┐
       ▼               ▼
┌─────────────┐  ┌──────────────┐
│   SCOPE     │  │    TONE      │
│   GUARD     │  │   ANALYZER   │
└──────┬──────┘  └──────┬───────┘
       │                │
       └───────┬────────┘
               ▼
┌──────────────────────────────────┐
│      OFFER PARSING AGENT         │
│  (Extracts price, terms, delivery) │
└──────────────┬───────────────────┘
               │
       ┌───────┴───────┐
       ▼               ▼
┌─────────────┐  ┌──────────────┐
│  BEHAVIORAL │  │   CONCERN    │
│  ANALYZER   │  │  EXTRACTOR   │
└──────┬──────┘  └──────┬───────┘
       │                │
       └───────┬────────┘
               ▼
┌──────────────────────────────────┐
│   NEGOTIATION DECISION AGENT     │
│   (Core utility + threshold logic)│
└──────────────┬───────────────────┘
               │
       ┌───────┴───────┬──────────────┐
       ▼               ▼              ▼
┌──────────┐  ┌──────────────┐  ┌──────────┐
│   MESO   │  │   STALL      │  │ VENDOR   │
│  GENERATOR│  │   RECOVERY   │  │ PROFILE  │
└────┬─────┘  └──────┬───────┘  └────┬─────┘
     │               │              │
     └─────────┬─────┴──────────────┘
               ▼
┌──────────────────────────────────┐
│   RESPONSE GENERATION AGENT      │
│   (LLM persona renderer)         │
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│   STATE MANAGEMENT AGENT         │
│   (Persists conversation state)  │
└──────────────────────────────────┘
```

---

## PRIORITY MATRIX

| Priority      | Agents                                                              | Business Impact | Implementation Complexity |
| ------------- | ------------------------------------------------------------------- | --------------- | ------------------------- |
| P0 (Critical) | NegotiationDecisionAgent, OfferParsingAgent, StateManagementAgent   | High            | Low-Medium                |
| P1 (High)     | ToneAnalysisAgent, BehavioralAnalysisAgent, ResponseGenerationAgent | High            | Medium                    |
| P2 (Medium)   | MESOGenerationAgent, VendorProfilingAgent, VendorSimulationAgent    | Medium-High     | Medium-High               |
| P3 (Low)      | EmailNotificationAgent, DocumentGenerationAgent, VectorSearchAgent  | Medium          | Low                       |

---

## AGENT SUMMARY BY TIER

- **Total Agents Identified**: 19
- **Must-Have (Tier 1)**: 3 agents - Core negotiation logic
- **High-Value (Tier 2)**: 4 agents - Intelligence and analysis
- **Advanced (Tier 3)**: 4 agents - Strategy and simulation
- **Orchestration (Tier 4)**: 3 agents - Workflow coordination
- **Auxiliary (Tier 5)**: 5 agents - Supporting services

---

## MVP RECOMMENDATION (5 Agents)

If time-constrained, focus only on:

1. **NegotiationDecisionAgent** (Tier 1) - Core decision logic
2. **OfferParsingAgent** (Tier 1) - Input processing
3. **ResponseGenerationAgent** (Tier 3) - Output generation
4. **StateManagementAgent** (Tier 1) - Persistence
5. **ToneAnalysisAgent** (Tier 2) - Quality improvement

**MVP Timeline**: 4-6 weeks with AI assistance
