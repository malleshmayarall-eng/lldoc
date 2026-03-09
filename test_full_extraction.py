"""Test full NuExtract extraction on the actual scanned PDF"""
import os, sys, time, json, django
os.environ['DJANGO_SETTINGS_MODULE'] = 'drafter.settings'
django.setup()

from clm.ai_inference import (
    extract_text_from_file, extract_from_text,
    GLOBAL_CLM_TEMPLATE, _merge_templates, standardize_extracted_data,
    get_engine,
)

# 1. Extract text via OCR
pdf_path = 'media/clm/documents/2026/02/COGNOVIT_PROMISSORY_NOTE_OF_JOHN_D._OIL__GAS_COMPANY_INC.-12.pdf'
with open(pdf_path, 'rb') as f:
    text = extract_text_from_file(f, 'pdf')
print(f"Text extracted: {len(text)} chars")

# 2. Build a combined template (global + sample workflow fields)
workflow_template = {"principal_amount": "", "lender_name": ""}
combined = _merge_templates(GLOBAL_CLM_TEMPLATE, workflow_template)
print(f"Combined template: {len(combined)} fields")

# 3. Run NuExtract
print("\nLoading model...")
engine = get_engine()
t0 = time.time()
result = engine.extract(text, combined)
elapsed = time.time() - t0

print(f"\nExtraction completed in {elapsed:.1f}s")
print(f"Chunks processed: {result['chunks_processed']}")
print(f"Overall confidence: {result['overall_confidence']}")
print(f"Needs review: {result['needs_review']}")

print("\n=== EXTRACTED DATA (standardized) ===")
for field, value in sorted(result['extracted_data'].items()):
    conf = result['confidence'].get(field, 0)
    if value:
        print(f"  {field}: {repr(value)}  (conf: {conf})")
    else:
        print(f"  {field}: [empty]  (conf: {conf})")

# Also show raw vs standardized
print("\n=== RAW vs STANDARDIZED ===")
raw = result.get('raw_extracted_data', {})
std = result['extracted_data']
for f in sorted(raw.keys()):
    if raw[f] and raw[f] != std.get(f):
        print(f"  {f}: RAW={repr(raw[f])} -> STD={repr(std.get(f))}")
