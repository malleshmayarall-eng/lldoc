"""
Procurement document template definitions — quick-latex content with
``[[placeholder]]`` metadata keys.

Each template is a dict consumed by the ``seed_procurement`` management
command to create a ``Document(document_mode='quick_latex')`` record.
"""

DOCUMENT_TEMPLATES = [
    # ── 1. Purchase Order ────────────────────────────────────────────
    {
        'key': 'procurement_purchase_order',
        'title': 'Purchase Order',
        'document_type': 'purchase_order',
        'category': 'purchase_order',
        'description': 'Standard purchase order template with line items table',
        'metadata_defaults': {
            'po_number': '',
            'vendor_name': '',
            'vendor_address': '',
            'buyer_name': '',
            'buyer_company': '',
            'buyer_address': '',
            'order_date': '',
            'delivery_date': '',
            'payment_terms': 'Net 30',
            'shipping_method': '',
            'total_amount': '',
            'currency': 'USD',
        },
        'latex_code': r"""
\documentclass[11pt,a4paper]{article}
\usepackage[margin=1in]{geometry}
\usepackage{booktabs,tabularx,graphicx,xcolor,fancyhdr}
\definecolor{accent}{HTML}{2563EB}
\pagestyle{fancy}
\fancyhf{}
\rfoot{\thepage}
\renewcommand{\headrulewidth}{0pt}

\begin{document}

\begin{center}
{\color{accent}\LARGE\bfseries PURCHASE ORDER}\\[6pt]
{\large PO \# [[po_number]]}
\end{center}

\vspace{12pt}

\noindent
\begin{minipage}[t]{0.48\textwidth}
\textbf{From (Buyer)}\\
[[buyer_company]]\\
[[buyer_address]]\\
Contact: [[buyer_name]]
\end{minipage}
\hfill
\begin{minipage}[t]{0.48\textwidth}
\textbf{To (Vendor)}\\
[[vendor_name]]\\
[[vendor_address]]
\end{minipage}

\vspace{16pt}

\noindent
\begin{tabularx}{\textwidth}{@{}XX@{}}
\textbf{Order Date:} [[order_date]] & \textbf{Delivery Date:} [[delivery_date]] \\
\textbf{Payment Terms:} [[payment_terms]] & \textbf{Shipping:} [[shipping_method]] \\
\end{tabularx}

\vspace{16pt}

\begin{center}
\begin{tabularx}{\textwidth}{@{}l X r r r@{}}
\toprule
\textbf{\#} & \textbf{Description} & \textbf{Qty} & \textbf{Unit Price} & \textbf{Amount} \\
\midrule
1 & Item description & 0 & 0.00 & 0.00 \\
2 & Item description & 0 & 0.00 & 0.00 \\
3 & Item description & 0 & 0.00 & 0.00 \\
\midrule
 & & & \textbf{Total ([[currency]]):} & \textbf{[[total_amount]]} \\
\bottomrule
\end{tabularx}
\end{center}

\vspace{24pt}

\noindent\textbf{Terms \& Conditions}\\
Standard purchase terms apply. Goods must conform to specifications.
Vendor shall deliver by the delivery date above. Late delivery may
incur penalties as per the master agreement.

\vspace{32pt}

\noindent
\begin{minipage}[t]{0.45\textwidth}
\rule{5cm}{0.4pt}\\
\textbf{Authorised Buyer}\\
Date: \rule{3cm}{0.4pt}
\end{minipage}
\hfill
\begin{minipage}[t]{0.45\textwidth}
\rule{5cm}{0.4pt}\\
\textbf{Vendor Acknowledgement}\\
Date: \rule{3cm}{0.4pt}
\end{minipage}

\end{document}
""",
    },

    # ── 2. Request for Proposal ──────────────────────────────────────
    {
        'key': 'procurement_rfp',
        'title': 'Request for Proposal',
        'document_type': 'rfp',
        'category': 'rfp',
        'description': 'Formal RFP template with scope, evaluation criteria, and submission guidelines',
        'metadata_defaults': {
            'rfp_number': '',
            'rfp_title': '',
            'issuing_organization': '',
            'contact_name': '',
            'contact_email': '',
            'issue_date': '',
            'submission_deadline': '',
            'project_budget': '',
            'currency': 'USD',
        },
        'latex_code': r"""
\documentclass[11pt,a4paper]{article}
\usepackage[margin=1in]{geometry}
\usepackage{booktabs,tabularx,enumitem,xcolor,hyperref,fancyhdr}
\definecolor{accent}{HTML}{7C3AED}
\pagestyle{fancy}
\fancyhf{}
\rfoot{\thepage}
\renewcommand{\headrulewidth}{0pt}

\begin{document}

\begin{center}
{\color{accent}\LARGE\bfseries REQUEST FOR PROPOSAL}\\[6pt]
{\large RFP \# [[rfp_number]]}\\[4pt]
{\large [[rfp_title]]}
\end{center}

\vspace{8pt}
\noindent\textbf{Issued by:} [[issuing_organization]]\\
\textbf{Contact:} [[contact_name]] — \href{mailto:[[contact_email]]}{[[contact_email]]}\\
\textbf{Issue Date:} [[issue_date]] \hfill \textbf{Deadline:} [[submission_deadline]]

\vspace{16pt}
\section*{1 \quad Introduction}
[[issuing_organization]] is seeking proposals from qualified vendors for
the scope described below. This RFP outlines the requirements,
evaluation criteria, and submission guidelines.

\section*{2 \quad Scope of Work}
\begin{itemize}[leftmargin=1.5em]
  \item Describe the goods or services required.
  \item Specify quantities, quality standards, and delivery timelines.
  \item Note any regulatory or compliance requirements.
\end{itemize}

\section*{3 \quad Budget}
The estimated project budget is \textbf{[[currency]] [[project_budget]]}.
Proposals exceeding this range may be considered if justified.

\section*{4 \quad Evaluation Criteria}
\begin{tabularx}{\textwidth}{@{}Xr@{}}
\toprule
\textbf{Criterion} & \textbf{Weight} \\
\midrule
Technical capability & 30\% \\
Pricing & 25\% \\
Experience \& references & 20\% \\
Delivery timeline & 15\% \\
Compliance \& certifications & 10\% \\
\bottomrule
\end{tabularx}

\section*{5 \quad Submission Guidelines}
\begin{enumerate}[leftmargin=1.5em]
  \item Proposals must be submitted by \textbf{[[submission_deadline]]}.
  \item Email submissions to \href{mailto:[[contact_email]]}{[[contact_email]]}.
  \item Include company profile, proposed approach, pricing, and references.
\end{enumerate}

\section*{6 \quad Terms}
This RFP does not commit [[issuing_organization]] to award a contract.
The organisation reserves the right to reject any or all proposals.

\end{document}
""",
    },

    # ── 3. Vendor Agreement ──────────────────────────────────────────
    {
        'key': 'procurement_vendor_agreement',
        'title': 'Vendor Agreement',
        'document_type': 'vendor_agreement',
        'category': 'vendor_agreement',
        'description': 'Master vendor supply / service agreement template',
        'metadata_defaults': {
            'agreement_number': '',
            'vendor_name': '',
            'vendor_address': '',
            'buyer_company': '',
            'buyer_address': '',
            'effective_date': '',
            'termination_date': '',
            'governing_law': '',
        },
        'latex_code': r"""
\documentclass[11pt,a4paper]{article}
\usepackage[margin=1in]{geometry}
\usepackage{enumitem,xcolor,fancyhdr}
\definecolor{accent}{HTML}{059669}
\pagestyle{fancy}
\fancyhf{}
\rfoot{\thepage}
\renewcommand{\headrulewidth}{0pt}

\begin{document}

\begin{center}
{\color{accent}\LARGE\bfseries VENDOR AGREEMENT}\\[6pt]
{\large Agreement \# [[agreement_number]]}
\end{center}

\vspace{12pt}

\noindent This Vendor Agreement (``Agreement'') is entered into as of
\textbf{[[effective_date]]} by and between:

\vspace{8pt}
\noindent\textbf{Buyer:} [[buyer_company]], [[buyer_address]]\\
\textbf{Vendor:} [[vendor_name]], [[vendor_address]]

\section*{1 \quad Scope of Services}
Vendor shall provide the goods and/or services as described in each
Purchase Order issued under this Agreement. Each PO, once accepted,
forms a binding contract under the terms herein.

\section*{2 \quad Term}
This Agreement is effective from \textbf{[[effective_date]]} through
\textbf{[[termination_date]]}, unless terminated earlier per Section~7.

\section*{3 \quad Pricing \& Payment}
\begin{itemize}[leftmargin=1.5em]
  \item Prices shall be as stated in individual Purchase Orders.
  \item Payment terms: Net 30 from receipt of valid invoice.
  \item Late payments accrue interest at 1.5\% per month.
\end{itemize}

\section*{4 \quad Quality \& Compliance}
Vendor warrants that all goods/services conform to specifications,
applicable laws, and industry standards.

\section*{5 \quad Confidentiality}
Each party shall keep confidential information of the other party
confidential and not disclose it to third parties.

\section*{6 \quad Indemnification}
Vendor shall indemnify Buyer against claims arising from Vendor's
negligence, breach, or non-compliance.

\section*{7 \quad Termination}
Either party may terminate with 30 days' written notice. Buyer may
terminate immediately for cause.

\section*{8 \quad Governing Law}
This Agreement is governed by the laws of \textbf{[[governing_law]]}.

\vspace{32pt}
\noindent
\begin{minipage}[t]{0.45\textwidth}
\rule{5cm}{0.4pt}\\
\textbf{Buyer — [[buyer_company]]}\\
Date: \rule{3cm}{0.4pt}
\end{minipage}
\hfill
\begin{minipage}[t]{0.45\textwidth}
\rule{5cm}{0.4pt}\\
\textbf{Vendor — [[vendor_name]]}\\
Date: \rule{3cm}{0.4pt}
\end{minipage}

\end{document}
""",
    },

    # ── 4. Statement of Work ─────────────────────────────────────────
    {
        'key': 'procurement_sow',
        'title': 'Statement of Work',
        'document_type': 'sow',
        'category': 'sow',
        'description': 'SOW template with deliverables, milestones, and acceptance criteria',
        'metadata_defaults': {
            'sow_number': '',
            'project_name': '',
            'vendor_name': '',
            'buyer_company': '',
            'start_date': '',
            'end_date': '',
            'project_manager': '',
            'total_value': '',
            'currency': 'USD',
        },
        'latex_code': r"""
\documentclass[11pt,a4paper]{article}
\usepackage[margin=1in]{geometry}
\usepackage{booktabs,tabularx,enumitem,xcolor,fancyhdr}
\definecolor{accent}{HTML}{D97706}
\pagestyle{fancy}
\fancyhf{}
\rfoot{\thepage}
\renewcommand{\headrulewidth}{0pt}

\begin{document}

\begin{center}
{\color{accent}\LARGE\bfseries STATEMENT OF WORK}\\[6pt]
{\large SOW \# [[sow_number]]}\\[4pt]
{\large [[project_name]]}
\end{center}

\vspace{8pt}
\noindent\textbf{Vendor:} [[vendor_name]] \hfill \textbf{Buyer:} [[buyer_company]]\\
\textbf{Project Manager:} [[project_manager]]\\
\textbf{Period:} [[start_date]] — [[end_date]] \hfill
\textbf{Value:} [[currency]] [[total_value]]

\section*{1 \quad Objective}
Describe the business objective and expected outcomes of this engagement.

\section*{2 \quad Scope}
\begin{itemize}[leftmargin=1.5em]
  \item Define in-scope activities.
  \item Explicitly list out-of-scope items.
\end{itemize}

\section*{3 \quad Deliverables \& Milestones}
\begin{tabularx}{\textwidth}{@{}l X r l@{}}
\toprule
\textbf{\#} & \textbf{Deliverable} & \textbf{Due Date} & \textbf{Status} \\
\midrule
1 & Project kickoff & [[start_date]] & Pending \\
2 & First deliverable & & Pending \\
3 & Final deliverable & [[end_date]] & Pending \\
\bottomrule
\end{tabularx}

\section*{4 \quad Acceptance Criteria}
Each deliverable will be reviewed within 5 business days. Acceptance
requires written sign-off from [[project_manager]].

\section*{5 \quad Assumptions \& Dependencies}
\begin{itemize}[leftmargin=1.5em]
  \item Buyer will provide timely access to systems and stakeholders.
  \item Vendor will staff appropriately to meet milestones.
\end{itemize}

\section*{6 \quad Payment Schedule}
Payment tied to milestone completion. Invoices submitted after
acceptance sign-off.

\vspace{32pt}
\noindent
\begin{minipage}[t]{0.45\textwidth}
\rule{5cm}{0.4pt}\\
\textbf{Buyer}\\
Date: \rule{3cm}{0.4pt}
\end{minipage}
\hfill
\begin{minipage}[t]{0.45\textwidth}
\rule{5cm}{0.4pt}\\
\textbf{Vendor}\\
Date: \rule{3cm}{0.4pt}
\end{minipage}

\end{document}
""",
    },

    # ── 5. Non-Disclosure Agreement ──────────────────────────────────
    {
        'key': 'procurement_nda',
        'title': 'Non-Disclosure Agreement',
        'document_type': 'nda',
        'category': 'nda',
        'description': 'Mutual NDA template for vendor engagements',
        'metadata_defaults': {
            'nda_number': '',
            'party_a_name': '',
            'party_a_address': '',
            'party_b_name': '',
            'party_b_address': '',
            'effective_date': '',
            'duration_years': '2',
            'governing_law': '',
        },
        'latex_code': r"""
\documentclass[11pt,a4paper]{article}
\usepackage[margin=1in]{geometry}
\usepackage{enumitem,xcolor,fancyhdr}
\definecolor{accent}{HTML}{0891B2}
\pagestyle{fancy}
\fancyhf{}
\rfoot{\thepage}
\renewcommand{\headrulewidth}{0pt}

\begin{document}

\begin{center}
{\color{accent}\LARGE\bfseries MUTUAL NON-DISCLOSURE AGREEMENT}\\[6pt]
{\large NDA \# [[nda_number]]}
\end{center}

\vspace{12pt}
\noindent This Mutual Non-Disclosure Agreement is entered into as of
\textbf{[[effective_date]]} between:

\vspace{8pt}
\noindent\textbf{Party A:} [[party_a_name]], [[party_a_address]]\\
\textbf{Party B:} [[party_b_name]], [[party_b_address]]

\section*{1 \quad Purpose}
The parties wish to explore a potential business relationship and may
need to share confidential information.

\section*{2 \quad Definition of Confidential Information}
Any non-public technical, business, or financial information disclosed
by either party, whether in writing, orally, or by inspection.

\section*{3 \quad Obligations}
\begin{enumerate}[leftmargin=1.5em]
  \item Use confidential information solely for the stated purpose.
  \item Restrict access to personnel with a need to know.
  \item Not disclose to third parties without prior written consent.
  \item Apply the same degree of care as for own confidential information.
\end{enumerate}

\section*{4 \quad Exclusions}
Information is not confidential if it: (a) is publicly available,
(b) was known before disclosure, (c) is independently developed, or
(d) is required to be disclosed by law.

\section*{5 \quad Term}
This NDA remains in effect for \textbf{[[duration_years]] years} from
the effective date.

\section*{6 \quad Governing Law}
Governed by the laws of \textbf{[[governing_law]]}.

\vspace{32pt}
\noindent
\begin{minipage}[t]{0.45\textwidth}
\rule{5cm}{0.4pt}\\
\textbf{[[party_a_name]]}\\
Date: \rule{3cm}{0.4pt}
\end{minipage}
\hfill
\begin{minipage}[t]{0.45\textwidth}
\rule{5cm}{0.4pt}\\
\textbf{[[party_b_name]]}\\
Date: \rule{3cm}{0.4pt}
\end{minipage}

\end{document}
""",
    },

    # ── 6. Bid Evaluation Scorecard ──────────────────────────────────
    {
        'key': 'procurement_bid_evaluation',
        'title': 'Bid Evaluation Scorecard',
        'document_type': 'bid_evaluation',
        'category': 'bid_evaluation',
        'description': 'Vendor bid comparison and scoring matrix',
        'metadata_defaults': {
            'evaluation_number': '',
            'rfp_reference': '',
            'evaluator_name': '',
            'evaluation_date': '',
            'vendor_1': '',
            'vendor_2': '',
            'vendor_3': '',
        },
        'latex_code': r"""
\documentclass[11pt,a4paper]{article}
\usepackage[margin=0.8in]{geometry}
\usepackage{booktabs,tabularx,xcolor,fancyhdr}
\definecolor{accent}{HTML}{DC2626}
\pagestyle{fancy}
\fancyhf{}
\rfoot{\thepage}
\renewcommand{\headrulewidth}{0pt}

\begin{document}

\begin{center}
{\color{accent}\LARGE\bfseries BID EVALUATION SCORECARD}\\[6pt]
{\large Ref: [[rfp_reference]] \quad Eval \# [[evaluation_number]]}
\end{center}

\vspace{8pt}
\noindent\textbf{Evaluator:} [[evaluator_name]] \hfill
\textbf{Date:} [[evaluation_date]]

\vspace{16pt}

\begin{center}
\begin{tabularx}{\textwidth}{@{}X r r r r@{}}
\toprule
\textbf{Criterion (Weight)} & \textbf{Max} & \textbf{[[vendor_1]]} & \textbf{[[vendor_2]]} & \textbf{[[vendor_3]]} \\
\midrule
Technical capability (30\%) & 30 & & & \\
Pricing competitiveness (25\%) & 25 & & & \\
Experience \& references (20\%) & 20 & & & \\
Delivery timeline (15\%) & 15 & & & \\
Compliance \& certs (10\%) & 10 & & & \\
\midrule
\textbf{Total} & \textbf{100} & & & \\
\bottomrule
\end{tabularx}
\end{center}

\vspace{16pt}
\section*{Notes}
Add qualitative observations, risk factors, and recommendation.

\vspace{16pt}
\section*{Recommendation}
Based on the evaluation above, the recommended vendor is: \rule{5cm}{0.4pt}

\vspace{32pt}
\noindent
\rule{5cm}{0.4pt}\\
\textbf{Evaluator Signature}\\
Date: \rule{3cm}{0.4pt}

\end{document}
""",
    },

    # ── 7. Contract Amendment ────────────────────────────────────────
    {
        'key': 'procurement_amendment',
        'title': 'Contract Amendment',
        'document_type': 'amendment',
        'category': 'amendment',
        'description': 'Amendment to an existing procurement contract',
        'metadata_defaults': {
            'amendment_number': '',
            'original_contract_number': '',
            'vendor_name': '',
            'buyer_company': '',
            'amendment_date': '',
            'description_of_changes': '',
        },
        'latex_code': r"""
\documentclass[11pt,a4paper]{article}
\usepackage[margin=1in]{geometry}
\usepackage{enumitem,xcolor,fancyhdr}
\definecolor{accent}{HTML}{9333EA}
\pagestyle{fancy}
\fancyhf{}
\rfoot{\thepage}
\renewcommand{\headrulewidth}{0pt}

\begin{document}

\begin{center}
{\color{accent}\LARGE\bfseries CONTRACT AMENDMENT}\\[6pt]
{\large Amendment \# [[amendment_number]]}\\[4pt]
{\large to Contract \# [[original_contract_number]]}
\end{center}

\vspace{12pt}

\noindent This Amendment is entered into as of \textbf{[[amendment_date]]}
between \textbf{[[buyer_company]]} (Buyer) and \textbf{[[vendor_name]]}
(Vendor) to modify the original contract referenced above.

\section*{1 \quad Description of Changes}
[[description_of_changes]]

\section*{2 \quad Effect on Original Contract}
All other terms and conditions of the original contract remain in full
force and effect. In case of conflict between this Amendment and the
original contract, this Amendment shall prevail.

\section*{3 \quad Effective Date}
This Amendment becomes effective on \textbf{[[amendment_date]]}.

\vspace{32pt}
\noindent
\begin{minipage}[t]{0.45\textwidth}
\rule{5cm}{0.4pt}\\
\textbf{Buyer — [[buyer_company]]}\\
Date: \rule{3cm}{0.4pt}
\end{minipage}
\hfill
\begin{minipage}[t]{0.45\textwidth}
\rule{5cm}{0.4pt}\\
\textbf{Vendor — [[vendor_name]]}\\
Date: \rule{3cm}{0.4pt}
\end{minipage}

\end{document}
""",
    },

    # ── 8. Request for Quotation ─────────────────────────────────────
    {
        'key': 'procurement_rfq',
        'title': 'Request for Quotation',
        'document_type': 'rfq',
        'category': 'rfq',
        'description': 'Lightweight price-focused quotation request',
        'metadata_defaults': {
            'rfq_number': '',
            'buyer_company': '',
            'contact_name': '',
            'contact_email': '',
            'issue_date': '',
            'response_deadline': '',
            'delivery_location': '',
        },
        'latex_code': r"""
\documentclass[11pt,a4paper]{article}
\usepackage[margin=1in]{geometry}
\usepackage{booktabs,tabularx,xcolor,hyperref,fancyhdr}
\definecolor{accent}{HTML}{0284C7}
\pagestyle{fancy}
\fancyhf{}
\rfoot{\thepage}
\renewcommand{\headrulewidth}{0pt}

\begin{document}

\begin{center}
{\color{accent}\LARGE\bfseries REQUEST FOR QUOTATION}\\[6pt]
{\large RFQ \# [[rfq_number]]}
\end{center}

\vspace{8pt}
\noindent\textbf{From:} [[buyer_company]]\\
\textbf{Contact:} [[contact_name]] — \href{mailto:[[contact_email]]}{[[contact_email]]}\\
\textbf{Issue Date:} [[issue_date]] \hfill \textbf{Respond By:} [[response_deadline]]\\
\textbf{Delivery Location:} [[delivery_location]]

\section*{Items Requested}
\begin{tabularx}{\textwidth}{@{}l X r l@{}}
\toprule
\textbf{\#} & \textbf{Description} & \textbf{Qty} & \textbf{Unit} \\
\midrule
1 & Item description & 0 & Each \\
2 & Item description & 0 & Each \\
3 & Item description & 0 & Each \\
\bottomrule
\end{tabularx}

\section*{Instructions}
\begin{itemize}
  \item Provide unit price and total for each line item.
  \item Include lead time and delivery schedule.
  \item State validity period of quotation.
  \item Submit to \href{mailto:[[contact_email]]}{[[contact_email]]} by
        \textbf{[[response_deadline]]}.
\end{itemize}

\end{document}
""",
    },

    # ── 9. Goods Receipt Note ────────────────────────────────────────
    {
        'key': 'procurement_goods_receipt',
        'title': 'Goods Receipt Note',
        'document_type': 'goods_receipt',
        'category': 'goods_receipt',
        'description': 'Confirmation of goods delivered and inspected',
        'metadata_defaults': {
            'grn_number': '',
            'po_reference': '',
            'vendor_name': '',
            'receiver_name': '',
            'receipt_date': '',
            'warehouse_location': '',
        },
        'latex_code': r"""
\documentclass[11pt,a4paper]{article}
\usepackage[margin=1in]{geometry}
\usepackage{booktabs,tabularx,xcolor,fancyhdr}
\definecolor{accent}{HTML}{16A34A}
\pagestyle{fancy}
\fancyhf{}
\rfoot{\thepage}
\renewcommand{\headrulewidth}{0pt}

\begin{document}

\begin{center}
{\color{accent}\LARGE\bfseries GOODS RECEIPT NOTE}\\[6pt]
{\large GRN \# [[grn_number]]}
\end{center}

\vspace{8pt}
\noindent\textbf{PO Reference:} [[po_reference]] \hfill
\textbf{Date:} [[receipt_date]]\\
\textbf{Vendor:} [[vendor_name]] \hfill
\textbf{Location:} [[warehouse_location]]\\
\textbf{Received by:} [[receiver_name]]

\vspace{16pt}

\begin{tabularx}{\textwidth}{@{}l X r r l@{}}
\toprule
\textbf{\#} & \textbf{Description} & \textbf{Ordered} & \textbf{Received} & \textbf{Condition} \\
\midrule
1 & Item description & 0 & 0 & Good \\
2 & Item description & 0 & 0 & Good \\
3 & Item description & 0 & 0 & Good \\
\bottomrule
\end{tabularx}

\vspace{16pt}
\section*{Inspection Notes}
All items received in satisfactory condition unless noted above.

\vspace{32pt}
\noindent
\rule{5cm}{0.4pt}\\
\textbf{Receiver Signature}\\
Date: \rule{3cm}{0.4pt}

\end{document}
""",
    },

    # ── 10. Invoice ──────────────────────────────────────────────────
    {
        'key': 'procurement_invoice',
        'title': 'Invoice',
        'document_type': 'invoice',
        'category': 'invoice',
        'description': 'Vendor invoice template for payment processing',
        'metadata_defaults': {
            'invoice_number': '',
            'po_reference': '',
            'vendor_name': '',
            'vendor_address': '',
            'vendor_tax_id': '',
            'bill_to_company': '',
            'bill_to_address': '',
            'invoice_date': '',
            'due_date': '',
            'subtotal': '',
            'tax_amount': '',
            'total_amount': '',
            'currency': 'USD',
            'bank_name': '',
            'account_number': '',
            'routing_number': '',
        },
        'latex_code': r"""
\documentclass[11pt,a4paper]{article}
\usepackage[margin=1in]{geometry}
\usepackage{booktabs,tabularx,xcolor,fancyhdr}
\definecolor{accent}{HTML}{EA580C}
\pagestyle{fancy}
\fancyhf{}
\rfoot{\thepage}
\renewcommand{\headrulewidth}{0pt}

\begin{document}

\begin{center}
{\color{accent}\LARGE\bfseries INVOICE}\\[6pt]
{\large \# [[invoice_number]]}
\end{center}

\vspace{8pt}

\noindent
\begin{minipage}[t]{0.48\textwidth}
\textbf{From (Vendor)}\\
[[vendor_name]]\\
[[vendor_address]]\\
Tax ID: [[vendor_tax_id]]
\end{minipage}
\hfill
\begin{minipage}[t]{0.48\textwidth}
\textbf{Bill To}\\
[[bill_to_company]]\\
[[bill_to_address]]
\end{minipage}

\vspace{12pt}
\noindent\textbf{PO Reference:} [[po_reference]] \hfill
\textbf{Invoice Date:} [[invoice_date]] \hfill
\textbf{Due Date:} [[due_date]]

\vspace{16pt}

\begin{tabularx}{\textwidth}{@{}l X r r r@{}}
\toprule
\textbf{\#} & \textbf{Description} & \textbf{Qty} & \textbf{Rate} & \textbf{Amount} \\
\midrule
1 & Service / item description & 0 & 0.00 & 0.00 \\
2 & Service / item description & 0 & 0.00 & 0.00 \\
\midrule
 & & & Subtotal: & [[subtotal]] \\
 & & & Tax: & [[tax_amount]] \\
 & & & \textbf{Total ([[currency]]):} & \textbf{[[total_amount]]} \\
\bottomrule
\end{tabularx}

\vspace{16pt}
\section*{Payment Details}
\noindent Bank: [[bank_name]]\\
Account: [[account_number]]\\
Routing: [[routing_number]]

\vspace{8pt}
\noindent\textit{Please reference invoice \# [[invoice_number]] with your payment.}

\end{document}
""",
    },
]
