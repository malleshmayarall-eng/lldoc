#!/usr/bin/env python
"""Decrypt embedded text attachment from a protected PDF."""

from __future__ import annotations

import argparse
import base64
import hashlib
from pathlib import Path

from pypdf import PdfReader

try:
    from cryptography.fernet import Fernet
except ImportError as exc:  # pragma: no cover
    raise SystemExit("cryptography is required for decrypting text") from exc


def _derive_fernet_key(key: str) -> bytes:
    digest = hashlib.sha256(key.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest)


def main() -> int:
    parser = argparse.ArgumentParser(description="Decrypt PDF embedded text attachment.")
    parser.add_argument("pdf_path", type=Path, help="Path to the protected PDF")
    parser.add_argument("key", help="Text protection key")
    args = parser.parse_args()

    if not args.pdf_path.exists():
        raise SystemExit(f"PDF not found: {args.pdf_path}")

    reader = PdfReader(str(args.pdf_path))
    attachments = getattr(reader, "attachments", {}) or {}
    payload = None
    if isinstance(attachments, dict):
        payload = attachments.get("document_text.enc")
    if payload is None:
        raise SystemExit("No document_text.enc attachment found")

    fernet = Fernet(_derive_fernet_key(args.key))
    decrypted = fernet.decrypt(payload)
    print(decrypted.decode("utf-8", errors="replace"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
