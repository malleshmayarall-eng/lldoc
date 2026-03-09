# Document AI Inference — Architecture & Design

**What this document is about**: How a large document is split into a structural tree, how dense context is built from that tree so AI services can traverse it efficiently, and how the write-path (on edit) and read-path (on AI action) work as two fundamentally different loops.

**What this document is NOT about**: API endpoints, serializers, Django views, or implementation specifics.

---

## 1. The Two-Loop Architecture

Every interaction with the document falls into exactly one of two loops:

```
┌──────────────────────────────────────────────────────────────┐
│                     WRITE PATH                                │
│  User edits paragraph → Embed → Discover relationships →     │
│  Score pairs → Update graph → Propagate staleness             │
│                                                               │
│  Latency target: < 55ms  |  LLM calls: 0  |  Async: yes     │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│                     READ PATH                                 │
│  AI service needs context → Traverse graph → Assemble         │
│  compressed context string → Inject into LLM prompt           │
│                                                               │
│  Latency target: < 10ms  |  LLM calls: 0  |  Sync: yes      │
└──────────────────────────────────────────────────────────────┘
```

The critical insight: **all the heavy computation happens on the write path**. By the time any AI service needs context, the answer is already precomputed and sitting in the graph. The read path is nothing but a database lookup.

---

## 2. The Document Tree

A legal document is a tree. This isn't an abstraction — it IS how the data is stored:

```
Document
 ├─ Section "Definitions"         (depth 0, type: definitions)
 │   ├─ Paragraph "Service"       (type: definition, order: 0)
 │   ├─ Paragraph "Deliverable"   (type: definition, order: 1)
 │   └─ Paragraph "Fee"           (type: definition, order: 2)
 ├─ Section "Scope of Work"       (depth 0, type: clause)
 │   ├─ Paragraph (obligation)    (type: obligation, order: 0)
 │   ├─ Table (schedule)          (title: "Deliverables", order: 1)
 │   └─ Section "Tech Reqs"       (depth 1, type: clause)
 │       ├─ Paragraph (SLA)       (order: 0)
 │       └─ Paragraph (API)       (order: 1)
 ├─ Section "Payment"             (depth 0, type: clause)
 │   ├─ Paragraph (invoicing)     (order: 0)
 │   └─ Table (pricing tiers)     (order: 1)
 └─ Section "Termination"         (depth 0, type: clause)
     ├─ Paragraph (for cause)     (order: 0)
     └─ Paragraph (for convenience)(order: 1)
```

Each node in this tree has:
- **An identity** (UUID)
- **A position** (parent FK + order integer)
- **Content** (raw text, edited text, or structured data for tables)
- **Classification** (section_type, paragraph_type, tags)

The tree is the compression mechanism. A section summary already distills all its children. We never send redundant data at two levels.

---

## 3. The Write Path — What Happens When a User Edits

### Step 1: The Trigger

User finishes editing "Paragraph A" in Section "Payment". The frontend saves the new text. A `post_save` signal fires.

### Step 2: Token-Level Embedding (BGE-M3)

The raw text of Paragraph A is sent to the embedding model. Instead of returning one single vector for the whole paragraph, the model returns a **matrix** of vectors — one per token:

```
"The Provider shall invoice monthly on net-30 terms"

Token vectors:
  "The"       → [0.12, -0.34, 0.56, ...]     (768-dim)
  "Provider"  → [0.89, 0.23, -0.11, ...]
  "shall"     → [0.45, 0.67, 0.33, ...]
  "invoice"   → [-0.22, 0.88, 0.15, ...]
  "monthly"   → [0.33, -0.45, 0.77, ...]
  "net-30"    → [0.91, 0.44, -0.28, ...]
  "terms"     → [0.15, 0.62, 0.48, ...]
```

**Why per-token instead of per-paragraph?** Because a paragraph about "monthly invoicing at net-30" should link to a paragraph about "payment due within thirty days" even though they share zero exact words. Token-level vectors let the model match "net-30" against "thirty days" at the semantic level, token-by-token.

### Step 3: Late-Interaction Discovery (MaxSim Search)

The token matrix is sent to the vector database. The query uses MaxSim (Maximum Similarity) — for each token in Paragraph A, find the most similar token across all other nodes, then sum those maximums:

```
MaxSim(A, B) = Σ max(sim(a_i, b_j)) for each token a_i in A
                  over all tokens b_j in B
```

This returns the top 15 structural nodes (paragraphs, section aggregates, tables) that have the highest token-by-token overlap with Paragraph A. These are candidates, not confirmed relationships.

**Why 15?** Empirically, the true dependency set for any clause is 2-6 nodes. Retrieving 15 gives enough margin for the reranker to work with without flooding it.

### Step 4: Cross-Encoder Scoring (Reranker)

The 15 candidates are too many, and MaxSim is a rough filter. Now we send each (Paragraph A, Candidate) pair through a cross-encoder:

```
Pairs sent to reranker:
  (Paragraph A, Candidate 1 text)  → 0.92
  (Paragraph A, Candidate 2 text)  → 0.71
  (Paragraph A, Candidate 3 text)  → 0.45
  (Paragraph A, Candidate 4 text)  → 0.88
  ...
  (Paragraph A, Candidate 15 text) → 0.23
```

The cross-encoder sees both texts simultaneously (unlike the embedding model which encodes them separately). It returns a float score per pair.

### Step 5: Classification & Thresholding

The scores are classified into dependency types:

| Score Range | Label | Meaning |
|-------------|-------|---------|
| ≥ 0.85 | **CRITICAL** | Direct dependency. Changing A requires reviewing this node. |
| 0.65 – 0.84 | **CONTEXTUAL** | Related context. Useful for understanding A but not a hard dependency. |
| < 0.65 | **Noise** | Discarded. |

From the example above:
- Candidate 1 (0.92) → **CRITICAL** — this is the "Payment Schedule" table that defines the amounts Paragraph A references
- Candidate 4 (0.88) → **CRITICAL** — this is the "Definitions" paragraph that defines "net-30"
- Candidate 2 (0.71) → **CONTEXTUAL** — this is the "Termination" clause that references payment obligations
- Candidate 3 (0.45) → Discarded
- Candidate 15 (0.23) → Discarded

### Step 6: Graph UPSERT

A single transaction updates the dependency graph:

1. **Delete** all existing outbound edges from Paragraph A
2. **Write** new edges:
   - `Paragraph A --CRITICAL(0.92)--> Payment Schedule Table`
   - `Paragraph A --CRITICAL(0.88)--> Definitions:"net-30" Paragraph`
   - `Paragraph A --CONTEXTUAL(0.71)--> Termination Clause Paragraph`

### Step 7: Upward Staleness Propagation

After the graph is updated, staleness flows upward through the tree:

```
Paragraph A edited
  → ComponentInference for Paragraph A → stale
  → SectionAggregateInference for "Payment" → stale
  → DocumentInferenceSummary → stale
```

This is pure flag-flipping — zero LLM calls. The existing summaries are still serveable, just marked as potentially outdated.

### Total Write Path Cost

| Step | Latency | Cost |
|------|---------|------|
| Embedding (BGE-M3) | ~15ms | Local GPU / API |
| MaxSim search (vector DB) | ~5ms | In-memory index |
| Cross-encoder (15 pairs) | ~25ms | Batched single call |
| Graph UPSERT | ~3ms | Single transaction |
| Staleness propagation | ~2ms | Boolean flag UPDATEs |
| **Total** | **~50ms** | **0 LLM calls** |

---

## 4. The Read Path — What Happens When an AI Service Needs Context

### The Request

An AI service needs to act on the document. Examples:
- **ai_chat**: "Does this paragraph contradict our standard payment terms?"
- **ai_chat_edit**: "Rewrite this paragraph to be clearer"
- **paragraph_ai_review**: Score this paragraph for quality, risk, compliance
- **document_scoring**: Rate the entire document across 6 dimensions
- **ai_generate_latex**: Generate LaTeX with full document awareness

All of these need context. But they need different amounts and shapes of context.

### The Graph Traversal

A single query retrieves everything needed. Because the graph stores pre-computed relationships with scores, there's no search step — just pointer traversal:

```
Query for Paragraph A context:

1. SELF: Paragraph A's ComponentInference
   → summary, entities, tags, importance

2. LATERAL (from graph edges):
   → Payment Schedule Table (CRITICAL, 0.92): summary + entities
   → Definitions:"net-30" (CRITICAL, 0.88): summary
   → Termination Clause (CONTEXTUAL, 0.71): summary

3. VERTICAL (from tree structure):
   → Parent: Section "Payment" aggregate: purpose + obligations
   → Ancestor: Document gist + parties
```

**Lateral** = cross-section relationships discovered by the write path.
**Vertical** = hierarchical containment from the tree structure.

Both are pre-computed. The read path just follows pointers.

### Context Assembly

The traversal results are stitched into a compressed context string:

```
[This paragraph] Provider shall invoice monthly on net-30 terms
  Type: obligation, payment
  Entities: Provider, monthly, net-30

[→ CRITICAL] Payment Schedule Table: 12 line items totaling USD 2.4M
  Entities: USD 2.4M, Q1-Q4, milestone-based
[→ CRITICAL] Defined term "net-30": payment due within 30 calendar days
[→ CONTEXTUAL] Termination §7.1: early termination requires settling invoices

[Section: Payment] Governs all financial obligations between parties
  Obligations: monthly invoicing; net-30 terms; milestone payments
  Risks: no late-payment penalty clause
[↑ Document Body] Main contractual provisions
[Document: Services Agreement] Acme ↔ Widget | obligations, payment, SLA
```

This is what the LLM sees. ~10 lines. The AI knows:
- What this paragraph says (self)
- What it depends on (lateral: the table it references, the term it uses)
- What related clauses exist (lateral: termination impacts payment)
- Where it sits in the hierarchy (vertical: section purpose, document gist)
- What the document is about (vertical: parties, type, risks)

### Read Path Cost

| Step | Latency | Cost |
|------|---------|------|
| Graph traversal | ~2ms | Pointer follows, no scan |
| Tree ancestor walk | ~3ms | 1-6 DB queries (depth) |
| String assembly | ~1ms | In-memory concatenation |
| **Total** | **~6ms** | **0 LLM calls** |

---

## 5. The Three Inference Levels (Background Refresh)

The write path handles real-time dependency tracking. But the **summaries** at each tree level are produced by a separate background process — the Tree Inference Engine. This runs asynchronously and produces the dense text that the read path serves.

### Level 1 — Leaf Inference

Every leaf component gets an AI-generated analysis:

```
Input:  Raw text of one paragraph (up to 4000 chars)
Output: {
  summary: "1-3 sentence distillation",
  key_entities: ["Provider", "USD 250,000", "net-30"],
  context_tags: ["obligation", "payment"],
  relationships: [{target: "Definitions §1", type: "references"}],
  importance: 0.9
}
```

Each paragraph produces ~50 tokens of summary from ~500 tokens of raw text. **10:1 compression at the leaf level.**

### Level 2 — Section Aggregation

Starting from deepest sections, working upward:

```
Input:  Child summaries (NOT raw text) — ~200 tokens total
Output: {
  summary: "3-5 sentence merged summary",
  section_purpose: "Governs all financial obligations",
  key_obligations: ["monthly invoicing", "net-30 terms"],
  risk_indicators: ["no late-payment penalty"],
  key_terms_defined: []
}
```

The LLM reads child summaries (already compressed) and produces a higher-level abstraction. **What it adds over children**: purpose, inter-child relationships, risk patterns visible only when seeing all children together.

### Level 3 — Document Aggregation

```
Input:  Root section aggregates — ~500 tokens total
Output: {
  summary: "5-8 sentence executive summary",
  document_purpose: "Master services agreement...",
  parties_identified: ["Acme Corp (Provider)", "Widget Inc (Client)"],
  cross_section_issues: ["§3 Payment contradicts §7 Termination on net terms"]
}
```

**This is where cross-section intelligence emerges.** No individual section can detect that Payment contradicts Termination — only the document-level view sees across boundaries.

### Incremental Processing

Each inference stores a SHA-256 hash. On re-run, unchanged subtrees are skipped:

```
200-page document, 40 sections
User edits 1 paragraph in Section 12

Re-inference:
  Sections 1–11:  SKIP (hash match)     → 0 LLM calls
  Section 12:     Re-infer 1 para + agg  → 2 LLM calls
  Sections 13–40: SKIP (hash match)     → 0 LLM calls
  Document agg:   Re-run (hash changed)  → 1 LLM call
  Total: 3 LLM calls instead of 100+
```

---

## 6. How AI Services Consume Context

Every AI service in the system follows the same pattern:

```
1. Determine scope (paragraph / section / document)
2. Call get_context_for_scope(document, scope, scope_id)
3. Receive compressed context string (pre-computed, ~6ms)
4. Inject into LLM prompt as "DOCUMENT INTELLIGENCE" block
5. Send to reasoning LLM (GPT-4o / Gemini / Claude)
```

The context string is the same regardless of which service consumes it. The services differ in what they DO with the LLM's response:

| Service | Scope | What it does with the response |
|---------|-------|-------------------------------|
| **ai_chat** | paragraph / section / document | Returns conversational answer to user question |
| **ai_chat_edit** | paragraph / section | Returns rewritten text + diff |
| **paragraph_ai_review** | paragraph | Returns quality score, risk flags, suggestions |
| **document_scoring** | document | Returns 6-dimension score + clause-level review |
| **ai_generate_latex** | document | Returns LaTeX code with full document awareness |
| **CLM inference node** | document | Returns structured extraction for workflow |

All of these are **readers**. They consume the pre-built context. None of them compute it.

---

## 7. Scope-Relative Context Shapes

Different scopes produce different context shapes. The tree hierarchy determines what's included:

### Paragraph Scope

```
SELF (leaf inference)
  + LATERAL (graph edges: CRITICAL + CONTEXTUAL dependencies)
  + PARENT (section aggregate: purpose + obligations)
  + ANCESTORS (one-liner per level up to root)
  + DOCUMENT GIST (one line: purpose + parties)
```

Typical size: **~12 lines, ~200 tokens**

### Section Scope

```
SELF (section aggregate: full summary + purpose + obligations + risks)
  + CHILDREN (one-liner per child component)
  + SUBSECTIONS (one-liner per child section)
  + LATERAL (graph edges from section's components to other sections)
  + ANCESTORS (one-liner per level)
  + DOCUMENT GIST
```

Typical size: **~25 lines, ~400 tokens**

### Document Scope

The full tree context — every section as one indented line:

```
[Doc] Services Agreement | Acme ↔ Widget | obligations, indemnity
  [§] Definitions | defines: Service, Deliverable, Fee
  [§] Scope of Work | obligations | deliver by Q3 2026
    [§] Technical Requirements | 99.9% uptime, API specs
  [§] Payment | monthly invoicing, net-30 | USD 250,000
  [§] Liability | cap at 2× annual fees | no consequential
  [§] Termination | 90-day notice | cure period 30 days
  [§] Confidentiality | 3-year survival | excludes public info
  [§] Dispute Resolution | arbitration, London | English law
```

Entire document in **~10 lines, ~150 tokens**. This is the maximally compressed form — the tree IS the compression.

---

## 8. The Dependency Graph — Lateral Relationships

The tree captures containment (what's inside what). The graph captures **attention** (what relates to what across the tree).

### Why Lateral Edges Matter

Consider: "The Provider shall deliver services per the schedule in Exhibit A (Section 8), subject to the payment terms in Section 3."

This single paragraph **attends to** three other locations:
1. Exhibit A (Section 8) — the deliverables schedule
2. Section 3 — the payment terms
3. Implicitly — the definition of "Provider" in Section 1

Without lateral edges, the AI editing this paragraph would only see its parent section (Scope of Work). It would have no idea that changing "per the schedule" impacts Exhibit A, or that "payment terms" means net-30 from Section 3.

### Edge Types and Scores

```
Paragraph A ──CRITICAL(0.92)──→ Exhibit A Table
             ──CRITICAL(0.88)──→ §3 Payment Paragraph
             ──CONTEXTUAL(0.71)→ §1 "Provider" Definition
```

**CRITICAL edges** mean: if you change A, you must check these nodes. They are hard dependencies.

**CONTEXTUAL edges** mean: these are helpful background for understanding A, but changing A doesn't necessarily impact them.

### How Lateral Context Enters the Prompt

When assembling context for Paragraph A, lateral edges are rendered immediately after SELF:

```
[This paragraph] Provider shall deliver per schedule, subject to payment terms
  Type: obligation
  Entities: Provider, Exhibit A, Section 3

[→ CRITICAL: Exhibit A] Deliverables schedule: 12 milestones, Q1-Q4 2026
[→ CRITICAL: §3 Payment] Monthly invoicing, net-30, milestone-based
[→ CONTEXTUAL: §1 Definitions] "Provider" = Acme Corp and its affiliates

[Section: Scope of Work] ...
[Document: Services Agreement] ...
```

The AI now has everything it needs to understand this paragraph in full context — both hierarchical (where it sits) and relational (what it connects to).

---

## 9. Compression Ratios

| Document | Raw Text | After Leaf Inference | After Section Agg | Tree Context (Read Path Output) |
|----------|----------|---------------------|-------------------|---------------------------------|
| 10 pages | ~25K tokens | ~3K tokens (summaries) | ~800 tokens | ~15 lines (~200 tokens) |
| 50 pages | ~125K tokens | ~12K tokens | ~3K tokens | ~40 lines (~500 tokens) |
| 200 pages | ~500K tokens | ~40K tokens | ~8K tokens | ~100 lines (~1.2K tokens) |

The tree context achieves **~400:1 compression** for a 200-page document. That's the entire document in ~1200 tokens — well within any LLM's working memory.

---

## 10. Production Considerations

### 10.1 Write Path Debouncing

Users type continuously. We can't run the write path on every keystroke.

**Strategy**: Debounce at 2 seconds after last edit. If the user is actively typing, batch changes. Only trigger the embedding → MaxSim → reranker → graph pipeline when the user pauses or explicitly saves.

### 10.2 Background Inference Scheduling

The three-level summary inference (leaf → section → document) is expensive (LLM calls). Options:

| Strategy | When summaries refresh | Cost |
|----------|----------------------|------|
| **On-save** | Every paragraph save | Expensive during rapid editing |
| **On-pause** | 30s after last edit in a section | Good balance |
| **On-demand** | User clicks "refresh" or AI service detects staleness | Cheapest, but context can be stale |
| **Hybrid** | Leaf on-save, section on-pause, document on-demand | Best of all worlds |

The hybrid approach: leaf inference is cheap (one paragraph → one LLM call), section aggregation is moderate (batch after editing session), document aggregation is heavy (trigger explicitly or when an AI service needs it and it's stale).

### 10.3 Staleness Is Acceptable

A key design principle: **stale summaries are better than no summaries**. If a user edited Paragraph A but inference hasn't re-run yet, the old summary is still ~90% accurate (most edits are refinements, not wholesale rewrites). The read path serves the stale summary with a flag, and the consuming AI service can decide whether to proceed or request a refresh.

### 10.4 Cross-Document Relationships

When comparing two versions of a contract (branching), or when a CLM workflow processes multiple documents:

- Each document has its own tree + graph
- Cross-document edges could connect corresponding sections (e.g., "Section 3 in v2 amends Section 3 in v1")
- Document-level summaries from both can be placed side-by-side in the LLM prompt

This is a natural extension — the same read path, just querying across two document graphs.

### 10.5 Handling Tables

Tables are structurally different from paragraphs. A pricing table with 50 rows carries meaning in its **structure** (columns, aggregates, patterns) not just its text.

Table inference produces:
- Summary (what the table shows)
- Column semantics (what each column means)
- Data insights (totals, patterns, outliers)
- Key entities (monetary values, dates)

This lets the section aggregate say "Payment table: 12 line items totaling USD 2.4M, Q1–Q4 delivery" instead of a vague summary.

### 10.6 Graceful Degradation

When inference hasn't run (fresh document, no summaries yet), the read path produces a structural skeleton from raw model data:

```
[Doc] Services Agreement | contract
  [§] Definitions | 5p, 0t
  [§] Scope of Work | 3p, 1t, 2sub
  [§] Payment | 2p, 1t
```

No AI summaries, but the tree structure itself is informative. The AI reading this knows there's a Definitions section with 5 paragraphs, Scope of Work has a table and subsections, etc. This is enough for basic context, and it's assembled in <1ms with zero LLM calls.

---

## 11. The Full Picture

```
USER EDITS PARAGRAPH
        │
        ▼
  ┌─────────────────────────────────────────────┐
  │              WRITE PATH (~50ms)               │
  │                                               │
  │  1. Embed tokens (BGE-M3)          ~15ms     │
  │  2. MaxSim search (vector DB)       ~5ms     │
  │  3. Cross-encoder rerank (TEI)     ~25ms     │
  │  4. Graph UPSERT (edges)            ~3ms     │
  │  5. Staleness propagation           ~2ms     │
  │                                               │
  │  Result: dependency graph updated             │
  │  LLM calls: 0                                 │
  └─────────────────────────────────────────────┘
        │
        ▼ (async, background)
  ┌─────────────────────────────────────────────┐
  │        SUMMARY REFRESH (when needed)          │
  │                                               │
  │  1. Leaf inference (paragraph → summary)      │
  │  2. Section aggregation (bottom-up)           │
  │  3. Document aggregation (top-level)          │
  │                                               │
  │  Hash-based: only changed subtrees re-run     │
  │  LLM calls: 1-3 for single paragraph edit     │
  └─────────────────────────────────────────────┘
        │
        │  (pre-computed summaries + graph edges
        │   are now sitting in the database)
        │
        ▼
  ANY AI SERVICE REQUESTS CONTEXT
        │
        ▼
  ┌─────────────────────────────────────────────┐
  │              READ PATH (~6ms)                 │
  │                                               │
  │  1. Self: ComponentInference lookup    ~1ms   │
  │  2. Lateral: graph edge traversal      ~2ms   │
  │  3. Vertical: ancestor walk            ~2ms   │
  │  4. Assembly: string concatenation     ~1ms   │
  │                                               │
  │  Result: dense context string                 │
  │  LLM calls: 0                                 │
  └─────────────────────────────────────────────┘
        │
        ▼
  ┌─────────────────────────────────────────────┐
  │           AI SERVICE EXECUTION                │
  │                                               │
  │  Context string injected into prompt          │
  │  + user's question / task                     │
  │  → Sent to reasoning LLM                      │
  │  → Response returned to user                  │
  │                                               │
  │  Services: chat, edit, review, score,         │
  │            latex gen, CLM, dashboard           │
  └─────────────────────────────────────────────┘
```

**The entire AI platform is built on this foundation.** Every AI service — scoring, chat, editing, review, generation — is just a consumer of the pre-built context. The write path ensures the graph is always current. The read path ensures context assembly is instant. The reasoning LLM only sees what matters, compressed to minimum tokens by the tree hierarchy and filtered by the dependency graph.

---

## 12. Why Not RAPTOR? — Structural Determinism vs Semantic Clustering

RAPTOR (Recursive Abstractive Processing for Tree-Organized Retrieval), introduced by Stanford, builds a hierarchy by:
1. Embedding all text chunks
2. Clustering them with k-means / Gaussian Mixture Models
3. Summarising each cluster
4. Repeating recursively up the tree

The key difference: **RAPTOR discovers its tree structure through statistical clustering. We already have it.**

```
RAPTOR's approach:                     Our approach:
                                       
Raw chunks                             Document
  → embed all                            → already a tree
  → cluster (GMM/k-means)               → Section → Paragraph → Sentence
  → summarise each cluster               → summarise each node
  → re-cluster summaries                 → aggregate each section
  → summarise again                      → aggregate document
  → ... until single root                → done (deterministic)
```

| Dimension | RAPTOR | Our Architecture |
|-----------|--------|------------------|
| Tree structure | Discovered via clustering (fuzzy, non-deterministic) | Deterministic — the document's actual legal structure |
| Chunk boundaries | Arbitrary (sliding window, overlap) | Semantic — each paragraph/clause is a natural unit |
| Cluster quality | Depends on embedding space geometry | N/A — structure is given by the author |
| Cross-cluster links | None — siblings in a cluster are related, but there's no lateral traversal | Explicit CRITICAL/CONTEXTUAL edges via MaxSim + cross-encoder |
| Update cost | Full re-cluster on any change | Incremental — only the edited subtree re-processes |
| Legal precision | A definitions clause might cluster with the wrong section | "Fee" is always in Section 1 "Definitions" — structural truth |
| Reproducibility | Different runs → different clusters → different trees | Same document → same tree → same context, always |

**RAPTOR's weakness for legal documents**: A clause defining "Force Majeure" and a clause invoking "Force Majeure" will embed near each other and likely cluster together. But legally they are in different sections with different functions (definition vs. application). RAPTOR merges them; we keep them separate with a CRITICAL lateral edge linking them.

**Where RAPTOR wins**: Unstructured corpora with no inherent hierarchy (research papers, web crawls, knowledge bases). When you don't have structure, discovering it statistically is the only option.

**Our hybrid**: We use RAPTOR's insight (summarise recursively up) but on a deterministic tree (the document's own structure) and augment with lateral edges (which RAPTOR cannot do). This is the best of both worlds.

---

## 13. Technology Stack — Recommendations & Alternatives

### 13.1 Embedding Layer

The embedding model converts component text into vectors for relationship discovery. The choice here determines the quality of lateral edges.

| Model | Dim | MaxSim? | Multilingual | Speed (GPU) | Legal Domain | Recommendation |
|-------|-----|---------|-------------|-------------|--------------|----------------|
| **BGE-M3** (BAAI) | 1024 | ✅ Native token-level | 100+ langs | ~15ms/para | Strong on technical text | **Primary choice** — only production model with native multi-vector for MaxSim |
| **ColBERTv2** | 128/token | ✅ Native (invented MaxSim) | English only | ~10ms/para | Good | Best raw MaxSim quality, but English-only limits legal use |
| **ColPali** (Vidore) | 128/token | ✅ | Multimodal (images) | ~20ms/para | Untested | If you ever need to embed scanned PDFs / images directly |
| **E5-Mistral-7B** | 4096 | ❌ Single vector | English-focused | ~80ms/para | Excellent legal | Best single-vector quality, but no MaxSim — would need HNSW fallback |
| **NomicEmbed** | 768 | ❌ Single vector | English | ~8ms/para | Good | Fastest, but single-vector means no fine-grained token matching |
| **Jina-ColBERT-v2** | 128/token | ✅ | 90+ langs | ~12ms/para | Good | Strong multilingual alternative to BGE-M3 if you need smaller dim |

**Verdict**: **BGE-M3** is the right choice. It's the only model that natively supports all three retrieval modes (dense, sparse, multi-vector) in a single forward pass. For legal documents where "net-30" must match "thirty days", token-level MaxSim is non-negotiable. ColBERTv2 invented the technique but is English-only.

**Deployment**: Run via [Hugging Face TEI](https://github.com/huggingface/text-embeddings-inference) (Text Embeddings Inference) for production throughput, or `sentence-transformers` for development.

```
# Production (TEI container)
docker run --gpus all -p 8081:80 \
  ghcr.io/huggingface/text-embeddings-inference:latest \
  --model-id BAAI/bge-m3 --max-client-batch-size 64

# Development (Python, no Docker)
from FlagEmbedding import BGEM3FlagModel
model = BGEM3FlagModel('BAAI/bge-m3', use_fp16=True)
output = model.encode(["paragraph text"], return_colbert_vecs=True)
# output['colbert_vecs'] → list of token-level matrices
```

### 13.2 Vector Database — MaxSim Search

MaxSim is not standard cosine/dot-product search. Most vector databases only support single-vector queries. You need one that natively handles multi-vector (late interaction) or can be extended.

| Database | MaxSim Native? | On-Disk Index | Filtering | Multi-Tenancy | Recommendation |
|----------|---------------|---------------|-----------|---------------|----------------|
| **Qdrant** | ✅ `multi_vector` since v1.10 | Yes (mmap) | Rich payload filters | Collection-per-org or payload filter | **Primary choice** — only DB with native multi-vector + MaxSim |
| **Vespa** | ✅ Native ColBERT/MaxSim | Yes | Full query language | Yes | Best for scale, but heavy operational overhead |
| **Milvus** | ❌ (single vector only) | Yes | Attribute filters | Limited | Would need to flatten token vectors → loses MaxSim |
| **Weaviate** | ❌ | Yes | GraphQL filters | Module-based | No multi-vector support |
| **Pinecone** | ❌ | Managed | Metadata filters | Namespace-based | No multi-vector support |
| **ChromaDB** | ❌ | SQLite-backed | Basic where filters | No | Dev only, no MaxSim |
| **pgvector** | ❌ | Postgres extension | Full SQL | Yes | Could store single vectors, but no MaxSim |

**Verdict**: **Qdrant** is the only practical choice for MaxSim at reasonable operational cost. Vespa can do it but is designed for much larger scale (billions of vectors) and requires significant DevOps. Qdrant runs as a single binary, has a Python client, supports payload filtering (for org-scoping), and added native multi-vector in v1.10.

**Architecture note**: Each document component gets stored as a Qdrant point with:
- `id`: component UUID
- `vector`: `{"colbert": [[0.12, ...], [0.89, ...], ...]}`  (token matrix)
- `payload`: `{"document_id": "...", "org_id": "...", "component_type": "paragraph", "section_id": "..."}`

MaxSim query: `search(collection, query_vector=token_matrix, using="colbert", limit=15, filter={"document_id": doc_id})`

```
# Qdrant setup
docker run -p 6333:6333 -p 6334:6334 qdrant/qdrant:latest

# Python client
from qdrant_client import QdrantClient, models
client = QdrantClient("localhost", port=6333)

client.create_collection(
    collection_name="doc_components",
    vectors_config={
        "colbert": models.VectorParams(
            size=1024,           # BGE-M3 token dim
            distance=models.Distance.COSINE,
            multivector_config=models.MultiVectorConfig(
                comparator=models.MultiVectorComparator.MAX_SIM,
            ),
        ),
    },
)
```

### 13.3 Cross-Encoder Reranker

The reranker sees both texts jointly (cross-attention) and produces a fine-grained relevance score. This is where CRITICAL vs CONTEXTUAL classification happens.

| Model | Params | Speed (15 pairs) | Quality | Multilingual | Recommendation |
|-------|--------|------------------|---------|-------------|----------------|
| **bge-reranker-v2-m3** (BAAI) | 568M | ~25ms (GPU) | SOTA on MTEB rerank | 100+ langs | **Primary choice** — pairs naturally with BGE-M3 embedder |
| **bge-reranker-v2-gemma** | 2B | ~80ms (GPU) | Highest quality | 100+ langs | If you need max precision and can afford latency |
| **Jina-reranker-v2** | 278M | ~15ms (GPU) | Near-SOTA | 100+ langs | Faster, slightly lower quality |
| **Cohere Rerank v3** | Unknown (API) | ~50ms (API call) | Very high | Multilingual | No self-hosting, but zero DevOps |
| **cross-encoder/ms-marco-MiniLM-L-12** | 33M | ~5ms (CPU) | Good for general text | English | CPU-friendly, but weaker on legal domain |
| **RankGPT (GPT-4 listwise)** | N/A | ~2000ms | Excellent | All | LLM-based reranking — too slow for write path, but interesting for batch audit |

**Verdict**: **bge-reranker-v2-m3** — it's the natural pair for BGE-M3 (same training methodology), has the best quality-to-speed ratio, and handles multilingual legal text. Run via TEI for production:

```
# Production (TEI reranker)
docker run --gpus all -p 8082:80 \
  ghcr.io/huggingface/text-embeddings-inference:latest \
  --model-id BAAI/bge-reranker-v2-m3

# Python (direct)
from FlagEmbedding import FlagReranker
reranker = FlagReranker('BAAI/bge-reranker-v2-m3', use_fp16=True)
scores = reranker.compute_score([
    ["Paragraph A text", "Candidate 1 text"],
    ["Paragraph A text", "Candidate 2 text"],
    # ... up to 15 pairs
])
# scores → [0.92, 0.71, 0.45, ...]
```

### 13.4 Graph Storage — Lateral Edges

The lateral dependency graph stores CRITICAL and CONTEXTUAL edges. Requirements: fast edge traversal, UPSERT (delete-all-from + insert-batch), org-scoped filtering.

| Option | Type | Read Latency | UPSERT | Django Integration | Recommendation |
|--------|------|-------------|--------|-------------------|----------------|
| **Django ORM (PostgreSQL/SQLite)** | Relational | ~2ms (indexed) | Single transaction | Native | **Phase 1** — simplest, already in stack |
| **Neo4j** | Graph DB | ~1ms (Cypher) | Transaction | `neomodel` or raw Bolt | Overkill unless graph gets very dense |
| **SurrealDB** | Multi-model (doc+graph+relational) | ~1ms | UPSERT native | REST API | Interesting but immature ecosystem |
| **Amazon Neptune / Azure Cosmos Gremlin** | Managed graph | ~3ms | Gremlin transactions | SDK | Cloud-only, high cost |
| **Redis Graph (FalkorDB)** | In-memory graph | <1ms | Cypher-like | `redis-py` | Fastest, but volatile (needs persistence config) |
| **Adjacency table in PostgreSQL** | Relational with recursive CTEs | ~2ms | Standard SQL | Django ORM | Battle-tested, zero new infra |

**Verdict for Phase 1**: **Django ORM adjacency model**. Add a `LateralEdge` model:

```python
class LateralEdge(models.Model):
    """Pre-computed dependency edge between two document components."""
    
    class EdgeType(models.TextChoices):
        CRITICAL = 'critical', 'Critical'       # score ≥ 0.85
        CONTEXTUAL = 'contextual', 'Contextual' # score 0.65–0.84
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    document = models.ForeignKey('documents.Document', on_delete=models.CASCADE)
    
    source_content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE, related_name='+')
    source_object_id = models.UUIDField()
    source = GenericForeignKey('source_content_type', 'source_object_id')
    
    target_content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE, related_name='+')
    target_object_id = models.UUIDField()
    target = GenericForeignKey('target_content_type', 'target_object_id')
    
    edge_type = models.CharField(max_length=20, choices=EdgeType.choices)
    score = models.FloatField()
    
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        indexes = [
            models.Index(fields=['source_content_type', 'source_object_id']),
            models.Index(fields=['target_content_type', 'target_object_id']),
            models.Index(fields=['document', 'edge_type']),
        ]
```

This gives you sub-2ms reads with proper indexing, zero new infrastructure, and Django-native transactions for the UPSERT pattern (delete-then-insert in a single `transaction.atomic()`).

**Phase 2 upgrade path**: If a document exceeds ~500 sections and lateral edge queries slow down, migrate to PostgreSQL with `ltree` extension for hierarchical queries, or introduce Redis Graph for sub-millisecond traversal. This is unlikely for legal documents (even a 500-page contract has ~100 sections).

### 13.5 Summary Inference LLM

The background inference engine that produces leaf summaries → section aggregates → document summaries. This is the only LLM-calling component.

| Model | Cost/1M tokens | Speed | Legal Quality | JSON Reliability | Recommendation |
|-------|---------------|-------|--------------|-----------------|----------------|
| **Gemini 2.0 Flash** | ~$0.075 input | Very fast | Good | Good with prompting | **Current choice** — already integrated |
| **Gemini 2.5 Flash** | ~$0.15 input | Fast | Very good | Excellent | Upgrade when available — better structured output |
| **GPT-4o-mini** | ~$0.15 input | Fast | Good | Excellent (function calling) | Strong alternative, native JSON mode |
| **Claude 3.5 Haiku** | ~$0.25 input | Fast | Excellent for legal | Very good | Best legal understanding at this price |
| **Llama 3.1 8B (local)** | $0 (GPU cost) | ~200ms/para | Moderate | Needs fine-tuning | For air-gapped / cost-sensitive deployments |
| **Mistral Small** | ~$0.10 input | Fast | Good | Good | Good balance if diversifying away from Google |

**Verdict**: **Gemini Flash** is the right choice for now — it's already wired into the engine, fast, cheap, and good enough for structural summarisation (which is less demanding than open-ended reasoning). The 10:1 compression at leaf level works well with Flash-tier models.

**Key principle**: The summary LLM doesn't need to be the best reasoning model. It's doing structured extraction (entities, tags, summary), not open-ended analysis. Flash-tier models at $0.10/M tokens are optimal. Save the expensive reasoning models (GPT-4o, Claude Opus, Gemini Pro) for the AI services that consume the context.

### 13.6 Serving Infrastructure (Single-Server vs Distributed)

| Component | Dev (single machine) | Production (small team) | Scale (enterprise) |
|-----------|---------------------|------------------------|-------------------|
| **Embedder** | `sentence-transformers` in-process | TEI container (GPU) | TEI cluster behind load balancer |
| **Reranker** | `FlagEmbedding` in-process | TEI container (GPU) | TEI cluster (can share GPU with embedder) |
| **Vector DB** | Qdrant single-node (Docker) | Qdrant single-node (persistent volume) | Qdrant distributed (sharded) |
| **Graph** | SQLite (Django ORM) | PostgreSQL (Django ORM) | PostgreSQL with read replicas, or Neo4j |
| **Task queue** | Django signals (sync) | Celery + Redis | Celery + Redis cluster |
| **Summary LLM** | Gemini API direct | Gemini API with retry/backoff | Gemini API + fallback to local Llama |

**Phase 1 target** (current): Everything runs on a single machine. Embedder and reranker load as Python modules. Qdrant runs in Docker. Graph is SQLite via Django ORM. Write path runs synchronously in the `post_save` signal. Good for up to ~50 concurrent users.

**Phase 2 target**: Move embedding/reranking to TEI containers on GPU. Move graph to PostgreSQL. Write path becomes async via Celery. Good for up to ~500 concurrent users.

---

## 14. The Lateral Context Advantage — Worked Example

To illustrate why deterministic structure + lateral edges beats RAPTOR-style clustering, here's a concrete example:

```
[Document] Master Services Agreement | Parties: Acme, Widget

  [Section: 1. Definitions]
    [Paragraph: "Fee"] "Fee" means a flat rate of USD 250,000 per quarter.
    [Paragraph: "Invoice Date"] "Invoice Date" means the 1st of each calendar month.
    [Paragraph: "Force Majeure"] "Force Majeure" includes natural disasters, war...

  [Section: 4. Payment Terms]
    [Paragraph: Payment Obligation] The Client must pay the Fee within 30 days
      of the Invoice Date. Late payments accrue interest at LIBOR + 3%.
    [Table: Fee Schedule] Q1: $250K, Q2: $250K, Q3: $250K, Q4: $250K

  [Section: 7. Termination]
    [Paragraph: Termination for Cause] Either party may terminate if the other
      fails to cure a material breach within 60 days of written notice.
    [Paragraph: Post-Termination] Upon termination, all outstanding Fees become
      immediately due and payable.
```

### What RAPTOR would produce:

Clustering might group "Fee" definition with "Fee Schedule" table and "Payment Obligation" (they all mention money). But it would likely miss:
- The "Invoice Date" definition (different vocabulary — "calendar month" vs "30 days")
- The "Post-Termination" clause in Section 7 (different section, different cluster)

RAPTOR's tree would look something like:

```
Cluster A: {Fee definition, Fee Schedule, Payment Obligation}  → "Payment-related"
Cluster B: {Invoice Date, Force Majeure}  → "Definitions"  (wrongly grouped)
Cluster C: {Termination for Cause, Post-Termination}  → "Termination"
```

An AI editing the Payment Obligation paragraph would see Cluster A's summary. It would NOT automatically see that "Invoice Date" means the 1st of each month, or that Post-Termination makes fees immediately due on termination.

### What our system produces:

Write path discovers lateral edges via MaxSim + cross-encoder:

```
Payment Obligation paragraph:
  → CRITICAL (0.94): "Fee" definition         (referenced term)
  → CRITICAL (0.91): "Invoice Date" definition (referenced term)
  → CRITICAL (0.89): Fee Schedule table        (the amounts being paid)
  → CONTEXTUAL (0.73): Post-Termination clause (payment on termination)
```

Read path assembles:

```
[This Paragraph] The Client must pay the Fee within 30 days of the Invoice Date.
  Type: obligation, payment
  Entities: Client, Fee, Invoice Date, 30 days, LIBOR + 3%

[→ CRITICAL] Defined term "Fee": flat rate of USD 250,000 per quarter
[→ CRITICAL] Defined term "Invoice Date": 1st of each calendar month
[→ CRITICAL] Fee Schedule: 4 quarters × $250K = $1M annual
[→ CONTEXTUAL] §7 Post-Termination: all outstanding Fees due immediately on termination

[Section: 4. Payment Terms] Governs invoicing cadence, payment windows, late fees
  Risks: LIBOR + 3% penalty rate; no grace period specified
[↑ Document] Master Services Agreement | Acme ↔ Widget | $1M/yr services contract
```

The AI now knows:
1. "Fee" = $250K/quarter (from the definition, not guessed)
2. "Invoice Date" = 1st of month (so "30 days" means payment by ~31st)
3. Total annual value = $1M (from the table)
4. Termination risk: all fees accelerate on breach (from Section 7)
5. Missing risk: no grace period before interest accrues

**None of this requires the AI to have read the full 200-page contract.** It got 5 lines of lateral context + 3 lines of hierarchical context = 8 lines total. That's the power of deterministic structure + relationship discovery.

---

## 15. Open Questions & Discussion Points

1. **Cross-document lateral edges**: When comparing v1 and v2 of a contract (branching), should we run MaxSim across document boundaries to find corresponding clauses? This would enable "what changed between versions" without diffing raw text.

2. **Table-specific embeddings**: Tables have structure (columns, rows) that paragraph embeddings miss. Should we embed tables differently — perhaps as linearised "column: value" pairs, or as separate column-header embeddings?

3. **Definition section special handling**: Legal definitions are cross-referenced everywhere. Should we pre-compute a "definitions index" and add CRITICAL edges from every paragraph that uses a defined term, bypassing MaxSim entirely? (Regex + exact match would be faster and more reliable for defined terms.)

4. **Embedding refresh strategy**: When a paragraph changes, do we re-embed ALL paragraphs to update the vector DB, or just the changed one? MaxSim comparisons are asymmetric — Paragraph B's relationship to A might change even if B didn't change (because A's embedding changed). Should we periodically re-compute all-pairs?

5. **Score threshold tuning**: The 0.85 / 0.65 cutoffs for CRITICAL / CONTEXTUAL are starting points. Should we learn these per document type? A definitions-heavy contract might need a lower CRITICAL threshold than a narrative NDA.

6. **Inference cascade depth**: Currently the tree has 3 levels (leaf → section → document). For very deep nesting (subsections of subsections), should we add intermediate aggregation levels, or flatten to 3?

7. **Real-time vs batch write path**: The current design runs the full write path (embed → search → rerank → graph) synchronously on save. For rapid editing, should the embedding step be real-time but the MaxSim + reranker step be batched every N seconds?

8. **Graceful degradation ordering**: When inference is partially stale, which context is most important to serve fresh? Hypothesis: CRITICAL lateral edges > self summary > section aggregate > CONTEXTUAL edges > document gist. Should the read path indicate freshness per context block?
