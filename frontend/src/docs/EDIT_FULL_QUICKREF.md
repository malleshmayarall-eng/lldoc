# Edit-Full API - Quick Reference Card

## 🚀 Quick Start

```javascript
import documentService from '@services/documentService';

// Simple update
await documentService.editFull(docId, {
  title: "New Title",
  status: "approved",
  change_summary: "Quick update"
});
```

## 📦 Imports

```javascript
// Service
import documentService from '@services/documentService';

// Builders and constants
import {
  // Quick helpers
  quickUpdateBasicInfo,
  quickFinalizeContract,
  quickAddBranding,
  quickUpdateFinancials,
  
  // Field builders
  buildMetadata,
  buildFinancial,
  buildProvisions,
  buildParty,
  buildSignatory,
  
  // Constants
  DOCUMENT_STATUSES,
  DOCUMENT_CATEGORIES,
  PAYMENT_SCHEDULES,
} from '@utils/documentFieldBuilder';
```

## ⚡ Quick Helpers

### Update Basic Info
```javascript
const updates = quickUpdateBasicInfo({
  title: "New Title",
  author: "Jane Doe",
  version: "2.0",
  status: DOCUMENT_STATUSES.FINALIZED,
  changeSummary: "Updated basics"
});
await documentService.editFull(docId, updates);
```

### Finalize Contract
```javascript
const updates = quickFinalizeContract({
  executionDate: "2026-01-15",
  signatories: [
    buildSignatory({
      name: "John Doe",
      title: "CEO",
      party: "Company A",
      signed: true,
      signatureDate: "2026-01-15"
    })
  ]
});
await documentService.editFull(docId, updates);
```

### Add Branding
```javascript
const updates = quickAddBranding({
  logoImageId: "uuid-logo",
  watermarkImageId: "uuid-watermark"
});
await documentService.editFull(docId, updates);
```

### Update Financials
```javascript
const updates = quickUpdateFinancials({
  contractValue: "85000.00",
  currency: "USD",
  paymentTerms: buildPaymentTerms({
    schedule: PAYMENT_SCHEDULES.MONTHLY,
    dueDays: 30
  })
});
await documentService.editFull(docId, updates);
```

## 🎯 Common Patterns

### Pattern 1: Direct Field Update
```javascript
await documentService.editFull(docId, {
  title: "New Title",
  contract_value: "50000.00",
  status: "finalized",
  change_summary: "Direct update"
});
```

### Pattern 2: Using Builders
```javascript
const updates = {
  ...buildMetadata({ title: "New Title", author: "John" }),
  ...buildFinancial({ contractValue: "50000.00", currency: "USD" }),
  change_summary: "Builder pattern"
};
await documentService.editFull(docId, updates);
```

### Pattern 3: Full Payload Builder
```javascript
import { buildEditFullPayload } from '@utils/documentFieldBuilder';

const updates = buildEditFullPayload({
  metadata: buildMetadata({ title: "New", author: "Jane" }),
  financial: buildFinancial({ contractValue: "60000", currency: "EUR" }),
  changeSummary: "Full payload"
});
await documentService.editFull(docId, updates);
```

## 📋 Constants

```javascript
// Document Categories
DOCUMENT_CATEGORIES = {
  CONTRACT: 'contract',
  POLICY: 'policy',
  NDA: 'nda',
  LICENSE: 'license',
  // ... more
}

// Document Statuses
DOCUMENT_STATUSES = {
  DRAFT: 'draft',
  UNDER_REVIEW: 'under_review',
  APPROVED: 'approved',
  FINALIZED: 'finalized',
}

// Payment Schedules
PAYMENT_SCHEDULES = {
  MONTHLY: 'monthly',
  QUARTERLY: 'quarterly',
  ANNUALLY: 'annually',
  MILESTONE: 'milestone',
}

// Party Types
PARTY_TYPES = {
  CORPORATION: 'corporation',
  INDIVIDUAL: 'individual',
  LLC: 'llc',
}

// Dispute Methods
DISPUTE_METHODS = {
  ARBITRATION: 'arbitration',
  MEDIATION: 'mediation',
  LITIGATION: 'litigation',
}
```

## 🏗️ Field Builders

### buildMetadata()
```javascript
buildMetadata({
  title: "Title",
  author: "Author",
  version: "1.0",
  documentType: "contract"
})
// Returns: { title, author, version, document_type }
```

### buildParty()
```javascript
buildParty({
  name: "Company A",
  role: "Provider",
  type: PARTY_TYPES.CORPORATION,
  address: "123 Main St",
  contactEmail: "contact@company.com"
})
```

### buildSignatory()
```javascript
buildSignatory({
  name: "John Doe",
  title: "CEO",
  party: "Company A",
  signed: true,
  signatureDate: "2026-01-01"
})
```

### buildDates()
```javascript
buildDates({
  effectiveDate: "2026-01-01",
  expirationDate: "2027-01-01",
  executionDate: "2025-12-15"
})
// Returns: { effective_date, expiration_date, execution_date }
```

### buildFinancial()
```javascript
buildFinancial({
  contractValue: "50000.00",
  currency: "USD",
  paymentTerms: buildPaymentTerms({
    schedule: PAYMENT_SCHEDULES.MONTHLY,
    dueDays: 30,
    method: "wire_transfer"
  })
})
```

### buildProvisions()
```javascript
buildProvisions({
  liabilityCap: "100000.00",
  terminationForConvenience: true,
  indemnificationClauses: [...]
})
```

### buildImages()
```javascript
buildImages({
  logoImageId: "uuid",
  watermarkImageId: "uuid",
  headerIconId: "uuid"
})
// Returns: { logo_image_id, watermark_image_id, header_icon_id }
```

## 🎨 Complete Examples

### Example 1: Simple Title Update
```javascript
const result = await documentService.editFull(docId, {
  title: "Updated Contract",
  change_summary: "Title update"
});
console.log(`Made ${result.changes_count} changes`);
```

### Example 2: Financial Terms
```javascript
const result = await documentService.editFull(docId, {
  contract_value: "75000.00",
  currency: "USD",
  payment_terms: {
    schedule: "monthly",
    due_days: 15,
    method: "ACH",
    late_fee_percentage: 2.0
  },
  change_summary: "Updated payment terms"
});
```

### Example 3: Complete Contract
```javascript
const updates = buildEditFullPayload({
  metadata: buildMetadata({
    title: "Service Agreement",
    author: "Legal Team",
    version: "1.0"
  }),
  parties: [
    buildParty({ name: "Company A", role: "Provider", type: PARTY_TYPES.CORPORATION }),
    buildParty({ name: "Company B", role: "Client", type: PARTY_TYPES.LLC })
  ],
  dates: buildDates({
    effectiveDate: "2026-02-01",
    expirationDate: "2027-02-01"
  }),
  financial: buildFinancial({
    contractValue: "100000.00",
    currency: "USD",
    paymentTerms: buildPaymentTerms({ schedule: PAYMENT_SCHEDULES.QUARTERLY })
  }),
  classification: buildClassification({
    category: DOCUMENT_CATEGORIES.CONTRACT,
    status: DOCUMENT_STATUSES.DRAFT
  }),
  changeSummary: "Initial contract setup"
});

const result = await documentService.editFull(docId, updates);
```

## ⚠️ Error Handling

```javascript
try {
  const result = await documentService.editFull(docId, updates);
  console.log('Success:', result.changes);
} catch (error) {
  if (error.response?.status === 400) {
    // Validation error
    console.error('Validation:', error.response.data);
  } else if (error.response?.status === 404) {
    // Not found
    console.error('Not found:', error.response.data.error);
  } else {
    console.error('Failed:', error.message);
  }
}
```

## 📊 Response Structure

```javascript
{
  message: "Document fully updated successfully",
  changes_count: 5,
  changes: [
    "Title changed from 'Old' to 'New'",
    "Contract value: 50000.00 USD",
    "Status changed to 'finalized'",
    ...
  ],
  document: {
    id: "uuid",
    title: "New Title",
    sections: [...],
    metadata: {...}
  }
}
```

## ✅ Best Practices

1. **Always include change_summary**
   ```javascript
   { title: "New", change_summary: "Updated title" }
   ```

2. **Use PATCH by default** (partial updates)
   ```javascript
   // Good - only updates title
   editFull(docId, { title: "New" })
   
   // Careful - replaces all fields
   editFull(docId, allFields, true)
   ```

3. **Validate before submitting**
   ```javascript
   import { isValidDate, isValidCurrency } from '@utils/documentFieldBuilder';
   if (!isValidDate(date)) throw new Error("Invalid date");
   ```

4. **Batch related updates**
   ```javascript
   // Good - one atomic update
   editFull(docId, { title: "New", status: "finalized" })
   
   // Bad - multiple requests
   editFull(docId, { title: "New" });
   editFull(docId, { status: "finalized" });
   ```

## 📝 Field Groups (70+ Total)

| Group | Example Fields |
|-------|---------------|
| Core Metadata | title, author, version, document_type |
| Version | version_number, is_draft, version_label |
| Parties | parties, signatories |
| Dates | effective_date, expiration_date |
| Legal | governing_law, jurisdiction |
| Financial | contract_value, currency, payment_terms |
| Term/Renewal | term_length, auto_renewal |
| Provisions | liability_cap, indemnification_clauses |
| Compliance | regulatory_requirements |
| Confidentiality | confidentiality_period, nda_type |
| Dispute | dispute_resolution_method |
| Classification | category, status |
| Files | attachments, page_count |
| Images | logo_image_id, watermark_image_id |
| Custom | custom_metadata, related_documents |

## 🔗 Related Documentation

- Full Guide: `/src/docs/EDIT_FULL_USAGE.md`
- API Service: `/src/services/documentService.js`
- Field Builders: `/src/utils/documentFieldBuilder.js`
- API Endpoints: `/src/constants/api.js`

## 💡 Tips

- Use quick helpers for common tasks
- Builders ensure correct field names
- Constants prevent typos
- Always handle errors
- Check response.changes for audit trail
- Validate dates and currencies
- Test with small updates first
- Use change_summary for tracking
