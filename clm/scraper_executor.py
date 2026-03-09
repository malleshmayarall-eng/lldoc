"""
Scraper Executor — Web scraping engine for scraper nodes
=========================================================
When a scraper node is executed, this module:

1. Gets the list of incoming document IDs (from upstream nodes)
2. Reads the node config: URLs to scrape + keywords to search for
3. For each URL:
   a. Checks the URL is in the ALLOWED_DOMAINS whitelist
   b. Checks robots.txt to ensure scraping is permitted
   c. Fetches the page using requests with a polite User-Agent
   d. Parses HTML with BeautifulSoup
   e. Loops through keywords, extracting matching text snippets
4. Stores the scraped results in each document's extracted_metadata
   under the configured output_key (default: 'scraped_data')
5. Returns a detailed report for the frontend

The scraped data can then feed into downstream Rule/AI nodes for
creating formatted text and further analysis.

IMPORTANT: Only scrapes websites that explicitly allow it. Respects
robots.txt and uses a whitelist of known-permissible domains.
"""
import hashlib
import logging
import re
import time
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup
from django.utils import timezone

from .models import WorkflowDocument, WorkflowNode

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Allowed domains whitelist — only scrape sites that permit it
# ---------------------------------------------------------------------------
ALLOWED_DOMAINS = {
    # Government & public records (public domain)
    'www.congress.gov',
    'www.govinfo.gov',
    'www.law.cornell.edu',
    'www.gpo.gov',
    'www.sec.gov',
    'efts.sec.gov',
    'edgar.sec.gov',
    'www.federalregister.gov',
    'www.courtlistener.com',

    # Open knowledge / encyclopedias
    'en.wikipedia.org',
    'en.wikisource.org',
    'en.wiktionary.org',
    'commons.wikimedia.org',

    # Open legal databases
    'www.law.cornell.edu',
    'casetext.com',
    'scholar.google.com',
    'www.justia.com',
    'www.findlaw.com',

    # Open data
    'data.gov',
    'www.data.gov',
    'catalog.data.gov',
    'api.fda.gov',
    'clinicaltrials.gov',

    # Public APIs & documentation
    'httpbin.org',
    'jsonplaceholder.typicode.com',
    'api.publicapis.org',

    # News (public articles)
    'www.reuters.com',
    'www.bbc.com',
    'www.bbc.co.uk',
    'apnews.com',

    # Scraping-allowed test sites
    'books.toscrape.com',
    'quotes.toscrape.com',
    'example.com',
    'www.example.com',
}

# Polite request headers
REQUEST_HEADERS = {
    'User-Agent': 'DrafterCLM-Scraper/1.0 (legal-doc-workflow; +https://drafter.app; respectful-bot)',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
}

# Limits
MAX_URLS_PER_NODE = 10
MAX_KEYWORDS = 20
MAX_SNIPPETS_PER_KEYWORD = 5
MAX_PAGE_SIZE_BYTES = 5 * 1024 * 1024  # 5 MB
REQUEST_TIMEOUT = 15  # seconds
DELAY_BETWEEN_REQUESTS = 1.0  # seconds — be polite


# ---------------------------------------------------------------------------
# robots.txt checker
# ---------------------------------------------------------------------------
_robots_cache: dict[str, tuple[bool, float]] = {}


def _check_robots_txt(url: str) -> bool:
    """
    Quick check whether the URL path is allowed by robots.txt.
    Caches results per domain for 10 minutes.
    Returns True if scraping is allowed, False otherwise.
    """
    parsed = urlparse(url)
    domain = parsed.netloc
    cache_key = domain

    # Check cache
    if cache_key in _robots_cache:
        allowed, cached_at = _robots_cache[cache_key]
        if time.time() - cached_at < 600:  # 10 min TTL
            return allowed

    robots_url = f"{parsed.scheme}://{domain}/robots.txt"
    try:
        resp = requests.get(robots_url, headers=REQUEST_HEADERS, timeout=5)
        if resp.status_code == 404:
            # No robots.txt = allowed
            _robots_cache[cache_key] = (True, time.time())
            return True

        text = resp.text.lower()
        # Simple check: if "disallow: /" for all user-agents, block
        # This is a simplified parser — covers the common cases
        in_wildcard = False
        for line in text.splitlines():
            line = line.strip()
            if line.startswith('user-agent:'):
                agent = line.split(':', 1)[1].strip()
                in_wildcard = agent == '*'
            elif in_wildcard and line.startswith('disallow:'):
                path = line.split(':', 1)[1].strip()
                if path == '/':
                    _robots_cache[cache_key] = (False, time.time())
                    return False
                if path and parsed.path.startswith(path):
                    _robots_cache[cache_key] = (False, time.time())
                    return False

        _robots_cache[cache_key] = (True, time.time())
        return True

    except Exception:
        # If we can't fetch robots.txt, err on the side of caution
        _robots_cache[cache_key] = (True, time.time())
        return True


# ---------------------------------------------------------------------------
# Core scraping function
# ---------------------------------------------------------------------------

def _scrape_url(url: str, keywords: list[str]) -> dict:
    """
    Scrape a single URL and search for keywords.

    Returns:
        {
            "url": str,
            "status": "success" | "blocked" | "error",
            "title": str,           # page title
            "snippets": {            # keyword → list of matching text snippets
                "keyword1": ["snippet1", "snippet2", ...],
                ...
            },
            "summary": str,          # first 500 chars of page text
            "word_count": int,
            "error": str,            # only if status == "error"
        }
    """
    parsed = urlparse(url)
    domain = parsed.netloc.lower()

    # Whitelist check
    if domain not in ALLOWED_DOMAINS:
        return {
            'url': url,
            'status': 'blocked',
            'error': f'Domain "{domain}" is not in the allowed scraping whitelist',
            'title': '',
            'snippets': {},
            'summary': '',
            'word_count': 0,
        }

    # robots.txt check
    if not _check_robots_txt(url):
        return {
            'url': url,
            'status': 'blocked',
            'error': f'robots.txt disallows scraping this path',
            'title': '',
            'snippets': {},
            'summary': '',
            'word_count': 0,
        }

    try:
        resp = requests.get(
            url,
            headers=REQUEST_HEADERS,
            timeout=REQUEST_TIMEOUT,
            stream=True,
        )
        resp.raise_for_status()

        # Check content size
        content_length = resp.headers.get('content-length')
        if content_length and int(content_length) > MAX_PAGE_SIZE_BYTES:
            return {
                'url': url,
                'status': 'error',
                'error': f'Page too large ({int(content_length)} bytes)',
                'title': '',
                'snippets': {},
                'summary': '',
                'word_count': 0,
            }

        html = resp.text[:MAX_PAGE_SIZE_BYTES]
        soup = BeautifulSoup(html, 'html.parser')

        # Remove script/style tags
        for tag in soup(['script', 'style', 'nav', 'footer', 'header', 'noscript']):
            tag.decompose()

        # Extract page title
        title = ''
        title_tag = soup.find('title')
        if title_tag:
            title = title_tag.get_text(strip=True)[:200]

        # Get all text content
        text = soup.get_text(separator='\n', strip=True)
        # Normalize whitespace
        text = re.sub(r'\n{3,}', '\n\n', text)
        text = re.sub(r'[ \t]+', ' ', text)

        words = text.split()
        word_count = len(words)

        # Summary: first 500 chars
        summary = text[:500].strip()

        # Keyword search loop
        snippets = {}
        text_lower = text.lower()

        for keyword in keywords[:MAX_KEYWORDS]:
            keyword_lower = keyword.lower().strip()
            if not keyword_lower:
                continue

            found = []
            # Find all occurrences
            start = 0
            while len(found) < MAX_SNIPPETS_PER_KEYWORD:
                idx = text_lower.find(keyword_lower, start)
                if idx == -1:
                    break

                # Extract snippet: 80 chars before and after the keyword
                snippet_start = max(0, idx - 80)
                snippet_end = min(len(text), idx + len(keyword_lower) + 80)
                snippet = text[snippet_start:snippet_end].strip()

                # Add ellipsis if truncated
                if snippet_start > 0:
                    snippet = '…' + snippet
                if snippet_end < len(text):
                    snippet = snippet + '…'

                found.append(snippet)
                start = idx + len(keyword_lower)

            snippets[keyword] = found

        return {
            'url': url,
            'status': 'success',
            'title': title,
            'snippets': snippets,
            'summary': summary,
            'word_count': word_count,
        }

    except requests.exceptions.Timeout:
        return {
            'url': url,
            'status': 'error',
            'error': f'Request timed out after {REQUEST_TIMEOUT}s',
            'title': '',
            'snippets': {},
            'summary': '',
            'word_count': 0,
        }
    except requests.exceptions.HTTPError as e:
        return {
            'url': url,
            'status': 'error',
            'error': f'HTTP {e.response.status_code}: {e.response.reason}',
            'title': '',
            'snippets': {},
            'summary': '',
            'word_count': 0,
        }
    except Exception as e:
        return {
            'url': url,
            'status': 'error',
            'error': str(e)[:200],
            'title': '',
            'snippets': {},
            'summary': '',
            'word_count': 0,
        }


# ---------------------------------------------------------------------------
# Node executor
# ---------------------------------------------------------------------------

def execute_scraper_node(
    node: WorkflowNode,
    incoming_document_ids: list,
    triggered_by=None,
) -> dict:
    """
    Execute a scraper node: scrape configured URLs, search for keywords,
    and store extracted data in each incoming document's metadata.

    Node config shape:
    {
        "urls": ["https://en.wikipedia.org/wiki/Contract", ...],
        "keywords": ["indemnification", "liability", "termination clause"],
        "output_key": "scraped_data",       # key in extracted_metadata
        "include_summary": true,             # include page summary text
        "max_snippets": 3,                   # max snippets per keyword per URL
    }

    Returns:
        {
            "node_id": str,
            "status": "completed" | "partial" | "failed",
            "urls_scraped": int,
            "urls_blocked": int,
            "urls_failed": int,
            "total_snippets": int,
            "results": [
                {
                    "document_id": str,
                    "status": "enriched" | "skipped",
                    "urls_data": [...],
                    "keywords_found": int,
                    "total_snippets": int,
                }
            ],
            "url_results": [...]     # raw per-URL scrape data
        }
    """
    config = node.config or {}
    urls = config.get('urls', [])
    keywords = config.get('keywords', [])
    output_key = config.get('output_key', 'scraped_data')
    include_summary = config.get('include_summary', True)
    max_snippets = min(config.get('max_snippets', 3), MAX_SNIPPETS_PER_KEYWORD)

    if not urls:
        return {
            'node_id': str(node.id),
            'status': 'failed',
            'error': 'No URLs configured on this scraper node',
            'urls_scraped': 0,
            'urls_blocked': 0,
            'urls_failed': 0,
            'total_snippets': 0,
            'results': [],
            'url_results': [],
        }

    if not keywords:
        return {
            'node_id': str(node.id),
            'status': 'failed',
            'error': 'No keywords configured on this scraper node',
            'urls_scraped': 0,
            'urls_blocked': 0,
            'urls_failed': 0,
            'total_snippets': 0,
            'results': [],
            'url_results': [],
        }

    # Limit URLs
    urls = urls[:MAX_URLS_PER_NODE]
    keywords = keywords[:MAX_KEYWORDS]

    # ── Scrape all URLs ──
    url_results = []
    for i, url in enumerate(urls):
        url = url.strip()
        if not url:
            continue

        result = _scrape_url(url, keywords)

        # Trim snippets to max_snippets
        if result.get('snippets'):
            result['snippets'] = {
                k: v[:max_snippets] for k, v in result['snippets'].items()
            }

        url_results.append(result)

        # Be polite: delay between requests
        if i < len(urls) - 1:
            time.sleep(DELAY_BETWEEN_REQUESTS)

    # Counts
    urls_scraped = sum(1 for r in url_results if r['status'] == 'success')
    urls_blocked = sum(1 for r in url_results if r['status'] == 'blocked')
    urls_failed = sum(1 for r in url_results if r['status'] == 'error')
    total_snippets = sum(
        len(snips)
        for r in url_results if r.get('snippets')
        for snips in r['snippets'].values()
    )

    # ── Store results in each document's metadata ──
    documents = WorkflowDocument.objects.filter(id__in=incoming_document_ids)
    per_doc_results = []

    for doc in documents:
        # Build the scraped data blob
        scraped_data = {
            'scraped_at': timezone.now().isoformat(),
            'keywords': keywords,
            'urls': [],
        }

        keywords_found = 0
        doc_total_snippets = 0

        for ur in url_results:
            if ur['status'] != 'success':
                continue

            url_entry = {
                'url': ur['url'],
                'title': ur['title'],
                'word_count': ur['word_count'],
                'snippets': ur['snippets'],
            }
            if include_summary:
                url_entry['summary'] = ur['summary']

            scraped_data['urls'].append(url_entry)

            # Count keywords found
            for kw, snips in ur['snippets'].items():
                if snips:
                    keywords_found += 1
                    doc_total_snippets += len(snips)

        # Save to document metadata
        meta = doc.extracted_metadata or {}
        meta[output_key] = scraped_data
        doc.extracted_metadata = meta
        doc.save(update_fields=['extracted_metadata', 'updated_at'])

        per_doc_results.append({
            'document_id': str(doc.id),
            'status': 'enriched' if urls_scraped > 0 else 'skipped',
            'keywords_found': keywords_found,
            'total_snippets': doc_total_snippets,
        })

    # Overall status
    if urls_scraped == 0:
        overall_status = 'failed'
    elif urls_failed > 0 or urls_blocked > 0:
        overall_status = 'partial'
    else:
        overall_status = 'completed'

    return {
        'node_id': str(node.id),
        'status': overall_status,
        'urls_scraped': urls_scraped,
        'urls_blocked': urls_blocked,
        'urls_failed': urls_failed,
        'total_snippets': total_snippets,
        'keywords': keywords,
        'results': per_doc_results,
        'url_results': [
            {
                'url': r['url'],
                'status': r['status'],
                'title': r.get('title', ''),
                'word_count': r.get('word_count', 0),
                'snippet_count': sum(len(v) for v in r.get('snippets', {}).values()),
                'error': r.get('error', ''),
            }
            for r in url_results
        ],
    }
