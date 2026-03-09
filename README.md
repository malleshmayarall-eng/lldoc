# Django Backend for Drafter System

Backend API service for the AI-assisted legal document editor, implementing the document structure and AI analysis APIs.

## 📚 Documentation Index

### 🌟 Main Documentation (START HERE)
- **[DOCUMENT_API_COMPLETE.md](DOCUMENT_API_COMPLETE.md)** - **COMPLETE** consolidated API reference for document creation, editing, and management
- **[API_REFERENCE.md](./API_REFERENCE.md)** - Complete API documentation for all endpoints
- **[DEVELOPER_GUIDE_FULL.md](./DEVELOPER_GUIDE_FULL.md)** - Full developer guide

### 📝 Paragraph & Section Saving System (New!)
Complete documentation suite for the document structure saving system:

- **[PARAGRAPH_DOCS_README.md](./PARAGRAPH_DOCS_README.md)** - 📖 **START HERE!** Navigation hub for all paragraph/section documentation
- **[PARAGRAPH_SAVING_SYSTEM.md](./PARAGRAPH_SAVING_SYSTEM.md)** - 📘 Complete implementation guide (850+ lines)
- **[PARAGRAPH_SAVING_QUICK_REF.md](./PARAGRAPH_SAVING_QUICK_REF.md)** - 📋 Quick reference card (printable)
- **[STRUCTURE_API_ENDPOINTS.md](./STRUCTURE_API_ENDPOINTS.md)** - 🔌 Complete API endpoints reference (650+ lines)
- **[DOCUMENTATION_COMPLETE.md](./DOCUMENTATION_COMPLETE.md)** - 🎉 Summary of what was created

**Quick Links:**
- [Three Saving Strategies](./PARAGRAPH_SAVING_QUICK_REF.md#-three-ways-to-save)
- [Auto-Save Implementation](./PARAGRAPH_SAVING_SYSTEM.md#auto-save-implementation)
- [Client ID Mapping](./PARAGRAPH_SAVING_SYSTEM.md#2-client-id-mapping)
- [Error Handling](./PARAGRAPH_SAVING_QUICK_REF.md#-common-errors)
- [All API Endpoints](./STRUCTURE_API_ENDPOINTS.md)

### 🖼️ Image Management
- **[INLINE_IMAGE_API.md](INLINE_IMAGE_API.md)** - Complete inline image API with examples
- **[IMAGE_UPLOAD_API.md](IMAGE_UPLOAD_API.md)** - Document image library management

### 📖 Additional References
- **[API Endpoints Reference](API_ENDPOINTS_REFERENCE.md)** - Quick reference guide for all endpoints
- **[API Testing Guide](API_TESTING_GUIDE.md)** - Curl commands for testing
- **[Document Editing API](DOCUMENT_EDITING_API.md)** - Legacy editing guide (see DOCUMENT_API_COMPLETE.md instead)
- **[Postman Collection](postman_collection.json)** - Import into Postman for easy testing
- **[DMS API Guide](DMS_API.md)** - Document Management System upload/search/download APIs

### 🔧 Issue Resolution
- **[Issue Resolution Guide](ISSUE_RESOLUTION.md)** - URL routing fixes
- **[Section Field Fix](FIX_SECTION_FIELD.md)** - depth_level field correction
- **[Unique Constraint Fix](FIX_UNIQUE_CONSTRAINT.md)** - ID generation fix
- **[POST Sections Fix](FIX_POST_SECTIONS.md)** - Serializer auto-ID generation

## Setup

### Prerequisites
- Python 3.9+
- pip

### Installation

1. Create virtual environment:
```bash
python -m venv venv
source venv/bin/activate  # On macOS/Linux
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Run migrations:
```bash
python manage.py migrate
```

4. Create test user (optional):
```bash
python create_test_user.py
```

5. Start development server:
```bash
python manage.py runserver 8000
```

The API will be available at `http://localhost:8000/api/`

## Quick Start

### 1. Login
```bash
curl -X POST http://localhost:8000/api/auth/login/ \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{"username": "your_username", "password": "your_password"}'
```

### 2. Create a Document
```bash
curl -X POST http://localhost:8000/api/documents/create-structured/ \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "title": "My First Document",
    "sections": [
      {
        "title": "Introduction",
        "order": 1,
        "paragraphs": [
          {"content": "Welcome to the document.", "order": 1}
        ]
      }
    ]
  }'
```

### 3. Edit a Section
```bash
curl -X POST http://localhost:8000/api/documents/{document_id}/edit-section/ \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "section_id": "{section_id}",
    "title": "Introduction - Updated"
  }'
```

## API Endpoints Overview

### 🔐 Authentication (4 endpoints)
- POST `/api/auth/login/` - Login
- POST `/api/auth/register/` - Register
- POST `/api/auth/logout/` - Logout
- GET `/api/auth/me/` - Current user

### 📄 Document Management (8 endpoints)
- GET `/api/documents/` - List all documents
- POST `/api/documents/` - Upload document
- GET `/api/documents/{id}/` - Get document details
- PUT/PATCH `/api/documents/{id}/` - Update document
- DELETE `/api/documents/{id}/` - Delete document
- GET `/api/documents/my-documents/` - User's documents
- GET `/api/documents/organization-documents/` - Organization documents

### ✍️ Document Creation (5 endpoints)
- POST `/api/documents/parse/` - Parse text into document
- POST `/api/documents/create-from-template/` - Create from template
- POST `/api/documents/create-structured/` - Create custom document
- GET `/api/documents/templates/` - List templates
- GET `/api/documents/templates/{name}/` - Template details

### ✏️ Document Editing (4 endpoints) ⭐ NEW
- POST `/api/documents/{id}/edit-section/` - Edit section
- POST `/api/documents/{id}/edit-paragraph/` - Edit paragraph
- POST `/api/documents/{id}/add-section/` - Add section
- DELETE `/api/documents/{id}/delete-section/{section_id}/` - Delete section

### 📝 Change Tracking & Versions (4 endpoints) ⭐ NEW
- GET `/api/documents/{id}/changelog/` - View changes
- POST `/api/documents/{id}/create-version/` - Create version
- GET `/api/documents/{id}/versions/` - List versions
- POST `/api/documents/{id}/restore-version/` - Restore version

### 🔍 Document Analysis (4 endpoints)
- POST `/api/documents/{id}/analyze/` - Analyze document
- POST `/api/documents/{id}/export/` - Export document
- POST `/api/documents/{id}/apply-suggestion/` - Apply AI suggestion
- POST `/api/documents/{id}/rewrite/` - AI rewrite section

### 📑 Sections, Paragraphs, Sentences, Issues (20 endpoints)
Full CRUD operations for all document components

**Total: 49 endpoints**

## Features

### ✅ Document Structure
- Hierarchical sections with depth levels
- Paragraphs with formatting support
- Sentence-level parsing
- Issue tracking and suggestions

### ✅ Document Editing (NEW!)
- Edit section titles and content
- Edit paragraph content and formatting
- Add new sections dynamically
- Delete sections with change logging

### ✅ Change Tracking (NEW!)
- Automatic changelog for all edits
- Track user, timestamp, and changes
- Complete audit trail
- Support for edit, add, delete, restore operations

### ✅ Version Control (NEW!)
- Create named version snapshots
- Store complete document state
- Restore to previous versions
- Automatic backup before restore

### ✅ Template System
- Pre-built templates (employment contract, NDA, etc.)
- Variable replacement
- Custom structured documents

### ✅ Django Admin Panel
- Manage all models through admin interface
- Inline editing for nested structures
- Search and filter capabilities
- Access at `/admin/`

## Admin Panel

Access the Django admin at `http://localhost:8000/admin/`

Features:
- Manage documents, sections, paragraphs
- View and manage issues
- Track changes and versions
- User management

## Testing

### Run Tests
```bash
python manage.py test
```

### Test with curl
See [API Testing Guide](API_TESTING_GUIDE.md) for comprehensive curl examples.

### Test Editing API
See [Editing API Test Guide](EDITING_API_TEST_GUIDE.md) for editing-specific tests.

## Project Structure

```
backend/
├── drafter/              # Django project settings
│   ├── settings.py
│   ├── urls.py
│   └── middleware.py
├── documents/            # Main app
│   ├── models.py         # Document, Section, Paragraph, etc.
│   ├── views.py          # API endpoints (49 total)
│   ├── serializers.py    # DRF serializers
│   ├── services.py       # Document parsing & analysis
│   ├── document_drafter.py  # Template system
│   └── admin.py          # Django admin configuration
└── user_management/      # Authentication
    ├── auth_views.py     # Login/register/logout
    └── models.py         # User model
```

## Models

### Document
- Metadata (title, author, dates)
- Status tracking
- User relationships

### Section
- Hierarchical structure
- Title and content
- Depth levels and ordering

### Paragraph
- Content with formatting
- Edit tracking
- Sentence relationships

### Sentence
- Content ranges
- Text storage

### Issue
- Type and severity
- Suggestions
- Status tracking

### ChangeLog (NEW!)
- Change tracking
- User attribution
- Old/new values

### DocumentVersion (NEW!)
- Version snapshots
- Restore capability
- Notes and metadata
- `POST /api/documents/{id}/apply-suggestion` - Apply AI suggestion
- `POST /api/documents/{id}/rewrite` - Get AI rewrite

### Issues

- `GET /api/documents/{id}/issues` - List all issues for a document
- `PUT /api/issues/{id}` - Update issue status (accept/reject/ignore)

## Project Structure

```
backend/
├── manage.py
├── requirements.txt
├── drafter/
│   ├── settings.py
│   ├── urls.py
│   └── wsgi.py
└── documents/
    ├── models.py          # Document, Section, Paragraph, Issue models
    ├── serializers.py     # DRF serializers
    ├── views.py           # API views
    ├── services.py        # Business logic (parsing, analysis)
    └── urls.py            # URL routing
```
# lldoc
