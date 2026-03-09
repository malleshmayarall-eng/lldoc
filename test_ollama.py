#!/usr/bin/env python
"""Quick test: verify Ollama client works end-to-end."""
import os, sys
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'drafter.settings')

import django
django.setup()

from aiservices.ollama_client import OLLAMA_BASE_URL, OLLAMA_MODEL, is_ollama_available, call_ollama

print(f"OLLAMA_BASE_URL = {OLLAMA_BASE_URL}")
print(f"OLLAMA_MODEL    = {OLLAMA_MODEL}")
print(f"is_ollama_available() = {is_ollama_available()}")

if not is_ollama_available():
    print("FAIL: Ollama not reachable")
    sys.exit(1)

print("\n--- RAW Ollama API test ---")
import requests, json
raw_payload = {
    "model": OLLAMA_MODEL,
    "messages": [
        {"role": "system", "content": 'Return only JSON: {"summary":"hello"}'},
        {"role": "user", "content": "Say hello"},
    ],
    "stream": False,
    "format": "json",
    "options": {"temperature": 0.1, "num_predict": 256},
}
r = requests.post(f"{OLLAMA_BASE_URL}/api/chat", json=raw_payload, timeout=60)
print(f"HTTP {r.status_code}")
data = r.json()
print(f"Keys: {list(data.keys())}")
content = data.get("message", {}).get("content", "")
print(f"Raw content repr: {repr(content[:500])}")
print(f"Content: {content[:500]}")

print("\n--- call_ollama() test ---")
result = call_ollama(
    system_prompt='Return only a JSON object: {"summary": "Test successful"}. No other text.',
    user_prompt='Say hello',
    temperature=0.1,
    max_tokens=256,
    json_mode=True,
)
print(f"Result type: {type(result)}")
print(f"Result: {result}")
