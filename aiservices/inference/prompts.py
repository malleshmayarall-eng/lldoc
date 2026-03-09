"""
Inference Prompts — Tiered prompts for each hierarchy level
=============================================================

Three tiers of prompts:

1. **Component-level** — leaf nodes (Paragraph, Sentence, LatexCode, Table)
   → produce a summary, key entities, tags, sentiment, complexity, importance.

2. **Section-level aggregation** — merge child summaries into a single
   section context.

3. **Document-level aggregation** — merge root-section aggregates into a
   single document-wide context.

All prompts instruct the LLM to return **strict JSON** (no prose).
"""

# ──────────────────────────────────────────────────────────────────────────
# 1. Component-level inference
# ──────────────────────────────────────────────────────────────────────────

COMPONENT_INFERENCE_PROMPT = """\
You are a legal document analysis engine.  Given a single document component
(a paragraph, sentence, LaTeX block, or table), produce a structured analysis.

COMPONENT TYPE: {component_type}
SECTION TITLE : {section_title}
COMPONENT ORDER: {component_order}

COMPONENT CONTENT:
\"\"\"
{content}
\"\"\"

Return ONLY a JSON object with these fields (no markdown, no prose):
{{
  "summary": "<1-3 sentence natural-language summary of what this component says>",
  "key_entities": ["<entity1>", "<entity2>", ...],
  "context_tags": ["<tag1>", "<tag2>", ...],
  "relationships": [
    {{"target_description": "<what it references>", "relation_type": "<defines|amends|contradicts|depends_on|references>", "description": "<brief explanation>"}}
  ],
  "sentiment": <float -1.0 to 1.0>,
  "complexity": <float 0.0 to 1.0>,
  "importance": <float 0.0 to 1.0>
}}

RULES:
- key_entities: names, dates, monetary amounts, legal terms, defined terms.
- context_tags: pick from [obligation, permission, condition, definition,
  exception, right, warranty, indemnity, termination, payment, confidentiality,
  dispute, compliance, boilerplate, schedule, data, pricing, technical, other].
- relationships: cross-references to other clauses, defined terms, or external docs.
- sentiment: -1 = highly unfavourable, 0 = neutral, +1 = highly favourable.
- complexity: 0 = simple/clear, 1 = extremely complex/dense.
- importance: 0 = trivial, 1 = critical to the document's core meaning.
- Return ONLY the JSON object — no fences, no explanation.
"""


# ──────────────────────────────────────────────────────────────────────────
# 2. Section-level aggregation
# ──────────────────────────────────────────────────────────────────────────

SECTION_AGGREGATE_PROMPT = """\
You are a legal document analysis engine performing hierarchical inference.

Given the child-component summaries of a document section, produce a merged
section-level summary.

SECTION TITLE: {section_title}
SECTION TYPE : {section_type}
DEPTH LEVEL  : {depth_level}

CHILD SUMMARIES (ordered):
{child_summaries_json}

Return ONLY a JSON object:
{{
  "summary": "<3-5 sentence merged summary capturing the section's purpose, key obligations, and important terms>",
  "aggregated_entities": ["<deduplicated union of all child entities>"],
  "aggregated_tags": ["<deduplicated union of all child tags>"],
  "aggregated_relationships": [
    {{"source_component": "<id>", "target_description": "<what>", "relation_type": "<type>", "description": "<brief>"}}
  ],
  "section_purpose": "<one-line classification: what role does this section play in the document>",
  "risk_indicators": ["<any risk flags detected from the children>"],
  "key_obligations": ["<top obligations found in children>"],
  "key_terms_defined": ["<terms defined in this section>"]
}}

RULES:
- Deduplicate entities and tags across children.
- Weight child summaries by their importance score.
- Highlight contradictions or ambiguities between children.
- Return ONLY the JSON object.
"""


# ──────────────────────────────────────────────────────────────────────────
# 3. Document-level aggregation
# ──────────────────────────────────────────────────────────────────────────

DOCUMENT_AGGREGATE_PROMPT = """\
You are a legal document analysis engine performing document-level inference.

Given the section-level summaries of an entire document, produce a single
document-wide context summary.

DOCUMENT TITLE: {document_title}
DOCUMENT TYPE : {document_type}
TOTAL SECTIONS: {total_sections}

SECTION SUMMARIES (ordered by document position):
{section_summaries_json}

Return ONLY a JSON object:
{{
  "summary": "<5-8 sentence executive summary of the entire document>",
  "document_purpose": "<one-line: what is this document for>",
  "all_entities": ["<deduplicated union of all section entities>"],
  "all_tags": ["<deduplicated union of all section tags>"],
  "all_relationships": [
    {{"source_section": "<title>", "target_description": "<what>", "relation_type": "<type>", "description": "<brief>"}}
  ],
  "key_obligations": ["<top-level obligations across the document>"],
  "key_risks": ["<identified risk areas>"],
  "key_terms": ["<important defined terms>"],
  "parties_identified": ["<party names and roles>"],
  "cross_section_issues": ["<any contradictions or gaps between sections>"]
}}

RULES:
- This summary will be consumed by downstream AI services and CLM nodes.
- Be concise but complete — capture every material obligation and risk.
- Flag cross-section contradictions explicitly.
- Return ONLY the JSON object.
"""


# ──────────────────────────────────────────────────────────────────────────
# 4. Table-specific component prompt (structured data needs special handling)
# ──────────────────────────────────────────────────────────────────────────

TABLE_INFERENCE_PROMPT = """\
You are a legal document analysis engine analysing a TABLE component.

TABLE TITLE  : {table_title}
TABLE TYPE   : {table_type}
COLUMNS      : {column_headers}
ROW COUNT    : {num_rows}
SECTION TITLE: {section_title}

TABLE DATA:
{table_data_json}

Return ONLY a JSON object:
{{
  "summary": "<1-3 sentence summary: what data this table presents and why it matters>",
  "key_entities": ["<entity1>", "<entity2>", ...],
  "context_tags": ["<tag1>", ...],
  "relationships": [],
  "sentiment": 0.0,
  "complexity": <float 0.0 to 1.0>,
  "importance": <float 0.0 to 1.0>,
  "data_insights": ["<key numerical patterns, totals, outliers>"],
  "column_semantics": {{"<col_id>": "<what this column represents>"}}
}}
"""
