"""
Hierarchical Context Builder — Maximum information density, minimum tokens
===========================================================================

The document tree **is** the compression.  Instead of sending raw text to
AI services, we send pre-distilled summaries that cascade up:

    Leaf (paragraph/table)  →  1-3 sentence summary + entities
    Section aggregate       →  merged children + purpose + obligations
    Document aggregate      →  executive summary + parties + risks

Design Principles
~~~~~~~~~~~~~~~~~
1. **Tree = Compression** — A section summary already distills all its
   children.  We never send redundant data at two levels.  Each tree
   level adds only what the child level didn't capture (purpose,
   cross-references, risks).

2. **Scope-Relative Context** — When the AI works on a paragraph, it gets:
   - Its own summary (1-3 sentences)
   - Parent section purpose + key facts
   - Ancestor path (one-liner per level, just purpose + key entities)
   - Document gist (one sentence + parties)

3. **Structural Encoding** — Indentation and nesting encode the tree
   hierarchy.  The AI reads::

       [Doc] Services Agreement | Acme ↔ Widget | obligations, indemnity
         [§1] Definitions | defines: Service, Deliverable, Fee
         [§2] Scope of Work | obligations | deliver by Q3 2026
           [§2.1] Technical Requirements | 99.9% uptime, API specs
         [§3] Payment | monthly invoicing, net-30 | USD 250,000

   That's an entire document in ~5 lines.

4. **No Redundancy** — If a section summary already says "defines
   Service, Deliverable, Fee", we don't list them again in an entities
   block.

5. **Graceful Degradation** — If inference hasn't run yet, produce a
   lightweight structural skeleton from raw model data (titles +
   component counts).
"""
import logging
from typing import Optional

logger = logging.getLogger(__name__)


# ══════════════════════════════════════════════════════════════════════════
#  Lateral edge context (read path — graph traversal)
# ══════════════════════════════════════════════════════════════════════════

def _get_lateral_context_lines(component, max_critical: int = 5,
                                max_contextual: int = 3) -> list[str]:
    """
    Query LateralEdge for outbound edges from this component and render
    them as context lines for AI prompt injection.

    Returns lines like:
        [→ CRITICAL] Defined term "Fee": flat rate of USD 250,000
        [→ CONTEXTUAL] §7 Termination: early termination requires settling invoices

    Uses the cached ``target_summary`` and ``target_label`` on the edge
    for sub-millisecond assembly (no extra DB lookups for the target).
    """
    from .models import LateralEdge
    from django.contrib.contenttypes.models import ContentType

    lines = []
    try:
        ct = ContentType.objects.get_for_model(component)
        edges = LateralEdge.objects.filter(
            source_content_type=ct,
            source_object_id=component.id,
        ).order_by('-score')

        critical_count = 0
        contextual_count = 0

        for edge in edges:
            if edge.edge_type == 'critical' and critical_count < max_critical:
                label = edge.target_label or f'{edge.target_content_type.model}'
                summary = edge.target_summary or '(no summary)'
                lines.append(f'[→ CRITICAL] {label}: {summary[:150]}')
                critical_count += 1
            elif edge.edge_type == 'contextual' and contextual_count < max_contextual:
                label = edge.target_label or f'{edge.target_content_type.model}'
                summary = edge.target_summary or '(no summary)'
                lines.append(f'[→ CONTEXTUAL] {label}: {summary[:120]}')
                contextual_count += 1

    except Exception as exc:
        logger.debug('Lateral edge lookup failed: %s', exc)

    return lines


# ══════════════════════════════════════════════════════════════════════════
#  Core: Build the document tree context string
# ══════════════════════════════════════════════════════════════════════════

def build_document_tree_context(document) -> str:
    """
    Build the full document tree context — the densest possible
    representation of the entire document for AI consumption.

    Returns a compact multi-line string encoding the entire document
    hierarchy with pre-distilled AI summaries at every level.
    """
    from .models import DocumentInferenceSummary

    doc_inf = DocumentInferenceSummary.objects.filter(
        document=document, is_latest=True,
    ).first()

    lines: list[str] = []

    # ── Document header ──────────────────────────────────────────────
    if doc_inf:
        lines.append(_doc_header(document, doc_inf))
        meta = doc_inf.custom_metadata or {}
        if meta.get('document_purpose'):
            lines.append(f'  Purpose: {meta["document_purpose"]}')
        parties = meta.get('parties_identified', [])
        if parties:
            lines.append(f'  Parties: {", ".join(parties[:6])}')
        risks = meta.get('key_risks', [])
        if risks:
            lines.append(f'  Risks: {"; ".join(risks[:5])}')
        obligations = meta.get('key_obligations', [])
        if obligations:
            lines.append(f'  Obligations: {"; ".join(obligations[:5])}')
        cross = meta.get('cross_section_issues', [])
        if cross:
            lines.append(f'  Issues: {"; ".join(cross[:3])}')
    else:
        # Fallback: structural skeleton
        lines.append(f'[Doc] {document.title or "Untitled"} | {document.document_type or "document"}')

    # ── Section tree ─────────────────────────────────────────────────
    root_sections = document.sections.filter(
        parent__isnull=True,
    ).order_by('order')

    for section in root_sections:
        _build_section_branch(lines, section, depth=1)

    return '\n'.join(lines)


def _build_section_branch(lines: list, section, depth: int):
    """Recursively build the section tree, one compact line per section."""
    from .models import SectionAggregateInference

    indent = '  ' * depth
    agg = SectionAggregateInference.objects.filter(
        section=section, is_latest=True,
    ).first()

    if agg:
        lines.append(_section_line(section, agg, indent))
    else:
        # Fallback: raw structural info
        para_count = section.paragraphs.count()
        table_count = section.tables.count()
        child_count = section.children.count()
        info_parts = [f'{indent}[§] {section.title or "Untitled"}']
        counts = []
        if para_count:
            counts.append(f'{para_count}p')
        if table_count:
            counts.append(f'{table_count}t')
        if child_count:
            counts.append(f'{child_count}sub')
        if counts:
            info_parts.append(', '.join(counts))
        lines.append(' | '.join(info_parts))

    # Recurse into child sections
    for child in section.children.order_by('order'):
        _build_section_branch(lines, child, depth + 1)


# ══════════════════════════════════════════════════════════════════════════
#  Scope-relative context builders (what AI services call)
# ══════════════════════════════════════════════════════════════════════════

def build_context_for_paragraph(paragraph) -> str:
    """
    Dense context for a paragraph:
      1. SELF — component inference (1-3 sentences)
      2. PARENT — section purpose + key obligations
      3. PATH — ancestor chain (one-liner each)
      4. ROOT — document gist

    Never sends sibling raw text — the section aggregate already
    captured inter-paragraph relationships.
    """
    from .models import ComponentInference, SectionAggregateInference, DocumentInferenceSummary

    section = getattr(paragraph, 'section', None)
    document = section.document if section else None
    parts: list[str] = []

    # SELF
    self_inf = _get_latest_inference(paragraph)
    if self_inf:
        parts.append(f'[This paragraph] {self_inf.summary}')
        if self_inf.context_tags:
            parts.append(f'  Type: {", ".join(self_inf.context_tags[:4])}')
        if self_inf.key_entities:
            parts.append(f'  Entities: {", ".join(self_inf.key_entities[:8])}')

    # LATERAL (graph edges: CRITICAL + CONTEXTUAL dependencies)
    lateral_lines = _get_lateral_context_lines(paragraph)
    if lateral_lines:
        parts.extend(lateral_lines)

    # PARENT
    if section:
        sec_agg = SectionAggregateInference.objects.filter(
            section=section, is_latest=True,
        ).first()
        if sec_agg:
            meta = sec_agg.custom_metadata or {}
            purpose = meta.get('section_purpose', '') or sec_agg.summary[:120]
            parts.append(f'[Section: {section.title or "Untitled"}] {purpose}')
            if meta.get('key_obligations'):
                parts.append(f'  Obligations: {"; ".join(meta["key_obligations"][:4])}')
            if meta.get('risk_indicators'):
                parts.append(f'  Risks: {"; ".join(meta["risk_indicators"][:3])}')

    # PATH — ancestors
    if section:
        _add_ancestor_path(parts, section.parent)

    # ROOT — document gist
    if document:
        doc_inf = DocumentInferenceSummary.objects.filter(
            document=document, is_latest=True,
        ).first()
        if doc_inf:
            meta = doc_inf.custom_metadata or {}
            purpose = meta.get('document_purpose', '') or doc_inf.summary[:150]
            parties = meta.get('parties_identified', [])
            gist = purpose
            if parties:
                gist += f' | Parties: {", ".join(parties[:4])}'
            parts.append(f'[Document: {document.title or "Untitled"}] {gist}')

    return '\n'.join(parts)


def build_context_for_section(section) -> str:
    """
    Dense context for a section:
      1. SELF — section aggregate (summary + purpose + obligations)
      2. CHILDREN — compact one-liner per child component
      3. PATH — ancestors
      4. ROOT — document gist
    """
    from .models import SectionAggregateInference, ComponentInference, DocumentInferenceSummary

    document = section.document
    parts: list[str] = []

    # SELF
    sec_agg = SectionAggregateInference.objects.filter(
        section=section, is_latest=True,
    ).first()
    if sec_agg:
        meta = sec_agg.custom_metadata or {}
        parts.append(f'[This section: {section.title or "Untitled"}] {sec_agg.summary}')
        if meta.get('section_purpose'):
            parts.append(f'  Purpose: {meta["section_purpose"]}')
        if meta.get('key_obligations'):
            parts.append(f'  Obligations: {"; ".join(meta["key_obligations"][:6])}')
        if meta.get('risk_indicators'):
            parts.append(f'  Risks: {"; ".join(meta["risk_indicators"][:4])}')
        if meta.get('key_terms_defined'):
            parts.append(f'  Defines: {", ".join(meta["key_terms_defined"][:6])}')
        if sec_agg.aggregated_entities:
            parts.append(f'  Entities: {", ".join(sec_agg.aggregated_entities[:12])}')

    # LATERAL (graph edges: CRITICAL + CONTEXTUAL dependencies)
    lateral_lines = _get_lateral_context_lines(section)
    if lateral_lines:
        parts.extend(lateral_lines)

    # CHILDREN — compact one-liner per child component
    child_infs = ComponentInference.objects.filter(
        section=section, is_latest=True,
    ).order_by('component_type', 'created_at')[:15]

    if child_infs:
        parts.append('  Components:')
        for ci in child_infs:
            tag_str = f' [{",".join(ci.context_tags[:2])}]' if ci.context_tags else ''
            parts.append(f'    · {ci.component_type}{tag_str}: {ci.summary[:100]}')

    # Subsection summaries
    child_aggs = SectionAggregateInference.objects.filter(
        section__parent=section, is_latest=True,
    ).select_related('section').order_by('section__order')[:8]

    for ca in child_aggs:
        ca_meta = ca.custom_metadata or {}
        purpose = ca_meta.get('section_purpose', '') or ca.summary[:80]
        parts.append(f'    [§ {ca.section.title or "Sub"}] {purpose}')

    # PATH — ancestors
    _add_ancestor_path(parts, section.parent)

    # ROOT — document gist
    doc_inf = DocumentInferenceSummary.objects.filter(
        document=document, is_latest=True,
    ).first()
    if doc_inf:
        meta = doc_inf.custom_metadata or {}
        gist = meta.get('document_purpose', '') or doc_inf.summary[:150]
        parts.append(f'[Document: {document.title or "Untitled"}] {gist}')

    return '\n'.join(parts)


def build_context_for_table(table) -> str:
    """Dense context for a table — same pattern as paragraph."""
    from .models import SectionAggregateInference, DocumentInferenceSummary

    section = getattr(table, 'section', None)
    document = section.document if section else None
    parts: list[str] = []

    # SELF
    self_inf = _get_latest_inference(table)
    if self_inf:
        parts.append(f'[This table: {table.title or "Untitled"}] {self_inf.summary}')
        if self_inf.key_entities:
            parts.append(f'  Entities: {", ".join(self_inf.key_entities[:8])}')
        raw = self_inf.raw_llm_output or {}
        insights = raw.get('data_insights', [])
        if insights:
            parts.append(f'  Insights: {"; ".join(str(i) for i in insights[:4])}')

    # LATERAL (graph edges: CRITICAL + CONTEXTUAL dependencies)
    lateral_lines = _get_lateral_context_lines(table)
    if lateral_lines:
        parts.extend(lateral_lines)

    # PARENT
    if section:
        sec_agg = SectionAggregateInference.objects.filter(
            section=section, is_latest=True,
        ).first()
        if sec_agg:
            meta = sec_agg.custom_metadata or {}
            purpose = meta.get('section_purpose', '') or sec_agg.summary[:120]
            parts.append(f'[Section: {section.title or "Untitled"}] {purpose}')

    # PATH
    if section:
        _add_ancestor_path(parts, section.parent)

    # ROOT
    if document:
        doc_inf = DocumentInferenceSummary.objects.filter(
            document=document, is_latest=True,
        ).first()
        if doc_inf:
            meta = doc_inf.custom_metadata or {}
            gist = meta.get('document_purpose', '') or doc_inf.summary[:150]
            parts.append(f'[Document: {document.title or "Untitled"}] {gist}')

    return '\n'.join(parts)


def build_context_for_document(document) -> str:
    """
    Dense context for document-level AI.
    Returns the full tree context — that IS the maximally compressed
    representation.
    """
    return build_document_tree_context(document)


# ══════════════════════════════════════════════════════════════════════════
#  Scope dispatcher (for ai_chat / ai_chat_edit)
# ══════════════════════════════════════════════════════════════════════════

def build_context_for_scope(document, scope: str,
                            scope_id: str | None = None) -> str:
    """
    Dispatch to the right builder based on ``scope``.
    Returns the densest possible representation — no budgets, no
    truncation.  The hierarchy already is the compression.
    """
    from documents.models import Section, Paragraph, Table

    if scope == 'document':
        return build_context_for_document(document)

    if scope == 'section' and scope_id:
        section = Section.objects.filter(id=scope_id, document=document).first()
        if section:
            return build_context_for_section(section)

    if scope == 'paragraph' and scope_id:
        paragraph = Paragraph.objects.filter(
            id=scope_id,
        ).select_related('section', 'section__document').first()
        if paragraph:
            return build_context_for_paragraph(paragraph)

    if scope == 'table' and scope_id:
        table = Table.objects.filter(
            id=scope_id,
        ).select_related('section', 'section__document').first()
        if table:
            return build_context_for_table(table)

    return ''


# ══════════════════════════════════════════════════════════════════════════
#  Hierarchical path context (tree-aware inference index)
# ══════════════════════════════════════════════════════════════════════════
#
#  Rule: when AI is called for a node N, only include:
#
#      [Document root gist]          ← always (1 line)
#      [Ancestor 1 (root section)]   ← one compact line per level up to N
#      [Ancestor 2 (sub-section)]
#      ...
#      [Self: N]                     ← full inference for N itself
#      [Child 1 of N]                ← immediate children ONLY (not grandchildren)
#      [Child 2 of N]
#      ...
#
#  This is strictly linear / path-relative.  Siblings, cousins, and deeper
#  descendants are **never** included.
#
#  Examples
#  --------
#  Call on section 1.3:
#    Doc root → §1 → [§1.3 self] → §1.3.1, §1.3.2, §1.3.q (one-liners)
#
#  Call on section 1.3.1:
#    Doc root → §1 → §1.3 → [§1.3.1 self] → components of 1.3.1 (paragraphs/tables)
#
#  Call on paragraph inside 1.3.1:
#    Doc root → §1 → §1.3 → §1.3.1 → [para self] → sentences of that paragraph
# ══════════════════════════════════════════════════════════════════════════


def _collect_ancestor_sections(section) -> list:
    """
    Walk UP from section.parent to root.
    Returns ancestors ordered [root, ..., immediate_parent].
    """
    ancestors = []
    current = getattr(section, 'parent', None)
    while current is not None:
        ancestors.append(current)
        current = getattr(current, 'parent', None)
    ancestors.reverse()  # root first
    return ancestors


def _section_ancestor_line(section) -> str:
    """Compact one-liner for an ancestor section."""
    from .models import SectionAggregateInference
    agg = SectionAggregateInference.objects.filter(
        section=section, is_latest=True,
    ).first()
    if agg:
        meta = agg.custom_metadata or {}
        purpose = meta.get('section_purpose', '') or agg.summary[:100]
        entities = ', '.join((agg.aggregated_entities or [])[:4])
        suffix = f' | {entities}' if entities else ''
        return f'[§ {section.title or "Untitled"}] {purpose}{suffix}'
    return f'[§ {section.title or "Untitled"}]'


def _doc_gist_line(document) -> str:
    """Compact one-liner for the document root."""
    from .models import DocumentInferenceSummary
    doc_inf = DocumentInferenceSummary.objects.filter(
        document=document, is_latest=True,
    ).first()
    if doc_inf:
        meta = doc_inf.custom_metadata or {}
        gist = meta.get('document_purpose', '') or doc_inf.summary[:150]
        parties = meta.get('parties_identified', [])
        if parties:
            gist += f' | Parties: {", ".join(parties[:3])}'
        return f'[Doc: {document.title or "Untitled"}] {gist}'
    return f'[Doc: {document.title or "Untitled"}]'


def build_hierarchical_context_for_section(section) -> str:
    """
    Path-relative context when AI is called AT the section level.

    Structure:
        [Doc root gist]
        [Ancestor §1]  (one-liner)
        [Ancestor §1.x] ...
        [This section: §1.3 – full inference block]
        [Child §1.3.1]  (one-liner each)
        [Child §1.3.2]
        [Child component: paragraph/table] (one-liner each)
    """
    from .models import SectionAggregateInference, ComponentInference

    document = section.document
    parts: list[str] = []

    # ── Document root gist ───────────────────────────────────────────
    if document:
        parts.append(_doc_gist_line(document))

    # ── Ancestor chain (root → immediate parent) ─────────────────────
    for anc in _collect_ancestor_sections(section):
        parts.append(_section_ancestor_line(anc))

    # ── SELF — full inference block ──────────────────────────────────
    sec_agg = SectionAggregateInference.objects.filter(
        section=section, is_latest=True,
    ).first()
    if sec_agg:
        meta = sec_agg.custom_metadata or {}
        parts.append(f'[This section: {section.title or "Untitled"}] {sec_agg.summary}')
        if meta.get('section_purpose'):
            parts.append(f'  Purpose: {meta["section_purpose"]}')
        if meta.get('key_obligations'):
            parts.append(f'  Obligations: {"; ".join(meta["key_obligations"][:6])}')
        if meta.get('risk_indicators'):
            parts.append(f'  Risks: {"; ".join(meta["risk_indicators"][:4])}')
        if meta.get('key_terms_defined'):
            parts.append(f'  Defines: {", ".join(meta["key_terms_defined"][:6])}')
        if sec_agg.aggregated_entities:
            parts.append(f'  Entities: {", ".join(sec_agg.aggregated_entities[:10])}')
    else:
        parts.append(f'[This section: {section.title or "Untitled"}] (no inference yet)')

    # LATERAL
    lateral_lines = _get_lateral_context_lines(section)
    if lateral_lines:
        parts.extend(lateral_lines)

    # ── CHILDREN — immediate child sections (one-liner each) ─────────
    child_sections = section.children.order_by('order')
    if child_sections.exists():
        parts.append('  Child sections:')
        for child in child_sections:
            child_agg = SectionAggregateInference.objects.filter(
                section=child, is_latest=True,
            ).first()
            if child_agg:
                child_meta = child_agg.custom_metadata or {}
                purpose = child_meta.get('section_purpose', '') or child_agg.summary[:80]
                parts.append(f'    [§ {child.title or "Untitled"}] {purpose}')
            else:
                parts.append(f'    [§ {child.title or "Untitled"}]')

    # ── CHILDREN — immediate component inferences ────────────────────
    child_comps = ComponentInference.objects.filter(
        section=section, is_latest=True,
    ).order_by('component_type', 'created_at')[:20]
    if child_comps.exists():
        parts.append('  Components:')
        for ci in child_comps:
            tag_str = f' [{",".join(ci.context_tags[:2])}]' if ci.context_tags else ''
            parts.append(f'    · {ci.component_type}{tag_str}: {ci.summary[:100]}')

    return '\n'.join(parts)


def build_hierarchical_context_for_paragraph(paragraph) -> str:
    """
    Path-relative context when AI is called AT the paragraph level.

    Structure:
        [Doc root gist]
        [Ancestor §1]  (one-liner)
        ...
        [Parent section — full inference block]
        [This paragraph — full inference block]
        [Child sentences — one-liner each]
    """
    from .models import ComponentInference, SectionAggregateInference

    section = getattr(paragraph, 'section', None)
    document = section.document if section else None
    parts: list[str] = []

    # ── Document root gist ───────────────────────────────────────────
    if document:
        parts.append(_doc_gist_line(document))

    # ── Ancestor chain (root → parent of parent section) ─────────────
    if section:
        for anc in _collect_ancestor_sections(section):
            parts.append(_section_ancestor_line(anc))

    # ── PARENT section — full inference block ────────────────────────
    if section:
        sec_agg = SectionAggregateInference.objects.filter(
            section=section, is_latest=True,
        ).first()
        if sec_agg:
            meta = sec_agg.custom_metadata or {}
            purpose = meta.get('section_purpose', '') or sec_agg.summary[:120]
            parts.append(f'[Section: {section.title or "Untitled"}] {purpose}')
            if meta.get('key_obligations'):
                parts.append(f'  Obligations: {"; ".join(meta["key_obligations"][:4])}')
            if meta.get('risk_indicators'):
                parts.append(f'  Risks: {"; ".join(meta["risk_indicators"][:3])}')
        else:
            parts.append(f'[Section: {section.title or "Untitled"}]')

    # ── SELF — full inference block ──────────────────────────────────
    self_inf = _get_latest_inference(paragraph)
    if self_inf:
        parts.append(f'[This paragraph] {self_inf.summary}')
        if self_inf.context_tags:
            parts.append(f'  Type: {", ".join(self_inf.context_tags[:4])}')
        if self_inf.key_entities:
            parts.append(f'  Entities: {", ".join(self_inf.key_entities[:8])}')
    else:
        parts.append('[This paragraph] (no inference yet)')

    # LATERAL
    lateral_lines = _get_lateral_context_lines(paragraph)
    if lateral_lines:
        parts.extend(lateral_lines)

    # ── CHILDREN — immediate sentences (one-liner each) ──────────────
    sentences = paragraph.sentences.order_by('order')[:15]
    if sentences.exists():
        parts.append('  Sentences:')
        for sent in sentences:
            sent_inf = _get_latest_inference(sent)
            if sent_inf:
                parts.append(f'    · {sent_inf.summary[:100]}')
            else:
                text = getattr(sent, 'content_text', '') or ''
                if text:
                    parts.append(f'    · {text[:100]}')

    return '\n'.join(parts)


def build_hierarchical_context_for_table(table) -> str:
    """
    Path-relative context when AI is called AT the table level.

    Structure:
        [Doc root gist]
        [Ancestor §1] ...
        [Parent section — full inference block]
        [This table — full inference block]
    Tables have no children beyond cells (no sub-inference), so we stop here.
    """
    from .models import SectionAggregateInference

    section = getattr(table, 'section', None)
    document = section.document if section else None
    parts: list[str] = []

    # ── Document root gist ───────────────────────────────────────────
    if document:
        parts.append(_doc_gist_line(document))

    # ── Ancestor chain ───────────────────────────────────────────────
    if section:
        for anc in _collect_ancestor_sections(section):
            parts.append(_section_ancestor_line(anc))

    # ── PARENT section ───────────────────────────────────────────────
    if section:
        sec_agg = SectionAggregateInference.objects.filter(
            section=section, is_latest=True,
        ).first()
        if sec_agg:
            meta = sec_agg.custom_metadata or {}
            purpose = meta.get('section_purpose', '') or sec_agg.summary[:120]
            parts.append(f'[Section: {section.title or "Untitled"}] {purpose}')
        else:
            parts.append(f'[Section: {section.title or "Untitled"}]')

    # ── SELF ─────────────────────────────────────────────────────────
    self_inf = _get_latest_inference(table)
    if self_inf:
        parts.append(f'[This table: {table.title or "Untitled"}] {self_inf.summary}')
        if self_inf.key_entities:
            parts.append(f'  Entities: {", ".join(self_inf.key_entities[:8])}')
        raw = self_inf.raw_llm_output or {}
        insights = raw.get('data_insights', [])
        if insights:
            parts.append(f'  Insights: {"; ".join(str(i) for i in insights[:4])}')
    else:
        parts.append(f'[This table: {table.title or "Untitled"}] (no inference yet)')

    # LATERAL
    lateral_lines = _get_lateral_context_lines(table)
    if lateral_lines:
        parts.extend(lateral_lines)

    return '\n'.join(parts)


def build_hierarchical_context_for_sentence(sentence) -> str:
    """
    Path-relative context when AI is called AT the sentence level.

    Structure:
        [Doc root gist]
        [Ancestor §] ...
        [Parent section — one-liner]
        [Parent paragraph — full inference block]
        [This sentence — full inference block]
    Sentences are leaf nodes — no children to include.
    """
    from .models import SectionAggregateInference

    paragraph = getattr(sentence, 'paragraph', None)
    section = getattr(paragraph, 'section', None) if paragraph else None
    document = section.document if section else None
    parts: list[str] = []

    # ── Document root gist ───────────────────────────────────────────
    if document:
        parts.append(_doc_gist_line(document))

    # ── Ancestor chain ───────────────────────────────────────────────
    if section:
        for anc in _collect_ancestor_sections(section):
            parts.append(_section_ancestor_line(anc))

    # ── PARENT section (one-liner) ───────────────────────────────────
    if section:
        parts.append(_section_ancestor_line(section))

    # ── PARENT paragraph — full inference block ──────────────────────
    if paragraph:
        para_inf = _get_latest_inference(paragraph)
        if para_inf:
            parts.append(f'[Paragraph] {para_inf.summary}')
            if para_inf.key_entities:
                parts.append(f'  Entities: {", ".join(para_inf.key_entities[:6])}')
        else:
            text = getattr(paragraph, 'get_effective_content', lambda: '')() or ''
            if text:
                parts.append(f'[Paragraph] {text[:120]}')

    # ── SELF ─────────────────────────────────────────────────────────
    self_inf = _get_latest_inference(sentence)
    if self_inf:
        parts.append(f'[This sentence] {self_inf.summary}')
        if self_inf.context_tags:
            parts.append(f'  Type: {", ".join(self_inf.context_tags[:4])}')
    else:
        text = getattr(sentence, 'content_text', '') or ''
        if text:
            parts.append(f'[This sentence] {text[:200]}')

    return '\n'.join(parts)


def build_hierarchical_context_for_document(document) -> str:
    """
    When AI is called AT the document level.
    Include self (full doc inference) + immediate root sections (one-liner each).
    Equivalent to the existing build_document_tree_context but scoped to depth=1.
    """
    from .models import DocumentInferenceSummary, SectionAggregateInference

    parts: list[str] = []

    # ── SELF (document) ──────────────────────────────────────────────
    doc_inf = DocumentInferenceSummary.objects.filter(
        document=document, is_latest=True,
    ).first()
    if doc_inf:
        meta = doc_inf.custom_metadata or {}
        parts.append(f'[Document: {document.title or "Untitled"}] {doc_inf.summary}')
        if meta.get('document_purpose'):
            parts.append(f'  Purpose: {meta["document_purpose"]}')
        parties = meta.get('parties_identified', [])
        if parties:
            parts.append(f'  Parties: {", ".join(parties[:6])}')
        risks = meta.get('key_risks', [])
        if risks:
            parts.append(f'  Risks: {"; ".join(risks[:5])}')
        obligations = meta.get('key_obligations', [])
        if obligations:
            parts.append(f'  Obligations: {"; ".join(obligations[:5])}')
    else:
        parts.append(f'[Document: {document.title or "Untitled"}] (no inference yet)')

    # ── CHILDREN — immediate root sections (one-liner each) ──────────
    root_sections = document.sections.filter(
        parent__isnull=True,
    ).order_by('order')
    if root_sections.exists():
        parts.append('  Root sections:')
        for sec in root_sections:
            parts.append(f'    {_section_ancestor_line(sec)}')

    return '\n'.join(parts)


def build_hierarchical_context_for_node(node) -> str:
    """
    Top-level dispatcher: infer the node type and return the correct
    path-relative hierarchical context.

    Accepts: Section, Paragraph, Table, Sentence, Document instances.
    Falls back to empty string for unknown types.
    """
    from documents.models import Section, Paragraph, Table, Sentence, Document

    if isinstance(node, Document):
        return build_hierarchical_context_for_document(node)
    elif isinstance(node, Section):
        return build_hierarchical_context_for_section(node)
    elif isinstance(node, Paragraph):
        return build_hierarchical_context_for_paragraph(node)
    elif isinstance(node, Table):
        return build_hierarchical_context_for_table(node)
    elif isinstance(node, Sentence):
        return build_hierarchical_context_for_sentence(node)
    else:
        logger.warning('build_hierarchical_context_for_node: unknown node type %s', type(node))
        return ''


def build_hierarchical_context_for_scope(document, scope: str,
                                          scope_id: str | None = None) -> str:
    """
    Scope-string dispatcher for build_hierarchical_context_for_node.
    Used by AI service views that receive (document, scope, scope_id).

    scope: 'document' | 'section' | 'paragraph' | 'table' | 'sentence'
    """
    from documents.models import Section, Paragraph, Table, Sentence

    if scope == 'document':
        return build_hierarchical_context_for_document(document)

    if scope == 'section' and scope_id:
        section = Section.objects.filter(id=scope_id, document=document).first()
        if section:
            return build_hierarchical_context_for_section(section)

    if scope == 'paragraph' and scope_id:
        paragraph = Paragraph.objects.filter(
            id=scope_id,
        ).select_related('section', 'section__document').first()
        if paragraph:
            return build_hierarchical_context_for_paragraph(paragraph)

    if scope == 'table' and scope_id:
        table = Table.objects.filter(
            id=scope_id,
        ).select_related('section', 'section__document').first()
        if table:
            return build_hierarchical_context_for_table(table)

    if scope == 'sentence' and scope_id:
        sentence = Sentence.objects.filter(
            id=scope_id,
        ).select_related('paragraph', 'paragraph__section',
                         'paragraph__section__document').first()
        if sentence:
            return build_hierarchical_context_for_sentence(sentence)

    return ''


# ══════════════════════════════════════════════════════════════════════════
#  Staleness checks
# ══════════════════════════════════════════════════════════════════════════

def has_fresh_inference(document) -> bool:
    from .models import DocumentInferenceSummary
    return DocumentInferenceSummary.objects.filter(
        document=document, is_latest=True,
    ).exists()


def has_fresh_section_inference(section) -> bool:
    from .models import SectionAggregateInference
    return SectionAggregateInference.objects.filter(
        section=section, is_latest=True,
    ).exists()


def has_fresh_component_inference(component) -> bool:
    from .models import ComponentInference
    from django.contrib.contenttypes.models import ContentType
    ct = ContentType.objects.get_for_model(component)
    return ComponentInference.objects.filter(
        content_type=ct, object_id=component.id, is_latest=True,
    ).exists()


# ══════════════════════════════════════════════════════════════════════════
#  Private helpers
# ══════════════════════════════════════════════════════════════════════════

def _get_latest_inference(component):
    """Get the latest ComponentInference for any component via GFK."""
    from .models import ComponentInference
    from django.contrib.contenttypes.models import ContentType
    try:
        ct = ContentType.objects.get_for_model(component)
        return ComponentInference.objects.filter(
            content_type=ct, object_id=component.id, is_latest=True,
        ).first()
    except Exception:
        return None


def _add_ancestor_path(parts: list, section, depth: int = 0):
    """Walk up the parent chain — one compact line per ancestor."""
    if not section or depth > 6:
        return
    from .models import SectionAggregateInference
    agg = SectionAggregateInference.objects.filter(
        section=section, is_latest=True,
    ).first()
    if agg:
        meta = agg.custom_metadata or {}
        purpose = meta.get('section_purpose', '')
        entities = agg.aggregated_entities[:5] if agg.aggregated_entities else []
        suffix = f' | {", ".join(entities)}' if entities else ''
        parts.append(f'[↑ {section.title or "Section"}] {purpose}{suffix}')
    else:
        parts.append(f'[↑ {section.title or "Section"}]')

    if section.parent_id:
        _add_ancestor_path(parts, section.parent, depth + 1)


def _doc_header(document, doc_inf) -> str:
    """Compact document header line."""
    meta = doc_inf.custom_metadata or {}
    parts = [f'[Doc] {document.title or "Untitled"}']
    parties = meta.get('parties_identified', [])
    if parties:
        parts.append(' ↔ '.join(parties[:3]))
    tags = doc_inf.all_tags[:5] if doc_inf.all_tags else []
    if tags:
        parts.append(', '.join(tags))
    return ' | '.join(parts)


def _section_line(section, agg, indent: str) -> str:
    """One compact line for a section in the tree."""
    meta = agg.custom_metadata or {}
    parts = [f'{indent}[§] {section.title or "Untitled"}']

    purpose = meta.get('section_purpose', '')
    if purpose:
        parts.append(purpose)
    elif agg.aggregated_tags:
        parts.append(', '.join(agg.aggregated_tags[:4]))

    obligations = meta.get('key_obligations', [])
    if obligations:
        parts.append('; '.join(obligations[:3]))
    elif agg.aggregated_entities:
        parts.append(', '.join(agg.aggregated_entities[:5]))

    return ' | '.join(parts)
