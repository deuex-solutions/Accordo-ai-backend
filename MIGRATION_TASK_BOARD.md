# Accordo AI: 3-Track Migration Task Board (Tabular - 8-Week)

This board provides a surgical, tabular view of the LangGraph migration over an 8-week timeline.

---

## 0. GLOBAL CONTRACT (Pre-requisite)
| Week | Task | File | Objective | Status |
| :--- | :--- | :--- | :--- | :--- |
| 1 | **NegotiationState** | `src/modules/chatbot/engine/graph/state.ts` | Define the global schema contract | [ ] |

---

## TRACK 1: VATSAL (The Core Foundations)
*Ownership: Decision Brain, Input Processing, and Graph Skeleton.*

| Week | Task | Legacy Source File | Key Objectives | Status |
| :--- | :--- | :--- | :--- | :--- |
| 1 | **StateManagement** | `negotiation-state-machine.ts` | Port state transitions & Postgres checkpointer | [ ] |
| 2 | **OfferParsing** | `parse-offer.ts` | Extract regex & Lakh/Crore logic into node | [ ] |
| 3 | **DecisionAgent (1)** | `decide.ts` (~1,700 lines) | Port core strategic logic (Part 1) | [ ] |
| 4 | **DecisionAgent (2)** | `decide.ts` | Refine logic & thresholding (Part 2) | [ ] |
| 5 | **Orchestrator** | `src/modules/chatbot/engine/index.ts` | Define StateGraph & initial edge wiring | [ ] |
| 6 | **WeightedUtility** | `weighted-utility.ts` | Port parameter scoring logic | [ ] |
| 6 | **HITL Hooks** | N/A | Add `interrupt_before` for high-value deals | [ ] |
| 7 | **Persistence** | N/A | Optimize checkpointer & state compression | [ ] |
| 8 | **Infrastructure** | `.env`, `Dockerfile` | Update backend configs for agentic mode | [ ] |

---

## TRACK 2: YUG (Intelligence & Interaction)
*Ownership: Analysis, LLM Rendering, Safety, and Retrieval.*

| Week | Task | Legacy Source File | Key Objectives | Status |
| :--- | :--- | :--- | :--- | :--- |
| 1 | **ToneAnalysis** | `tone-detector.ts` | 11 style signals & formality detection | [ ] |
| 2 | **BehavioralAnalysis** | `behavioral-analyzer.ts` | Concession velocity & momentum tracking | [ ] |
| 2 | **ConcernExtraction** | `concern-extractor.ts` | LLM-based semantic issue identification | [ ] |
| 3 | **ResponseGen** | `persona-renderer.ts` | Convert to state-aware LLM rendering node | [ ] |
| 4 | **Validation** | `validate-llm-output.ts` | Two-tier bans & price normalization | [ ] |
| 5 | **VectorSearch** | `vector.service.ts` | Semantic retrieval across historical deals | [ ] |
| 6 | **RAGContext** | `context.service.ts` | Context window assembly optimization | [ ] |
| 7 | **PhrasingHistory** | `phrasing-history.ts` | Fingerprinting & opener dedup logic | [ ] |
| 7 | **Safety Audit** | N/A | System-wide policy & prompt audit | [ ] |
| 8 | **API Docs** | N/A | Update Swagger for graph endpoints | [ ] |

---

## TRACK 3: ADARSH (Strategy & Systems)
*Ownership: Advanced Algorithms, Simulation, and Auxiliary Services.*

| Week | Task | Legacy Source File | Key Objectives | Status |
| :--- | :--- | :--- | :--- | :--- |
| 1 | **VendorProfiling** | `meso.ts` (Profile section) | Long-term preference learning persistence | [ ] |
| 2 | **MESOGen (1)** | `meso.ts` (~2,000 lines) | Port Pareto-optimal algorithm (Part 1) | [ ] |
| 3 | **MESOGen (2)** | `meso.ts` | Port Pareto-optimal algorithm (Part 2) | [ ] |
| 4 | **StallRecovery** | `stall-detector.ts` | Deadlock detection & recovery probes | [ ] |
| 5 | **VendorSimulator** | `vendor-simulator.service.ts` | Update simulator for graph interaction | [ ] |
| 6 | **EmailNotification** | `email.service.ts` | Async node for deal update emails | [ ] |
| 7 | **DocumentGen** | `pdf-generator.ts` | Background node for deal summary PDFs | [ ] |
| 7 | **BidComparison** | `bid-comparison.service.ts` | Port multi-vendor bid collection logic | [ ] |
| 8 | **ConvoOrchestrator** | `process-conversation-turn.ts` | Entry-point routing & intent management | [ ] |
| 8 | **Parity Validation** | N/A | Final E2E comparison vs legacy code | [ ] |
