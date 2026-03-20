# Drafter — AI-Powered Legal Document Platform

## Product Description for Market Positioning

---

## 🏷️ One-Liner

**Drafter** is an AI-powered legal document lifecycle platform that combines intelligent document editing, automated contract workflows, and enterprise collaboration — enabling legal teams to draft, review, approve, and manage documents 10× faster.

---

## 🎯 Product Overview

Drafter is a comprehensive, enterprise-grade platform purpose-built for legal professionals, contract managers, and compliance teams. It unifies document authoring, AI-assisted analysis, contract lifecycle management (CLM), approval workflows, and secure external sharing into a single cohesive product — eliminating the need for fragmented toolchains.

### Target Audience
- **Law Firms** — Draft, review, and collaborate on client documents
- **Corporate Legal Teams** — Manage contracts, policies, and compliance docs
- **Contract Managers** — Automate contract intake, extraction, and routing
- **Compliance Officers** — Track regulatory documents with audit trails
- **Government Agencies** — Secure document management with role-based access

---

## 🧩 Core Feature Modules

### 1. 📝 Intelligent Document Editor

A structured, hierarchical document editor designed specifically for legal content, supporting rich formatting, embedded components, and real-time collaboration.

**Key Capabilities:**
- **Hierarchical Document Structure** — Documents are organized as Section → Paragraph → Sentence → Table → Image → File, supporting unlimited nesting (subsections, sub-subsections) for complex legal documents
- **Dual Editing Modes:**
  - *Standard Mode* — Full structured editing with sections, paragraphs, tables, images, and embedded files
  - *Quick LaTeX Mode* — Single-section, single-block LaTeX editing optimized for technical/mathematical legal documents with AI generation and rapid duplication
- **Rich Component Types:**
  - **Paragraphs** — Classified as standard, definition, obligation, right, condition, exception, or example with complexity scoring
  - **Tables** — Up to 64-column structured tables with typed columns, row/column CRUD, cell-level editing, drag-and-drop reordering, and 7 table types (data, comparison, pricing, schedule, matrix, specifications)
  - **Image Components** — Reusable image library with drag-and-drop placement, captioning, sizing (full-width, half-width, thumbnail), and alignment
  - **File Components** — Embedded document files (PDFs, spreadsheets, etc.) within sections
  - **LaTeX Code Blocks** — Inline LaTeX rendering for mathematical formulas and technical content
- **Section Cross-Referencing** — Reference sections from other documents you have access to, with full access-control enforcement
- **Drag-and-Drop Reordering** — Sections, paragraphs, tables, and images can be repositioned within or across sections
- **Auto-Save** — Automatic incremental saves with partial-save system (typed handler registry for sections, paragraphs, tables, images, files)
- **Optimistic Concurrency (ETag)** — Prevents data loss from simultaneous edits via `If-Match` / `If-None-Match` headers with `412 Precondition Failed` on conflicts
- **Document Templates** — Create documents from pre-built templates (e.g., NDA, SaaS Agreement, Employment Contract) or structured creation wizard

### 2. 🤖 AI Services (Gemini-Powered)

Deep AI integration across the entire document lifecycle, powered by Google Gemini with configurable per-document AI settings.

**Key Capabilities:**
- **AI Document Generation** — Generate full structured legal documents from natural language prompts, specifying document type, parties, jurisdiction, and terms
- **AI Setup Questions** — Interactive document creation wizard — AI asks context-specific questions to understand the document's purpose before generating content
- **Document Scoring & Risk Assessment:**
  - *Aggregated Score (0–100)* with overall risk category (Low/Medium/High)
  - *6 Core Score Dimensions:* Completeness, Validity/Enforceability, Risk Exposure, Compliance/Regulatory, Clarity, Drafting Quality
  - *Clause-Level Review* — AI identifies specific clauses needing remediation with severity ratings, suggested revisions, and conflicting clause cross-references mapped to exact sections/paragraphs/tables
  - *Operational & Commercial Intelligence* — Obligation balance scoring, operational feasibility, quantifiable financial exposure analysis, notice period detection
  - *AI Governance & Trust Metrics* — Confidence scores, evidence coverage, model audit metadata
  - *Score Rationale* — Per-dimension evidence/reasoning for full transparency
- **Paragraph-Level AI Analysis:**
  - *Metadata Extraction* — Identifies key entities, obligations, dates, and amounts per paragraph
  - *AI Rewrite Suggestions* — Generates improved paragraph text with accept/reject workflow
  - *Paragraph Scoring* — Individual paragraph quality/complexity scoring
  - *Placeholder Detection* — Identifies `[[field_name]]` placeholders and maps them to document metadata for auto-resolution
- **AI Chat** — Conversational AI assistant scoped to the entire document or specific sections/paragraphs, with contextual understanding of the document structure
- **AI Chat Edit** — AI-powered inline editing — describe changes in natural language and AI modifies the document structure directly
- **AI LaTeX Generation** — Generate LaTeX code blocks from natural language descriptions
- **Per-Document AI Configuration:**
  - Enable/disable individual AI services per document
  - Custom system prompts per document and per service
  - AI focus mode (e.g., "focus on compliance issues")
  - Bulk toggle all services on/off
- **Document Type AI Presets** — Pre-configured AI behavior profiles for different document types (contracts, policies, NDAs, etc.) with default service configs and prompts

### 3. 🔄 Hierarchical Inference Engine (RAG)

A sophisticated bottom-up AI processing pipeline that builds deep understanding of every document component.

**Key Capabilities:**
- **Three-Phase Inference:**
  1. *Leaf Inference* — Every paragraph, sentence, LaTeX block, and table gets AI-generated summaries, entity extraction, context tags, sentiment, complexity, and importance scores
  2. *Section Aggregation* — Bottom-up roll-up of child inferences into section-level summaries (deepest sections first)
  3. *Document Aggregation* — Full document-level inference summary from all root sections
- **Incremental Processing** — SHA-256 content hashing at every level; unchanged subtrees are skipped entirely, making re-inference after small edits near-instant
- **Semantic Embeddings** — Vector representations for every component enabling cross-section similarity search
- **Lateral Edges** — Pre-computed dependency edges between related components across different sections, discovered via embedding similarity + cross-encoder reranking
- **Context Window Management** — Intelligent context assembly for AI prompts, pulling relevant cross-section dependencies for better AI understanding

### 4. 📋 Contract Lifecycle Management (CLM)

A visual, no-code workflow automation engine for processing contracts and documents at scale.

**Key Capabilities:**
- **Visual Workflow Builder** — Drag-and-drop DAG (Directed Acyclic Graph) canvas with zoom/pan, multiple node types, and directed connections
- **11 Node Types:**
  | Node | Purpose |
  |------|---------|
  | **Input** | Document upload entry point (supports PDF, DOCX, TXT, CSV, JSON, XML, HTML, Markdown) |
  | **Rule** | Metadata-based filtering with AND/OR conditions (e.g., contract_value > $50K AND jurisdiction contains "US") |
  | **Listener** | Watches email inboxes/folders, auto-triggers workflow for incoming documents |
  | **Validator** | Multi-level human approval gate — assigned users approve/reject with branching ("approved" → path A, "rejected" → path B) |
  | **Action** | Plugin-based execution (send email, WhatsApp, SMS) for each matching document |
  | **AI** | AI model processing — Gemini/ChatGPT analysis with configurable prompts and JSON extraction |
  | **AND Gate** | Logic gate — passes documents only when ALL upstream paths deliver them (set intersection) |
  | **Scraper** | Web scraping node — extracts data from allowed websites to enrich document metadata |
  | **Document Creator** | Auto-creates Drafter editor documents from CLM metadata with field mappings |
  | **Inference** | Runs the hierarchical inference engine on documents within the workflow |
  | **Output** | Terminal node — displays the filtered/processed document list |
- **Automatic NuExtract Template** — Rule node field names are auto-collected to build AI extraction templates; no manual template authoring needed
- **Smart Re-Execution** — SHA-256 hash tracks workflow DAG shape; when nodes/connections change, affected documents are flagged for re-execution
- **Auto-Execute on Upload** — Toggle automatic workflow execution when new documents are uploaded
- **Derived Fields** — Computed fields from extracted data (e.g., `total_value = unit_price × quantity`)
- **Workflow Chat** — AI assistant for workflow configuration and optimization
- **Upload Links** — Secure, OTP-protected external upload links for third parties to submit documents into workflows
- **Document Execution Records** — Full audit trail per document through the workflow pipeline
- **Celery Task Queue** — Background execution with Redis-backed task scheduling for long-running workflows

### 5. 📄 PDF Export Engine

Production-quality PDF generation with pixel-perfect layout control, suitable for client-facing legal documents.

**Key Capabilities:**
- **ReportLab Canvas Rendering** — Professional-grade PDF generation with precise typography and layout
- **pypdf Overlay System** — Header/footer PDFs are composited as overlays onto the generated content pages
- **Dual Header/Footer System:**
  1. *PDF Overlay* — Upload existing letterhead/footer PDFs, auto-detect header/footer regions with smart blank-row scanning algorithm, manual crop rectangle selection UI with page preview
  2. *Text Templates* — Reusable header/footer templates with left/center/right text zones, icon placement, custom fonts, and dynamic placeholders (`{company_name}`, `{page}`, `{total}`, `{date}`, `{document_title}`, etc.)
- **Organization-Level Defaults** — Org-wide processing defaults (fonts, margins, page size, headers/footers) that cascade to all documents with per-document overrides
- **Config Merge Chain** — Org defaults → deep-merged → document overrides → `__removed__` sentinel stripping → final export config
- **Page Scope Controls** — Show headers/footers on all pages, first page only, or specific page ranges
- **Export Settings** — Full control over page size, margins, fonts, line spacing, numbering styles
- **Download Tokens** — Secure, time-limited download URLs for generated PDFs
- **PDF Metadata Embedding** — Document metadata, organization info, and custom fields embedded in PDF metadata for compliance

### 6. 🔗 Sharing & Collaboration

Enterprise-grade sharing with granular role-based access control, supporting both internal and external collaboration.

**Key Capabilities:**
- **Generic Sharing Model** — Share ANY entity (documents, folders, files, projects) using a unified `GenericForeignKey` system
- **5 Share Types:**
  - *User* — Direct share with registered users
  - *Team* — Share with entire teams
  - *Email* — External invitation via email with secure tokens
  - *Phone* — External invitation via SMS
  - *Link* — Public shareable link (anyone with link)
- **3 Access Roles:** Viewer (read-only), Commenter (view + comment), Editor (full edit access)
- **Invitation System** — Secure token-based invitations with acceptance tracking, custom messages, and expiration dates
- **Access Logging** — Every access attempt is logged with IP address, user agent, session ID, and access type (view, edit, comment, download, print, export, delete)
- **Duplicate Prevention** — Unique constraints prevent duplicate shares for the same content + recipient combination

### 7. 👁️ External Viewer Portal

A dedicated, secure portal for external stakeholders to view, comment on, and approve documents without needing a Drafter account.

**Key Capabilities:**
- **3 Access Modes:**
  - *Public* — Anyone with the link can view (no login required)
  - *Email OTP* — Viewer verifies email via one-time password (no registration)
  - *Invite Only* — Viewer must accept invitation first
- **Token-Based Authentication** — Custom `ViewerSessionAuthentication` and `ViewerTokenAuthentication` separate from Django sessions
- **Viewer Roles:** Viewer (read-only PDF) or Commentator (can comment and approve)
- **Granular Action Controls** — Per-token configuration of allowed actions: view, download, print, AI chat
- **Security Features:**
  - Password protection
  - Max access count limits
  - Configurable expiration
  - Watermark overlay with custom text
  - Text selection disabling
  - NDA acceptance requirement before viewing
- **Viewer Comments** — Threaded comments on document sections/paragraphs/tables with resolution tracking, reactions (👍, ❤️, etc.), and mentions
- **Viewer Approvals** — External stakeholders can submit approval decisions (approved, rejected, changes_requested) with comments
- **Custom Branding** — Per-link branding message, logo URL, theme (light/dark), and custom CSS
- **Analytics** — Access tracking with page views, time spent, and engagement metrics per viewer token

### 8. 📂 Drive File System

A Google Drive-like file management system for organizing documents, files, and folders within organizations.

**Key Capabilities:**
- **Hierarchical Folders** — Nested folder structure with breadcrumb navigation, unique folder names per parent
- **4 Scope Levels:** Personal, Shared with Me, Team, Organization
- **File Management:**
  - Upload any file type with automatic MIME type detection
  - SHA-256 checksum integrity verification
  - File size tracking and tagging
  - Soft delete with restoration capability
- **Favorites System** — Bookmark any folder or file using `GenericForeignKey`
- **Team-Scoped Storage** — Files and folders can be scoped to specific teams within an organization

### 9. 📚 Document Management System (DMS)

PDF ingestion, storage, and intelligent search for contract repositories and document archives.

**Key Capabilities:**
- **PDF Ingestion** — Upload PDFs with automatic text extraction, metadata extraction (title, author, subject, keywords, page count), and signatory detection
- **Binary PDF Storage** — PDFs stored directly in the database for portability
- **Comprehensive Metadata Schema:**
  - Document lifecycle dates: uploaded, signed, effective, expiration, termination, archived, renewal
  - Compliance fields: jurisdiction, retention end date, legal hold, review due date
  - Signing status: signed/unsigned, signature type (wet/electronic/digital)
  - Auto-renewal tracking with renewal decision flags
- **Fuzzy Search** — Full-text search with fuzzy matching across document titles, extracted text, and metadata
- **Search Index** — Pre-built search indexes for fast retrieval (`build_search_index()`, `compute_fuzzy_score()`)
- **Signatories Tracking** — Separate model for signatories with name, role, and organization

### 10. 🔀 Master Documents & Branching

A Git-inspired branching system for legal document templates and variants.

**Key Capabilities:**
- **Master Documents** — Golden-copy template documents that serve as the source of truth
  - Default metadata, style presets, and processing settings inherited by all branches
  - AI generation prompts and per-branch AI service configuration
  - Tags and categories for search and organization
  - Branch count and duplicate count tracking
- **Document Branches** — Full deep-copy clones that inherit from master but diverge freely
  - 4 branch types: Branch from Master, Duplicate, Style/Metadata Variant, Versioned Copy
  - Metadata and style overrides at branch creation
  - AI config cloning with override support
  - Branch lifecycle: Active → Archived → Merged → Superseded
- **Deep Clone Engine** — Complete Section → Paragraph → Sentence → Table → Image → File tree cloning with:
  - Metadata override deep-merging
  - Style preset injection into processing_settings
  - AI service config cloning with per-branch overrides
  - Component index rebuilding

### 11. 📊 Dashboard & Analytics

Comprehensive dashboard for document management, workflow monitoring, and activity tracking.

**Key Capabilities:**
- **Document Overview** — Filterable document list with status, category, type, and mode
- **Collaboration Metadata** — Per-document comment counts, share counts, approval summaries, and workflow status
- **My Documents / Shared with Me / Organization Documents** — Scoped views for different access patterns
- **Workflow Statistics** — Task counts by status, priority breakdown, overdue items
- **Recent Activity** — Activity feed with document access logs
- **Quick Stats** — At-a-glance metrics for documents, pending tasks, and active workflows

### 12. 🔔 Communications & Alert System

Centralized notification system supporting in-app and email delivery.

**Key Capabilities:**
- **Unified Alert Model** — Single `send_alert()` entry point from any app
- **Category-Based Routing** — 20+ alert categories across documents, workflows, DMS, CLM, viewer, and system events:
  - Document: shared, comment, reply, resolved, approval, mention
  - Workflow: assigned, reassigned, status changed, approval request/approved/rejected, due date, decision
  - DMS: expiring, expired, renewal reminder
  - CLM: contract expiring, task assigned/completed
  - Viewer: invitation sent, document shared, new comment, approval submitted
  - System: info, warning, error
- **Per-User Preferences** — Category × channel opt-in/opt-out (global toggle or per-category)
- **Priority Levels** — Low, Normal, High, Urgent with priority-based filtering
- **Email Delivery** — Automatic email sending with error tracking and retry
- **Bulk Alerts** — `send_alert_bulk()` for multi-recipient notifications

### 13. 🔐 User & Organization Management

Multi-tenant organization system with role-based access control and team management.

**Key Capabilities:**
- **Organizations** — Multi-tenant with name, legal name, contact info, full address, logo, brand colors, and subscription plans (Free, Basic, Professional, Enterprise)
- **User Profiles** — Linked to Django `auth.User` with organization membership, role assignment, and department
- **Roles & Permissions** — JSON-based permission matrix (CRUD per resource) with 7 role types: System Admin, Org Admin, Legal Reviewer, Editor, Viewer, Guest, Custom
- **Teams** — Group users within organizations for team-scoped sharing and workflow assignment
- **Organization Document Settings** — Org-wide default processing settings (fonts, page sizes, headers/footers) that cascade to all documents
- **User Document Settings** — Per-user preferences for editing and viewing
- **Invitation System** — Invite users to organizations via secure tokens
- **OTP Login** — Passwordless login via one-time passwords

### 14. ⚙️ Document Workflow & Approval System

Internal document review and approval pipeline with task assignment and decision gates.

**Key Capabilities:**
- **Workflow Task Assignment** — Assign document workflows to specific users, teams, or organizations with priority levels and due dates
- **Approval Chains** — Sequential or parallel multi-approver workflows with mandatory/optional approver flags
- **Decision Steps** — Yes/No decision gates targeting internal users, teams, or external emails (auto-provisions ViewerTokens for external reviewers)
- **Decision Branching** — On rejection: revision required, stop workflow, or jump to specific step (`goto:<order>`)
- **Workflow Comments** — Threaded discussions with comment types (general, question, clarification, update, issue), mention system, and resolution tracking
- **Workflow Notifications** — Assignment, reassignment, approval request, approval/rejection, comment, mention, due date reminders, and status change notifications
- **Auto-Share on Assignment** — When a workflow is assigned, the document is automatically shared with the assignee

---

## 🏗️ Technical Architecture

| Layer | Technology |
|-------|-----------|
| **Backend Framework** | Django 6.0 / Django REST Framework |
| **Language** | Python 3.14 |
| **Database** | SQLite (dev) — easily swappable to PostgreSQL |
| **AI Engine** | Google Gemini (multi-model support) |
| **Task Queue** | Celery + Redis |
| **PDF Generation** | ReportLab + pypdf + PyMuPDF (fitz) |
| **Authentication** | Session-based (internal) + Token-based (viewer) |
| **Frontend** | React (Vite) |
| **Text Extraction** | PyMuPDF, pdfplumber, OCR pipeline |
| **Concurrency** | ETag-based optimistic locking |

### Key Technical Differentiators
- **UUID-First Architecture** — All entities use UUID primary keys for distributed-safe identifiers
- **JSONField Extensibility** — Every model supports unlimited custom metadata via `custom_metadata` JSON fields
- **Generic Sharing** — One sharing model works across all entity types via `GenericForeignKey`
- **Incremental AI** — Content hashing ensures AI inference only re-processes changed components
- **Config Merge Chain** — Multi-level configuration inheritance (org → document → export) with explicit removal sentinels
- **10 Django Apps** — Clean separation of concerns: documents, aiservices, clm, exporter, sharing, viewer, fileshare, dms, communications, user_management

---

## 📊 Platform at a Glance

| Metric | Count |
|--------|-------|
| Django Apps | 10 |
| Document Models | 29 |
| CLM Models | 19 |
| API Endpoints | 100+ |
| Document Actions | 30+ |
| CLM Node Types | 11 |
| AI Services | 12+ |
| Alert Categories | 20+ |
| Sharing Modes | 5 |
| Viewer Access Modes | 3 |
| PDF Export Config Options | 50+ |
| Supported File Types (CLM) | 9 (PDF, DOCX, TXT, CSV, JSON, XML, HTML, MD, DOC) |

---

## 🏆 Competitive Advantages

1. **All-in-One Platform** — Combines document editing + AI analysis + CLM + approval workflows + external sharing in one product (vs. fragmented tools like DocuSign + Ironclad + Google Docs)
2. **AI-Native Architecture** — AI is not bolted on; it's built into every layer — from paragraph-level analysis to document-wide scoring to workflow automation
3. **Visual CLM Workflow Builder** — No-code visual DAG builder with 11 node types, far more flexible than linear approval chains offered by competitors
4. **Hierarchical Inference Engine** — Bottom-up AI processing with incremental updates — competitors re-analyze entire documents on every change
5. **Enterprise Sharing Model** — Generic sharing that works across every entity type with 5 sharing modes and full access audit trails
6. **External Viewer Portal** — Purpose-built secure viewer with OTP access, watermarking, NDA acceptance, and approval workflows — no competitor account needed
7. **LaTeX-Native Support** — First-class LaTeX editing and rendering for technical/mathematical legal documents
8. **Git-Style Branching** — Master document templates with branching, variants, and deep cloning — a paradigm borrowed from software development for legal document management

---

## 🗺️ Use Case Scenarios

### Scenario 1: Contract Review & Approval
1. Upload a contract PDF → AI extracts structure, metadata, and entities
2. AI scores the document (0–100) and flags risky clauses with remediation suggestions
3. Assign review workflow to Legal Counsel → they review AI suggestions and edit
4. Route to external client via Viewer Portal (email OTP) → client comments and approves
5. Export final PDF with organization letterhead → download via secure token

### Scenario 2: High-Volume Contract Processing (CLM)
1. Build visual workflow: Input → Rule (filter by type) → AI (extract key terms) → Validator (legal review) → Action (email notification) → Output
2. Upload 500 vendor contracts via bulk upload or email listener
3. Workflow auto-extracts metadata, filters by contract value, routes high-value contracts for human review
4. Approved contracts auto-generate Drafter documents with extracted metadata pre-filled

### Scenario 3: Template-Based Document Production
1. Create a Master Document (e.g., SaaS Agreement template) with default parties, jurisdiction, and style presets
2. Branch from master for each new client → metadata overrides applied automatically
3. AI generates customized content based on branch-specific context
4. Approval workflow routes each branch through legal review
5. Export client-branded PDFs with organization headers/footers

---

*Drafter — Draft Smarter. Collaborate Faster. Close Sooner.*
