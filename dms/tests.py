from __future__ import annotations

import io
from typing import Any, cast

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APITestCase, APIClient
from pypdf import PdfWriter


User = get_user_model()


def _make_pdf_bytes(title: str = "Sample Doc") -> bytes:
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    writer.add_metadata({"/Title": title, "/Author": "Tester"})
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


class DmsDocumentTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="tester", password="pass1234")
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_upload_and_search(self):
        pdf_bytes = _make_pdf_bytes("Searchable PDF")
        upload = SimpleUploadedFile("sample.pdf", pdf_bytes, content_type="application/pdf")
        response = self.client.post("/api/dms/documents/", {"file": upload})
        self.assertEqual(response.status_code, 201)
        response_data = cast(dict[str, Any], cast(Any, response).data)
        doc_id = response_data["id"]

        search_response = self.client.post("/api/dms/documents/search/", {"query": "searchable"})
        self.assertEqual(search_response.status_code, 200)
        search_data = cast(list[dict[str, Any]], cast(Any, search_response).data)
        self.assertTrue(any(item["id"] == doc_id for item in search_data))

        download_response = self.client.get(f"/api/dms/documents/{doc_id}/download/")
        self.assertEqual(download_response.status_code, 200)
        self.assertEqual(download_response["Content-Type"], "application/pdf")
