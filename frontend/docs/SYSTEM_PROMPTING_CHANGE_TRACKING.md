# System Prompting + Change‑Tracking UI Guide

This guide documents how to configure **system prompting** and build a **Google‑Docs‑style change tracking UI** on top of the existing backend APIs (partial save, changelog, and version snapshots).

---

## ✅ Goals

- Provide a consistent system prompt for AI‑assisted edits.
- Track and display changes per user, per section, and per paragraph.
- Allow a user to browse diffs between versions like a commit history.
- Make changes visible without blocking real‑time editing.

---

## 1) System Prompting (Editor Assistant)

### Purpose
The system prompt should enforce consistent editing behavior and make audit logs meaningful.

### Recommended System Prompt (backend/LLM layer)
```
You are an AI editing assistant for legal documents. 
Only propose edits that improve clarity, consistency, or compliance.
Do NOT introduce new facts. Preserve original meaning.
Return changes using the frontend change-envelope schema.
If unsure, ask the user for clarification.
```

### Recommended Response Format
Always return a `changes` array so the frontend can apply edits with `partial-save`:
```json
{
  "changes": [
    {
      "type": "paragraph",
      "op": "update",
      "id": "uuid",
      "data": {"content": "Updated content"},
      "base_version": 3
    }
  ]
}
```

### Guardrails
- Only output `changes`; never output raw document text.
- Include `base_version` or `base_last_modified` for conflict detection.
- Use `change_summary` for human‑readable audit entries.

---

## 2) Change‑Tracking UI (Google‑Docs‑Style)

### Key UI Components
1. **Document Timeline Panel**
   - List of changes grouped by time.
   - Each item shows user, summary, timestamp.

2. **Inline Section/Paragraph History**
   - Hover or click to show per‑section changes.
   - Use `section_id` or `paragraph_id` filters.

3. **Diff Viewer**
   - For each version snapshot, show `diff_from_previous`.
   - Highlight added/removed lines.

4. **Audit Detail Drawer**
   - Full `changes_summary` and `fields_changed`.

---

## 3) Data Sources

### ChangeLog (live edits)
```
GET /api/documents/{id}/changelog/
```
Key fields:
- `changed_by`, `change_type`, `description`
- `fields_changed`, `changes_summary`
- `version_at_change`

### Version snapshots (commit‑like history)
```
GET /api/documents/{id}/versions/?include_content=true
```
Key fields:
- `diff_from_previous` (unified diff)
- `change_summary`

---

## 4) UI Data Flow (Recommended)

1. **Live edits** → Use `partial-save` on each change.
2. **Audit log** → Fetch `changelog` every N seconds or on demand.
3. **Version diffs** → Use `versions?include_content=true` to show commit‑style diffs.
4. **Conflict handling** → If a change is stale, show conflict UI and allow retry.

---

## 5) Example UI Interaction

1. User edits paragraph.
2. Frontend calls `partial-save` with base version.
3. Backend writes ChangeLog entry.
4. Timeline panel updates with the new entry.
5. User clicks "History" → loads `changelog` filtered by `paragraph_id`.
6. User opens Version History → loads `diff_from_previous`.

---

## ✅ Checklist

- [ ] System prompt is consistent across editing flows
- [ ] `partial-save` uses `base_version` / `base_last_modified`
- [ ] ChangeLog entries include fields + summaries
- [ ] UI renders diffs from `diff_from_previous`
- [ ] History panel supports filters by section/paragraph

---

## 🔗 Related Docs

- `PARTIAL_SAVE_SYSTEM.md`
- `ETAG_FRONTEND_GUIDE.md`
- `API_REFERENCE.md`
