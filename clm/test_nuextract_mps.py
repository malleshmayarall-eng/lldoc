#!/usr/bin/env python3
"""
NuExtract MPS Experiment
=========================
Downloads numind/NuExtract-v1.5, loads on Apple MPS (GPU), and runs
a test extraction on a sample contract snippet.

Usage:
    source venv/bin/activate
    python clm/test_nuextract_mps.py
"""
import json
import time

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
MODEL_NAME = "numind/NuExtract-1.5-tiny"   # 0.5B params, ~1GB download
DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"

# ---------------------------------------------------------------------------
# Sample data
# ---------------------------------------------------------------------------
SAMPLE_CONTRACT = """
MASTER SERVICES AGREEMENT

This Master Services Agreement ("Agreement") is entered into as of January 15, 2025,
by and between Acme Corporation, a Delaware corporation with its principal offices
at 123 Innovation Drive, San Francisco, CA 94105 ("Client"), and TechServ Solutions LLC,
a New York limited liability company with offices at 456 Broadway, New York, NY 10013
("Provider").

WHEREAS, Client desires to engage Provider to perform certain technology consulting
and software development services;

1. TERM AND TERMINATION
   This Agreement shall commence on February 1, 2025 and shall continue for a period
   of twenty-four (24) months, unless earlier terminated in accordance with this Agreement.

2. COMPENSATION
   Client shall pay Provider a total contract value of $450,000 USD, payable in monthly
   installments of $18,750 over the term of this Agreement.

3. GOVERNING LAW
   This Agreement shall be governed by and construed in accordance with the laws of
   the State of California, without regard to conflict of laws principles.

4. CONFIDENTIALITY
   Both parties agree to maintain strict confidentiality of all proprietary information
   exchanged during the term of this Agreement. The confidentiality obligations shall
   survive termination for a period of three (3) years.

IN WITNESS WHEREOF, the parties have executed this Agreement as of the date first above written.

Acme Corporation                    TechServ Solutions LLC
By: John Smith, CEO                 By: Jane Doe, Managing Director
Date: January 15, 2025              Date: January 15, 2025
"""

EXTRACTION_TEMPLATE = {
    "contract_type": "",
    "effective_date": "",
    "client_name": "",
    "provider_name": "",
    "contract_value": "",
    "payment_terms": "",
    "duration_months": "",
    "governing_law": "",
    "confidentiality_period": "",
}

# ---------------------------------------------------------------------------
# NuExtract prompt format
# ---------------------------------------------------------------------------
def build_prompt(text: str, template: dict) -> str:
    """NuExtract v1.5 prompt format."""
    template_json = json.dumps(template, indent=4)
    return f"<|input|>\n### Template:\n{template_json}\n### Text:\n{text}\n\n<|output|>"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    print(f"🖥️  Device: {DEVICE}")
    print(f"📦  Model:  {MODEL_NAME}")
    print()

    # Load tokenizer
    print("⏳ Loading tokenizer...")
    t0 = time.time()
    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME, trust_remote_code=True)
    print(f"   ✅ Tokenizer loaded in {time.time() - t0:.1f}s")

    # Load model → MPS
    print(f"⏳ Loading model to {DEVICE}...")
    t0 = time.time()
    model = AutoModelForCausalLM.from_pretrained(
        MODEL_NAME,
        trust_remote_code=True,
        torch_dtype=torch.float16 if DEVICE == "mps" else torch.float32,
    )
    model = model.to(DEVICE)
    model.eval()
    print(f"   ✅ Model loaded in {time.time() - t0:.1f}s")
    print(f"   📊 Parameters: {sum(p.numel() for p in model.parameters()):,}")
    print()

    # Build prompt
    prompt = build_prompt(SAMPLE_CONTRACT, EXTRACTION_TEMPLATE)
    print(f"📝 Prompt length: {len(prompt)} chars")

    # Tokenize
    inputs = tokenizer(prompt, return_tensors="pt", truncation=True, max_length=8192)
    inputs = {k: v.to(DEVICE) for k, v in inputs.items()}
    print(f"   Token count: {inputs['input_ids'].shape[1]}")
    print()

    # Generate
    print("⏳ Running extraction...")
    t0 = time.time()
    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            max_new_tokens=500,
            do_sample=False,
            temperature=0.01,
        )
    gen_time = time.time() - t0

    # Decode only the generated part
    prompt_len = inputs["input_ids"].shape[1]
    generated_ids = outputs[0][prompt_len:]
    generated_text = tokenizer.decode(generated_ids, skip_special_tokens=True)

    print(f"   ✅ Generated in {gen_time:.2f}s ({len(generated_ids)} tokens)")
    print(f"   ⚡ Speed: {len(generated_ids) / gen_time:.1f} tokens/sec")
    print()

    # Parse
    print("=" * 60)
    print("RAW OUTPUT:")
    print("=" * 60)
    print(generated_text)
    print()

    try:
        # Try to parse as JSON
        import re
        json_match = re.search(r'\{[^{}]*\}', generated_text, re.DOTALL)
        if json_match:
            result = json.loads(json_match.group())
        else:
            result = json.loads(generated_text)

        print("=" * 60)
        print("PARSED EXTRACTION:")
        print("=" * 60)
        for field, value in result.items():
            status = "✅" if value and str(value).strip() else "❌"
            print(f"  {status} {field}: {value}")

        filled = sum(1 for v in result.values() if v and str(v).strip())
        total = len(result)
        print()
        print(f"📊 Fields filled: {filled}/{total} ({filled/total*100:.0f}%)")

    except json.JSONDecodeError as e:
        print(f"⚠️  JSON parse error: {e}")
        print("   Raw text was printed above — model may need prompt tuning")


if __name__ == "__main__":
    main()
