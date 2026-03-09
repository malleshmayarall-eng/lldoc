import re

_PREAMBLE_DEFAULTS = {
    'font_size': '12pt',
    'font_family': 'Latin Modern Roman',
}

def _sanitize_preamble_placeholders(latex_code):
    latex_code = re.sub(
        r'(\\documentclass\[)\[\[([^\]]*)\]\](\]\{)',
        lambda m: m.group(1) + _PREAMBLE_DEFAULTS.get(
            m.group(2).rsplit('.', 1)[-1], '12pt'
        ) + m.group(3),
        latex_code,
    )
    latex_code = re.sub(
        r'(\\setmainfont\{)\[\[([^\]]*)\]\](\})',
        lambda m: m.group(1) + _PREAMBLE_DEFAULTS.get(
            m.group(2).rsplit('.', 1)[-1], 'Latin Modern Roman'
        ) + m.group(3),
        latex_code,
    )
    return latex_code

# Test cases
tests = [
    (r'\documentclass[[[processing_settings.pdf_layout.font_size]]]{article}',
     r'\documentclass[12pt]{article}'),
    (r'\setmainfont{[[processing_settings.pdf_layout.font_family]]}',
     r'\setmainfont{Latin Modern Roman}'),
    (r'\documentclass[12pt]{article}',
     r'\documentclass[12pt]{article}'),
    (r'\setmainfont{Times New Roman}',
     r'\setmainfont{Times New Roman}'),
    (r'Invoice for [[client_name]]',
     r'Invoice for [[client_name]]'),
]

for i, (inp, expected) in enumerate(tests):
    result = _sanitize_preamble_placeholders(inp)
    ok = '✅' if result == expected else '❌'
    print(f'{ok} Test {i+1}: {inp[:60]}...')
    if result != expected:
        print(f'   Expected: {expected}')
        print(f'   Got:      {result}')
