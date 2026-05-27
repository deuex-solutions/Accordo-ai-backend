# Accordo AI: Clean 3-Track Parallel LangGraph Migration (8-Week)

This roadmap provides a surgical breakdown for migrating to a LangGraph multi-agent system over 8 weeks. The work is divided into three isolated tracks to ensure Vatsal, Yug, and Adarsh can work simultaneously with zero merge conflicts while managing multiple project commitments.

---

## 1. The Track Strategy (Isolation Boundaries)

To prevent overlap, we split the 19 agents by functional domain. The **NegotiationState Schema** acts as the immutable contract between all tracks.

*   **TRACK 1: VATSAL (Core Foundations)**
    *   *Domain*: Input processing, core decision logic, state persistence, and final graph assembly.
    *   *Goal*: Build the "Brain" and the "Skeleton".
*   **TRACK 2: YUG (Intelligence & Safety)**
    *   *Domain*: Semantic analysis, LLM interaction, RAG, and output validation.
    *   *Goal*: Build the "Senses" and the "Voice".
*   **TRACK 3: ADARSH (Strategy & Systems)**
    *   *Domain*: Advanced offer algorithms, simulation, and auxiliary service orchestration.
    *   *Goal*: Build the "Tactics" and "Supporting Systems".

---

## 2. Synchronized 8-Week Roadmap

### Phase 1: Foundations & Input (Weeks 1-2)
| Week | Track 1: Vatsal (Core) | Track 2: Yug (Intelligence) | Track 3: Adarsh (Strategy) |
| :--- | :--- | :--- | :--- |
| **1** | **Define `NegotiationState`** | Analysis Interface Review | Strategy Interface Review |
| **2** | `OfferParsingAgent` & `StateManagement` | `ToneAnalysisAgent` & `BehavioralAnalysis` | `VendorProfilingAgent` |

### Phase 2: The Core Logic (Weeks 3-4)
| Week | Track 1: Vatsal (Core) | Track 2: Yug (Intelligence) | Track 3: Adarsh (Strategy) |
| :--- | :--- | :--- | :--- |
| **3** | **`NegotiationDecisionAgent` (Part 1)** | `ResponseGenerationAgent` | `MESOGenerationAgent` (Part 1) |
| **4** | **`NegotiationDecisionAgent` (Part 2)** | `ValidationAgent` | `MESOGenerationAgent` (Part 2) |

### Phase 3: Orchestration & Systems (Weeks 5-6)
| Week | Track 1: Vatsal (Core) | Track 2: Yug (Intelligence) | Track 3: Adarsh (Strategy) |
| :--- | :--- | :--- | :--- |
| **5** | **`NegotiationOrchestrator`** | `VectorSearchAgent` | `StallRecoveryAgent` |
| **6** | `WeightedUtilityNode` & HITL Hooks | `RAGContextAgent` | `VendorSimulator` & `EmailNode` |

### Phase 4: Integration & Production (Weeks 7-8)
| Week | Track 1: Vatsal (Core) | Track 2: Yug (Intelligence) | Track 3: Adarsh (Strategy) |
| :--- | :--- | :--- | :--- |
| **7** | Persistence Tuning | Phrasing History & Safety Audit | `DocumentGen` & `BidComparison` |
| **8** | **Launch** & Infra Tuning | Final E2E Integration Testing | `ConversationOrchestrator` |

---

## 3. Workflow: "The Node-Contract Method"

To ensure zero crossover, we follow these three rules:

1.  **Contract First (Week 1)**: All tracks must agree on the `NegotiationState` TypeScript interface in `src/modules/chatbot/engine/graph/state.ts`.
2.  **Isolated Nodes**: Each agent is developed as a standalone function. No agent touches a database directly; all updates flow through the state.
3.  **Mock Validation**: Each developer writes unit tests using mock `NegotiationState` objects. This allows parallel progress even before dependent nodes are finished.

---

## 4. Work Breakdown Structure (WBS)

### Track 1: Vatsal (The Core)
*   **State Management**: Port `negotiation-state-machine.ts` into LangGraph Checkpointer.
*   **Offer Parsing**: Extract regex/Lakh/Crore logic from `parse-offer.ts`.
*   **Decision Brain**: Port the 1,700-line `decide.ts` logic into a deterministic node.
*   **Orchestration**: Wire all nodes from all tracks into the main `StateGraph`.

### Track 2: Yug (The Intelligence)
*   **Analysis Layer**: Port `tone-detector.ts`, `behavioral-analyzer.ts`, and `concern-extractor.ts`.
*   **LLM Pipeline**: Port `persona-renderer.ts` and `validate-llm-output.ts`.
*   **Safety**: Implement the two-tier ban list and price normalization.
*   **RAG**: Port `vector.service.ts` and `context.service.ts`.

### Track 3: Adarsh (The Strategy)
*   **MESO Strategy**: Port the 2,000-line `meso.ts` Pareto algorithm.
*   **Vendor Memory**: Implement profile learning logic.
*   **Sim & Stall**: Port `stall-detector.ts` and `vendor-simulator.service.ts`.
*   **Auxiliary**: Port Email, PDF, and Bid Comparison services.
