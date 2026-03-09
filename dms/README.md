# DMS (Document Management System)

This app stores PDF files directly in the database, extracts metadata, and exposes search APIs for retrieval.

## Key endpoints

- `POST /api/dms/documents/` (multipart form data with `file`)
- `POST /api/dms/documents/search/` (JSON body with `query`, `metadata_filters`)
- `GET /api/dms/documents/<id>/` (metadata; use `?include_pdf=true` for base64)
- `GET /api/dms/documents/<id>/download/` (raw PDF)
