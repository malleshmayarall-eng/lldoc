"""
Cloud & External Source Integrations for Input Nodes
=====================================================
Each handler fetches files from a remote source, creates WorkflowDocuments,
and optionally runs AI extraction.

Supported sources:
  • google_drive — Google Drive folder via service account / API key
  • dropbox      — Dropbox folder via access token
  • onedrive     — OneDrive / SharePoint via Microsoft Graph
  • s3           — AWS S3 bucket via access key
  • ftp          — FTP/SFTP server
  • url_scrape   — Fetch documents from URLs

Each handler returns:
  {"found": int, "skipped": int, "documents_created": [...], "errors": [...]}
"""
import io
import logging
import os
import hashlib
from datetime import datetime, timezone
from urllib.parse import urlparse

from django.core.files.base import ContentFile

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _file_hash(content: bytes) -> str:
    """SHA-256 of raw bytes — used to deduplicate already-fetched files."""
    return hashlib.sha256(content).hexdigest()


def _already_ingested(workflow, source_hash: str) -> bool:
    """True if a doc with this source_hash already exists in the workflow."""
    from .models import WorkflowDocument
    return WorkflowDocument.objects.filter(
        workflow=workflow,
        global_metadata__source_hash=source_hash,
    ).exists()





                extra_metadata=None, user=None):
    """Create a WorkflowDocument from raw bytes, or reconcile if already exists."""
    from .models import WorkflowDocument

    source_hash = _file_hash(content_bytes)
    if _already_ingested(workflow, source_hash):
        return None, True  # (doc, skipped)

    file_type = file_ext.lower().lstrip('.')
    allowed = {
        'pdf', 'docx', 'doc', 'txt', 'csv', 'json', 'xml', 'html', 'htm',
        'md', 'rtf', 'odt',
        'xlsx', 'xls',
        'pptx', 'ppt',
        'png', 'jpg', 'jpeg', 'gif', 'bmp', 'tiff', 'tif', 'webp', 'svg',
        'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz',
        'other',
    }
    if file_type not in allowed:
        file_type = 'other'

    meta = {'source_hash': source_hash}
    if extra_metadata:
        meta.update(extra_metadata)

    doc = WorkflowDocument.objects.create(
        workflow=workflow,
        organization=organization,
        title=title,
        file=ContentFile(content_bytes, name=f"{title}.{file_type}"),
        file_type=file_type,
        file_size=len(content_bytes),
        uploaded_by=user,
        global_metadata=meta,
    )
    return doc, False





# =========================================================================
# 1. Google Drive  (dual mode: public via API key / private via service account)
# =========================================================================

def _extract_folder_id(folder_input: str) -> str:
    """
    Accept either a raw folder ID or a full Google Drive URL and extract the ID.
    Examples:
      '1A2B3C4D5E6F'                                   → '1A2B3C4D5E6F'
      'https://drive.google.com/drive/folders/1A2B3C4D5E6F'           → '1A2B3C4D5E6F'
      'https://drive.google.com/drive/folders/1A2B3C4D5E6F?usp=sharing' → '1A2B3C4D5E6F'
      'https://drive.google.com/drive/u/0/folders/1A2B3C4D5E6F'       → '1A2B3C4D5E6F'
    """
    import re
    folder_input = folder_input.strip()
    # Full URL pattern
    m = re.search(r'/folders/([a-zA-Z0-9_-]+)', folder_input)
    if m:
        return m.group(1)
    # Already a raw ID (alphanumeric, hyphens, underscores)
    if re.match(r'^[a-zA-Z0-9_-]+$', folder_input):
        return folder_input
    return folder_input


def _fetch_google_drive_public(folder_id, api_key, exts, workflow,
                                organization, user, result):
    """
    Fetch files from a PUBLIC Google Drive folder using gdown.
    gdown handles large-file confirmation pages, virus scan warnings, and
    Google's download restrictions automatically.

    Falls back to the API-key method for listing files (gdown for download).
    """
    import requests as req
    import tempfile

    # Use Drive API to LIST files (gdown doesn't list folders)
    base = 'https://www.googleapis.com/drive/v3/files'
    params = {
        'q': f"'{folder_id}' in parents and trashed = false",
        'pageSize': 100,
        'fields': 'files(id,name,mimeType,size,modifiedTime)',
        'key': api_key,
    }
    try:
        resp = req.get(base, params=params, timeout=30)
        resp.raise_for_status()
    except Exception as e:
        result['errors'].append(f'Google Drive API listing failed: {e}')
        return

    files = resp.json().get('files', [])

    for gfile in files:
        fname = gfile['name']
        ext = fname.rsplit('.', 1)[-1].lower() if '.' in fname else ''
        if exts and ext not in exts:
            continue

        # Use gdown for the actual download — handles large files + confirmations
        try:
            import gdown
            file_url = f'https://drive.google.com/uc?id={gfile["id"]}'
            with tempfile.NamedTemporaryFile(delete=False, suffix=f'.{ext or "bin"}') as tmp:
                tmp_path = tmp.name

            output = gdown.download(file_url, tmp_path, quiet=True, fuzzy=True)
            if not output or not os.path.exists(tmp_path):
                result['errors'].append(f'{fname}: gdown download failed')
                continue

            with open(tmp_path, 'rb') as f:
                content = f.read()
            os.unlink(tmp_path)

            if not content:
                result['errors'].append(f'{fname}: downloaded file is empty')
                continue

        except ImportError:
            # gdown not installed — fallback to direct API download
            dl_url = f'https://www.googleapis.com/drive/v3/files/{gfile["id"]}?alt=media&key={api_key}'
            dl_resp = req.get(dl_url, timeout=60)
            dl_resp.raise_for_status()
            content = dl_resp.content
        except Exception as e:
            result['errors'].append(f'{fname}: download failed — {e}')
            continue

        doc, skipped = _create_doc(
            workflow, fname, content, ext, organization,
            extra_metadata={
                '_source': 'google_drive',
                '_access': 'public',
                'drive_file_id': gfile['id'],
                'drive_modified': gfile.get('modifiedTime', ''),
            },
            user=user,
        )
    query = f"'{folder_id}' in parents and trashed = false"
    resp = service.files().list(
        q=query, pageSize=100,
        fields='files(id,name,mimeType,size,modifiedTime)',
    ).execute()

    for gfile in resp.get('files', []):
        fname = gfile['name']
        ext = fname.rsplit('.', 1)[-1].lower() if '.' in fname else ''
        if exts and ext not in exts:
            continue

        request = service.files().get_media(fileId=gfile['id'])
        buf = io.BytesIO()
        downloader = MediaIoBaseDownload(buf, request)
        done = False
        while not done:
            _, done = downloader.next_chunk()

        doc, skipped = _create_doc(
            workflow, fname, buf.getvalue(), ext, organization,
            extra_metadata={
                '_source': 'google_drive',
                '_access': 'private',
                'drive_file_id': gfile['id'],
                'drive_modified': gfile.get('modifiedTime', ''),
            },
            user=user,
        )
        if skipped:
            result['skipped'] += 1
        elif doc:
            # Document metadata extraction removed
            result['found'] += 1
            result['documents_created'].append({
                'id': str(doc.id), 'title': doc.title,
            })


def fetch_google_drive(node, workflow, organization, user=None):
    """
    Fetch files from a Google Drive folder.

    Dual mode:
      • PUBLIC  — folder shared as "Anyone with link". Needs API key only.
        Config: google_folder_id (or URL), google_api_key, google_access='public'
      • PRIVATE — folder shared with a service account. Needs service account JSON.
        Config: google_folder_id (or URL), google_credentials_json, google_access='private'
    """
    config = node.config or {}
    raw_folder = config.get('google_folder_id', '') or config.get('google_folder_url', '')
    access_mode = config.get('google_access', 'public')

    result = {'found': 0, 'skipped': 0, 'documents_created': [], 'errors': []}

    if not raw_folder:
        result['errors'].append('Google Drive folder ID or URL is required')
        return result

    folder_id = _extract_folder_id(raw_folder)
    exts = config.get('file_extensions', [])

    try:
        if access_mode == 'private':
            creds_json = config.get('google_credentials_json', '')
            if not creds_json:
                result['errors'].append('Service Account JSON is required for private folders')
                return result
            _fetch_google_drive_private(
                folder_id, creds_json, exts, workflow, organization, user, result,
            )
        else:
            # Public mode
            api_key = config.get('google_api_key', '')
            if api_key:
                _fetch_google_drive_public(
                    folder_id, api_key, exts, workflow, organization, user, result,
                )
            else:
                # No API key — use gdown for public folders (no key needed)
                try:
                    _gdown_folder(
                        folder_id, workflow, organization, user, result,
                    )
                except Exception as e:
                    result['errors'].append(
                        f'gdown folder download failed: {e}. '
                        f'Alternatively, provide a Google API key for more reliable access.'
                    )
    except Exception as e:
        logger.error(f"Google Drive fetch failed: {e}", exc_info=True)
        result['errors'].append(str(e))

    return result


# =========================================================================
# 2. Dropbox
# =========================================================================

def fetch_dropbox(node, workflow, organization, user=None):
    """
    Fetch files from a Dropbox folder.
    Config keys:
      - dropbox_access_token : OAuth2 access token
      - dropbox_folder_path  : folder path (e.g. "/Contracts")
      - file_extensions      : optional filter
    """
    config = node.config or {}
    access_token = config.get('dropbox_access_token', '')
    folder_path = config.get('dropbox_folder_path', '')

    result = {'found': 0, 'skipped': 0, 'documents_created': [], 'errors': []}

    if not access_token:
        result['errors'].append('dropbox_access_token is required')
        return result
    if not folder_path:
        folder_path = ''

    try:
        import dropbox as dbx_lib
    except ImportError:
        result['errors'].append(
            'Dropbox SDK not installed. Run: pip install dropbox'
        )
        return result

    try:
        dbx = dbx_lib.Dropbox(access_token)
        entries = dbx.files_list_folder(folder_path).entries
        exts = config.get('file_extensions', [])

        for entry in entries:
            if not hasattr(entry, 'name'):
                continue
            fname = entry.name
            ext = fname.rsplit('.', 1)[-1].lower() if '.' in fname else ''
            if exts and ext not in exts:
                continue

            # Download
            _, resp = dbx.files_download(entry.path_lower)
            content = resp.content

            doc, skipped = _create_doc(
                workflow, fname, content, ext, organization,
                extra_metadata={
                    '_source': 'dropbox',
                    'dropbox_path': entry.path_lower,
                    'dropbox_id': entry.id,
                },
                user=user,
            )
            if skipped:
                result['skipped'] += 1
            elif doc:
                # Document metadata extraction removed
                result['found'] += 1
                result['documents_created'].append({
                    'id': str(doc.id), 'title': doc.title,
                })

    except Exception as e:
        logger.error(f"Dropbox fetch failed: {e}", exc_info=True)
        result['errors'].append(str(e))

    return result


# =========================================================================
# 3. OneDrive / SharePoint (Microsoft Graph)
# =========================================================================

def fetch_onedrive(node, workflow, organization, user=None):
    """
    Fetch files from OneDrive / SharePoint via Microsoft Graph API.
    Config keys:
      - onedrive_access_token : Bearer token (OAuth2)
      - onedrive_folder_path  : e.g. "/drive/root:/Contracts:/children"
      - onedrive_drive_id     : optional drive ID for shared drives
      - file_extensions        : optional filter
    """
    import requests

    config = node.config or {}
    access_token = config.get('onedrive_access_token', '')
    folder_path = config.get('onedrive_folder_path', '/drive/root/children')
    drive_id = config.get('onedrive_drive_id', '')

    result = {'found': 0, 'skipped': 0, 'documents_created': [], 'errors': []}

    if not access_token:
        result['errors'].append('onedrive_access_token is required')
        return result

    try:
        base_url = 'https://graph.microsoft.com/v1.0/me'
        if drive_id:
            base_url = f'https://graph.microsoft.com/v1.0/drives/{drive_id}'

        # Normalise folder path
        if not folder_path.startswith('/'):
            folder_path = '/' + folder_path
        if folder_path == '/':
            url = f'{base_url}/drive/root/children'
        elif ':/children' in folder_path:
            url = f'{base_url}{folder_path}'
        else:
            url = f'{base_url}/drive/root:/{folder_path.strip("/")}:/children'

        headers = {'Authorization': f'Bearer {access_token}'}
        resp = requests.get(url, headers=headers, timeout=30)
        resp.raise_for_status()
        items = resp.json().get('value', [])

        exts = config.get('file_extensions', [])

        for item in items:
            if 'file' not in item:
                continue  # Skip folders
            fname = item['name']
            ext = fname.rsplit('.', 1)[-1].lower() if '.' in fname else ''
            if exts and ext not in exts:
                continue

            # Download
            download_url = item.get('@microsoft.graph.downloadUrl') or item.get('downloadUrl', '')
            if not download_url:
                dl_resp = requests.get(
                    f'{base_url}/drive/items/{item["id"]}/content',
                    headers=headers, timeout=60, allow_redirects=True,
                )
            else:
                dl_resp = requests.get(download_url, timeout=60)
            dl_resp.raise_for_status()

            doc, skipped = _create_doc(
                workflow, fname, dl_resp.content, ext, organization,
                extra_metadata={
                    '_source': 'onedrive',
                    'onedrive_item_id': item['id'],
                    'onedrive_modified': item.get('lastModifiedDateTime', ''),
                },
                user=user,
            )
            if skipped:
                result['skipped'] += 1
            elif doc:
                # Document metadata extraction removed
                result['found'] += 1
                result['documents_created'].append({
                    'id': str(doc.id), 'title': doc.title,
                })

    except Exception as e:
        logger.error(f"OneDrive fetch failed: {e}", exc_info=True)
        result['errors'].append(str(e))

    return result


# =========================================================================
# 4. AWS S3
# =========================================================================

def fetch_s3(node, workflow, organization, user=None):
    """
    Fetch files from an AWS S3 bucket.
    Config keys:
      - s3_bucket          : bucket name
      - s3_prefix           : key prefix (folder path)
      - s3_access_key       : AWS access key ID
      - s3_secret_key       : AWS secret access key
      - s3_region            : region (default us-east-1)
      - file_extensions      : optional filter
    """
    config = node.config or {}
    bucket = config.get('s3_bucket', '')
    prefix = config.get('s3_prefix', '')
    access_key = config.get('s3_access_key', '')
    secret_key = config.get('s3_secret_key', '')
    region = config.get('s3_region', 'us-east-1')

    result = {'found': 0, 'skipped': 0, 'documents_created': [], 'errors': []}

    if not bucket:
        result['errors'].append('s3_bucket is required')
        return result

    try:
        import boto3
    except ImportError:
        result['errors'].append('boto3 not installed. Run: pip install boto3')
        return result

    try:
        session_kwargs = {'region_name': region}
        if access_key and secret_key:
            session_kwargs.update({
                'aws_access_key_id': access_key,
                'aws_secret_access_key': secret_key,
            })
        s3 = boto3.client('s3', **session_kwargs)

        paginator = s3.get_paginator('list_objects_v2')
        pages = paginator.paginate(Bucket=bucket, Prefix=prefix, MaxKeys=100)

        exts = config.get('file_extensions', [])

        for page in pages:
            for obj in page.get('Contents', []):
                key = obj['Key']
                if key.endswith('/'):
                    continue  # Skip folders
                fname = key.rsplit('/', 1)[-1]
                ext = fname.rsplit('.', 1)[-1].lower() if '.' in fname else ''
                if exts and ext not in exts:
                    continue

                # Download
                s3_obj = s3.get_object(Bucket=bucket, Key=key)
                content = s3_obj['Body'].read()

                doc, skipped = _create_doc(
                    workflow, fname, content, ext, organization,
                    extra_metadata={
                        '_source': 's3',
                        's3_bucket': bucket,
                        's3_key': key,
                        's3_modified': obj.get('LastModified', datetime.now(timezone.utc)).isoformat(),
                    },
                    user=user,
                )
                if skipped:
                    result['skipped'] += 1
                elif doc:
                    # Document metadata extraction removed
                    result['found'] += 1
                    result['documents_created'].append({
                        'id': str(doc.id), 'title': doc.title,
                    })

    except Exception as e:
        logger.error(f"S3 fetch failed: {e}", exc_info=True)
        result['errors'].append(str(e))

    return result


# =========================================================================
# 5. FTP / SFTP
# =========================================================================

def fetch_ftp(node, workflow, organization, user=None):
    """
    Fetch files from FTP or SFTP server.
    Config keys:
      - ftp_host         : hostname
      - ftp_port         : port (21 for FTP, 22 for SFTP)
      - ftp_user         : username
      - ftp_password     : password
      - ftp_path         : remote directory path
      - ftp_protocol     : 'ftp' or 'sftp' (default: 'ftp')
      - file_extensions  : optional filter
    """
    config = node.config or {}
    host = config.get('ftp_host', '')
    port = int(config.get('ftp_port', 21))
    ftp_user = config.get('ftp_user', 'anonymous')
    password = config.get('ftp_password', '')
    remote_path = config.get('ftp_path', '/')
    protocol = config.get('ftp_protocol', 'ftp')

    result = {'found': 0, 'skipped': 0, 'documents_created': [], 'errors': []}

    if not host:
        result['errors'].append('ftp_host is required')
        return result

    exts = config.get('file_extensions', [])

    if protocol == 'sftp':
        try:
            import paramiko
        except ImportError:
            result['errors'].append('paramiko not installed. Run: pip install paramiko')
            return result

        try:
            transport = paramiko.Transport((host, port))
            transport.connect(username=ftp_user, password=password)
            sftp = paramiko.SFTPClient.from_transport(transport)

            for entry in sftp.listdir_attr(remote_path):
                fname = entry.filename
                if fname.startswith('.'):
                    continue
                ext = fname.rsplit('.', 1)[-1].lower() if '.' in fname else ''
                if exts and ext not in exts:
                    continue

                buf = io.BytesIO()
                sftp.getfo(f'{remote_path.rstrip("/")}/{fname}', buf)

                doc, skipped = _create_doc(
                    workflow, fname, buf.getvalue(), ext, organization,
                    extra_metadata={'_source': 'sftp', 'sftp_host': host, 'sftp_path': f'{remote_path}/{fname}'},
                    user=user,
                )
                if skipped:
                    result['skipped'] += 1
                elif doc:
                    # Document metadata extraction removed
                    result['found'] += 1
                    result['documents_created'].append({'id': str(doc.id), 'title': doc.title})

            sftp.close()
            transport.close()
        except Exception as e:
            logger.error(f"SFTP fetch failed: {e}", exc_info=True)
            result['errors'].append(str(e))
    else:
        # Plain FTP
        import ftplib
        try:
            ftp = ftplib.FTP()
            ftp.connect(host, port, timeout=30)
            ftp.login(ftp_user, password)
            ftp.cwd(remote_path)

            filenames = ftp.nlst()
            for fname in filenames:
                if fname.startswith('.'):
                    continue
                ext = fname.rsplit('.', 1)[-1].lower() if '.' in fname else ''
                if exts and ext not in exts:
                    continue

                buf = io.BytesIO()
                ftp.retrbinary(f'RETR {fname}', buf.write)

                doc, skipped = _create_doc(
                    workflow, fname, buf.getvalue(), ext, organization,
                    extra_metadata={'_source': 'ftp', 'ftp_host': host, 'ftp_path': f'{remote_path}/{fname}'},
                    user=user,
                )
                if skipped:
                    result['skipped'] += 1
                elif doc:
                    # Document metadata extraction removed
                    result['found'] += 1
                    result['documents_created'].append({'id': str(doc.id), 'title': doc.title})

            ftp.quit()
        except Exception as e:
            logger.error(f"FTP fetch failed: {e}", exc_info=True)
            result['errors'].append(str(e))

    return result


# =========================================================================
# 6. URL Scrape
# =========================================================================

def _extract_main_content(html_text: str, url: str = '') -> str:
    """
    Extract the main readable content from an HTML page.
    Tries (in order):
      1. trafilatura  — best quality, extracts article body
      2. readability-lxml — Mozilla Readability port
      3. BeautifulSoup — fallback, strips junk tags + extracts <article>/<main>
    """
    # -- 1. trafilatura (best) --
    try:
        import trafilatura
        result = trafilatura.extract(
            html_text,
            include_links=False,
            include_images=False,
            include_tables=True,
            favor_precision=True,
        )
        if result and len(result) > 100:
            return result
    except ImportError:
        pass
    except Exception:
        pass

    # -- 2. readability-lxml --
    try:
        from readability import Document as ReadabilityDoc
        from bs4 import BeautifulSoup
        doc = ReadabilityDoc(html_text)
        title = doc.title()
        summary_html = doc.summary()
        soup = BeautifulSoup(summary_html, 'html.parser')
        text = soup.get_text(separator='\n', strip=True)
        if title and text:
            text = f"{title}\n\n{text}"
        if len(text) > 100:
            return text
    except ImportError:
        pass
    except Exception:
        pass

    # -- 3. BeautifulSoup fallback — target <article>, <main>, or <body> --
    try:
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(html_text, 'html.parser')

        # Strip non-content tags
        for tag in soup(['script', 'style', 'nav', 'footer', 'header',
                         'aside', 'form', 'iframe', 'noscript',
                         'svg', 'button', 'input', 'select']):
            tag.decompose()

        # Remove common junk by class/id
        for attr in ['class', 'id']:
            for junk in ['sidebar', 'menu', 'cookie', 'banner', 'popup',
                         'social', 'share', 'comment', 'newsletter',
                         'advertisement', 'ad-', 'promo', 'related']:
                for el in soup.find_all(attrs={attr: lambda v: v and junk in str(v).lower()}):
                    el.decompose()

        # Try to find the main content container
        content = (
            soup.find('article')
            or soup.find('main')
            or soup.find('div', role='main')
            or soup.find('div', class_=lambda c: c and 'content' in str(c).lower())
            or soup.find('body')
            or soup
        )

        text = content.get_text(separator='\n', strip=True)

        # Collapse excessive blank lines
        import re
        text = re.sub(r'\n{3,}', '\n\n', text)
        return text
    except ImportError:
        # No BeautifulSoup at all — return raw text stripped of tags
        import re
        text = re.sub(r'<[^>]+>', ' ', html_text)
        text = re.sub(r'\s+', ' ', text).strip()
        return text


# ---------------------------------------------------------------------------
# gdown helpers — download public Google Drive files/folders without API key
# ---------------------------------------------------------------------------

def _gdown_file(file_id, source_url, workflow, organization, user, result):
    """Download a single public Google Drive file using gdown."""
    import gdown
    import tempfile

    dl_url = f'https://drive.google.com/uc?id={file_id}'

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = os.path.join(tmpdir, 'download')
        output = gdown.download(dl_url, tmp_path, quiet=True, fuzzy=True)

        if not output or not os.path.exists(output):
            result['errors'].append(f'gdown failed for file {file_id}')
            return

        # gdown may rename the output to the real filename
        fname = os.path.basename(output)
        ext = fname.rsplit('.', 1)[-1].lower() if '.' in fname else ''

        with open(output, 'rb') as f:
            content = f.read()

    if not content:
        result['errors'].append(f'{fname}: downloaded file is empty')
        return

    doc, skipped = _create_doc(
        workflow, fname, content, ext, organization,
        extra_metadata={
            '_source': 'url_scrape', 'source_url': source_url,
            'drive_file_id': file_id,
        },
        user=user,
    )
    if skipped:
        result['skipped'] += 1
    elif doc:
            # Document metadata extraction removed
        result['found'] += 1
        result['documents_created'].append({'id': str(doc.id), 'title': doc.title})


def _gdown_folder(folder_id, workflow, organization, user, result):
    """Download all files from a public Google Drive folder using gdown."""
    import gdown
    import tempfile

    folder_url = f'https://drive.google.com/drive/folders/{folder_id}'

    with tempfile.TemporaryDirectory() as tmpdir:
        try:
            downloaded = gdown.download_folder(
                folder_url, output=tmpdir, quiet=True,
                remaining_ok=True,
            )
        except Exception as e:
            result['errors'].append(f'gdown folder download failed: {e}')
            return

        if not downloaded:
            result['errors'].append('gdown folder download returned no files')
            return

        # Walk the downloaded directory for all files
        for root, _dirs, files in os.walk(tmpdir):
            for fname in files:
                fpath = os.path.join(root, fname)
                ext = fname.rsplit('.', 1)[-1].lower() if '.' in fname else ''

                try:
                    with open(fpath, 'rb') as f:
                        content = f.read()
                except Exception:
                    continue

                if not content:
                    continue

                doc, skipped = _create_doc(
                    workflow, fname, content, ext, organization,
                    extra_metadata={
                        '_source': 'url_scrape',
                        'source_url': folder_url,
                        'drive_folder_id': folder_id,
                    },
                    user=user,
                )
                if skipped:
                    result['skipped'] += 1
                elif doc:
                    # Document metadata extraction removed
                    result['found'] += 1
                    result['documents_created'].append({
                        'id': str(doc.id), 'title': doc.title,
                    })


def fetch_urls(node, workflow, organization, user=None):
    """
    Fetch documents from a list of URLs.

    • Google Drive file/folder links → auto-detected and downloaded via API
    • PDF/DOCX/images/archives/binary links → downloaded as files directly
    • HTML pages → main content extracted (article body only,
      boilerplate/nav/ads stripped) and saved as .txt

    Config keys:
      - urls              : list of URLs to fetch
      - scrape_text       : if True (default for HTML), extract main text content
      - request_headers   : optional dict of HTTP headers
    """
    import re
    import requests

    config = node.config or {}
    urls = config.get('urls', [])
    scrape_text = config.get('scrape_text', True)   # default ON — extract text
    req_headers = config.get('request_headers', {})

    result = {'found': 0, 'skipped': 0, 'documents_created': [], 'errors': []}

    if not urls:
        result['errors'].append('No URLs provided')
        return result

    # Binary file extensions — download as-is, don't try to extract text
    binary_exts = {
        # Documents
        'pdf', 'docx', 'doc', 'rtf', 'odt',
        # Spreadsheets
        'xlsx', 'xls', 'csv',
        # Presentations
        'pptx', 'ppt',
        # Images
        'jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'tif', 'webp', 'svg',
        'ico', 'heic', 'heif', 'avif', 'raw',
        # Archives
        'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz',
        'tar.gz', 'tar.bz2', 'tar.xz',
        # Audio / Video (save raw)
        'mp3', 'wav', 'mp4', 'avi', 'mkv', 'mov',
        # Other binary
        'exe', 'dll', 'bin', 'iso', 'dmg',
    }

    # Content-type prefixes that indicate binary content
    binary_content_types = (
        'application/pdf', 'application/octet', 'application/vnd',
        'application/zip', 'application/x-rar', 'application/x-7z',
        'application/gzip', 'application/x-tar', 'application/x-bzip',
        'application/msword', 'application/x-compressed',
        'image/', 'audio/', 'video/',
    )

    for url in urls:
        try:
            url = url.strip()
            if not url:
                continue

            # ── Google Drive link detection ───────────────────────────
            # Handles:
            #   https://drive.google.com/file/d/FILE_ID/...
            #   https://drive.google.com/open?id=FILE_ID
            #   https://drive.google.com/uc?id=FILE_ID&export=download
            #   https://drive.google.com/drive/folders/FOLDER_ID/...
            gdrive_file_match = re.search(
                r'drive\.google\.com/(?:file/d/|open\?id=|uc\?.*id=)([a-zA-Z0-9_-]+)',
                url,
            )
            gdrive_folder_match = re.search(
                r'drive\.google\.com/(?:drive/(?:u/\d+/)?folders?/)([a-zA-Z0-9_-]+)',
                url,
            )

            if gdrive_folder_match:
                # Google Drive folder → use gdown to download all files
                folder_id = gdrive_folder_match.group(1)
                try:
                    _gdown_folder(folder_id, workflow, organization, user, result)
                except Exception as e:
                    result['errors'].append(f"{url}: Google Drive folder download failed — {e}")
                continue

            if gdrive_file_match:
                # Google Drive single file → use gdown
                file_id = gdrive_file_match.group(1)
                try:
                    _gdown_file(file_id, url, workflow, organization, user, result)
                except Exception as e:
                    result['errors'].append(f"{url}: Google Drive file download failed — {e}")
                continue

            # ── Regular URL download ──────────────────────────────────
            parsed = urlparse(url)
            path = parsed.path.rstrip('/')
            fname = path.rsplit('/', 1)[-1] or 'document'
            ext = fname.rsplit('.', 1)[-1].lower() if '.' in fname else ''

            resp = requests.get(url, headers=req_headers, timeout=60,
                                allow_redirects=True, stream=True)
            resp.raise_for_status()

            content_type = resp.headers.get('Content-Type', '').lower()

            # Try to get real filename from Content-Disposition header
            cd = resp.headers.get('Content-Disposition', '')
            if cd:
                fname_match = re.search(
                    r'filename[*]?=["\']?(?:UTF-8\'\')?([^"\';\n]+)', cd,
                )
                if fname_match:
                    fname = fname_match.group(1).strip()
                    ext = fname.rsplit('.', 1)[-1].lower() if '.' in fname else ext

            # Determine if binary
            is_binary = (
                ext in binary_exts
                or any(content_type.startswith(ct) for ct in binary_content_types)
            )

            if is_binary:
                content_bytes = resp.content
                if not ext or ext in ('html', 'htm'):
                    ext = _guess_ext_from_content_type(content_type)
            elif scrape_text and 'html' in content_type:
                # HTML page → extract main content only
                text = _extract_main_content(resp.text, url)
                if not text or len(text.strip()) < 50:
                    result['errors'].append(f"{url}: Page had no extractable content")
                    continue
                content_bytes = text.encode('utf-8')
                ext = 'txt'
                fname = (fname.rsplit('.', 1)[0] if '.' in fname else fname) + '.txt'
            elif 'text/plain' in content_type:
                content_bytes = resp.content
                ext = 'txt'
            elif 'json' in content_type:
                content_bytes = resp.content
                ext = 'json'
            elif 'xml' in content_type:
                content_bytes = resp.content
                ext = 'xml'
            else:
                # Unknown content type — save raw
                content_bytes = resp.content
                if not ext:
                    ext = _guess_ext_from_content_type(content_type) or 'html'

            doc, skipped = _create_doc(
                workflow, fname, content_bytes, ext, organization,
                extra_metadata={'_source': 'url_scrape', 'source_url': url},
                user=user,
            )
            if skipped:
                result['skipped'] += 1
            elif doc:
                _run_extraction(doc, workflow)
                result['found'] += 1
                result['documents_created'].append({
                    'id': str(doc.id), 'title': doc.title,
                })

        except Exception as e:
            logger.error(f"URL fetch failed for {url}: {e}")
            result['errors'].append(f"{url}: {str(e)}")

    return result


def _guess_ext_from_content_type(content_type: str) -> str:
    """Map Content-Type header to a file extension."""
    ct = content_type.lower().split(';')[0].strip()
    _CT_MAP = {
        'application/pdf': 'pdf',
        'application/msword': 'doc',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
        'application/vnd.ms-excel': 'xls',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
        'application/vnd.ms-powerpoint': 'ppt',
        'application/zip': 'zip',
        'application/x-rar-compressed': 'rar',
        'application/vnd.rar': 'rar',
        'application/x-7z-compressed': '7z',
        'application/gzip': 'gz',
        'application/x-tar': 'tar',
        'application/x-bzip2': 'bz2',
        'application/json': 'json',
        'application/xml': 'xml',
        'application/rtf': 'rtf',
        'text/plain': 'txt',
        'text/csv': 'csv',
        'text/markdown': 'md',
        'text/xml': 'xml',
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/gif': 'gif',
        'image/bmp': 'bmp',
        'image/tiff': 'tiff',
        'image/webp': 'webp',
        'image/svg+xml': 'svg',
        'image/x-icon': 'ico',
        'image/heic': 'heic',
        'image/avif': 'avif',
    }
    if ct in _CT_MAP:
        return _CT_MAP[ct]
    # Fallback: image/* → png, application/* → pdf
    if ct.startswith('image/'):
        return 'png'
    return 'pdf'


# =========================================================================
# Dispatcher — route source_type to the right handler
# =========================================================================

SOURCE_HANDLERS = {
    'google_drive': fetch_google_drive,
    'dropbox':      fetch_dropbox,
    'onedrive':     fetch_onedrive,
    's3':           fetch_s3,
    'ftp':          fetch_ftp,
    'url_scrape':   fetch_urls,
}


def fetch_from_source(node, workflow, organization, user=None):
    """
    Generic dispatcher: read source_type from node.config and call the
    appropriate handler. Returns the standard result dict.
    """
    # Resolve saved credentials (if credential_id is present in node config)
    from clm.credential_resolver import resolve_credentials
    resolved_config = resolve_credentials(node.config or {}, user=user)
    # Temporarily patch node.config so handlers see the resolved secrets
    original_config = node.config
    node.config = resolved_config

    source_type = resolved_config.get('source_type', 'upload')
    handler = SOURCE_HANDLERS.get(source_type)
    if not handler:
        node.config = original_config
        return {'found': 0, 'skipped': 0, 'documents_created': [], 'errors': [
            f"Unknown source type: {source_type}"
        ]}
    try:
        result = handler(node, workflow, organization, user=user)
    finally:
        # Restore original config to avoid persisting resolved secrets
        node.config = original_config
    return result
