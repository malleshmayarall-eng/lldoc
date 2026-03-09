# Edit-Full API Usage Guide

## Overview

The `editFull` method allows you to update **all 70+ document fields** in a single atomic request. This is the most powerful document update API available.

## Quick Start

```javascript
import documentService from '@services/documentService';
import { quickUpdateBasicInfo } from '@utils/documentFieldBuilder';

// Simple update
const result = await documentService.editFull(documentId, {
  title: "Updated Title",
  status: "approved",
  change_summary: "Quick title update"
});
```

## Import Statements

```javascript
// Service
import documentService from '@services/documentService';

// Field builders and constants
import {
  buildEditFullPayload,
  buildMetadata,
  buildFinancial,
  buildProvisions,
  DOCUMENT_STATUSES,
  DOCUMENT_CATEGORIES,
  quickFinalizeContract,
  quickUpdateFinancials,
} from '@utils/documentFieldBuilder';
```

## Common Use Cases

### 1. Update Basic Information

```javascript
import { quickUpdateBasicInfo, DOCUMENT_STATUSES } from '@utils/documentFieldBuilder';

const updates = quickUpdateBasicInfo({
  title: "Software License Agreement - Final",
  author: "Legal Team",
  version: "2.0",
  status: DOCUMENT_STATUSES.FINALIZED,
  changeSummary: "Updated to final version"
});

const result = await documentService.editFull(documentId, updates);
console.log(`Made ${result.changes_count} changes`);
console.log(result.changes); // Array of change descriptions
```

### 2. Finalize Contract

```javascript
import { quickFinalizeContract, buildSignatory } from '@utils/documentFieldBuilder';

const updates = quickFinalizeContract({
  executionDate: "2026-01-15",
  signatories: [
    buildSignatory({
      name: "John Doe",
      title: "CEO",
      party: "Company A",
      signed: true,
      signatureDate: "2026-01-15"
    }),
    buildSignatory({
      name: "Jane Smith",
      title: "Director",
      party: "Company B",
      signed: true,
      signatureDate: "2026-01-15"
    })
  ]
});

const result = await documentService.editFull(documentId, updates);
```

### 3. Update Financial Terms

```javascript
import { 
  quickUpdateFinancials, 
  buildPaymentTerms,
  PAYMENT_SCHEDULES 
} from '@utils/documentFieldBuilder';

const updates = quickUpdateFinancials({
  contractValue: "85000.00",
  currency: "USD",
  paymentTerms: buildPaymentTerms({
    schedule: PAYMENT_SCHEDULES.MONTHLY,
    dueDays: 15,
    method: "wire_transfer",
    lateFeePercentage: 2.0,
    discountEarlyPayment: {
      percentage: 2.0,
      days: 10
    }
  }),
  changeSummary: "Updated payment terms with early payment discount"
});

const result = await documentService.editFull(documentId, updates);
```

### 4. Add Company Branding

```javascript
import { quickAddBranding } from '@utils/documentFieldBuilder';

// First, get image UUIDs (from DocumentImage uploads)
const logoId = "123e4567-e89b-12d3-a456-426614174000";
const watermarkId = "123e4567-e89b-12d3-a456-426614174001";

const updates = quickAddBranding({
  logoImageId: logoId,
  watermarkImageId: watermarkId,
  headerIconId: null, // Remove header icon
  footerIconId: null
});

const result = await documentService.editFull(documentId, updates);
```

### 5. Update Legal Provisions

```javascript
import { 
  quickUpdateProvisions,
  buildIndemnificationClause,
  buildInsuranceRequirements,
  buildTerminationClause
} from '@utils/documentFieldBuilder';

const updates = quickUpdateProvisions({
  liabilityCap: "200000.00",
  indemnificationClauses: [
    buildIndemnificationClause({
      type: "ip_infringement",
      description: "Licensor indemnifies against IP claims"
    }),
    buildIndemnificationClause({
      type: "general",
      description: "Each party indemnifies the other..."
    })
  ],
  insuranceRequirements: buildInsuranceRequirements({
    generalLiability: "2000000",
    professionalLiability: "1000000",
    cyberLiability: "1000000"
  }),
  terminationClauses: [
    buildTerminationClause({
      type: "breach",
      noticePeriod: "30 days",
      curePeriod: "15 days"
    }),
    buildTerminationClause({
      type: "convenience",
      noticePeriod: "90 days"
    })
  ],
  changeSummary: "Enhanced legal protections"
});

const result = await documentService.editFull(documentId, updates);
```

## Advanced Use Cases

### 6. Complete Contract Setup

```javascript
import {
  buildEditFullPayload,
  buildMetadata,
  buildParty,
  buildSignatory,
  buildDates,
  buildLegalInfo,
  buildFinancial,
  buildPaymentTerms,
  buildTermRenewal,
  buildClassification,
  DOCUMENT_CATEGORIES,
  DOCUMENT_STATUSES,
  PARTY_TYPES,
  PAYMENT_SCHEDULES
} from '@utils/documentFieldBuilder';

const updates = buildEditFullPayload({
  metadata: buildMetadata({
    title: "Master Service Agreement",
    author: "Legal Department",
    version: "1.0",
    documentType: "contract"
  }),
  
  parties: [
    buildParty({
      name: "TechCorp Inc",
      role: "Service Provider",
      type: PARTY_TYPES.CORPORATION,
      address: "123 Tech Street, San Francisco, CA 94105",
      contactEmail: "contracts@techcorp.com",
      contactPhone: "+1-555-0123"
    }),
    buildParty({
      name: "ClientCo LLC",
      role: "Client",
      type: PARTY_TYPES.LLC,
      address: "456 Business Ave, New York, NY 10001"
    })
  ],
  
  signatories: [
    buildSignatory({
      name: "Alice Johnson",
      title: "CEO",
      party: "TechCorp Inc",
      signed: false
    }),
    buildSignatory({
      name: "Bob Williams",
      title: "CFO",
      party: "ClientCo LLC",
      signed: false
    })
  ],
  
  dates: buildDates({
    effectiveDate: "2026-02-01",
    expirationDate: "2028-02-01",
    executionDate: null // Not yet executed
  }),
  
  legal: buildLegalInfo({
    governingLaw: "California",
    referenceNumber: "MSA-2026-001",
    projectName: "Enterprise Platform Integration",
    jurisdiction: "US-California"
  }),
  
  financial: buildFinancial({
    contractValue: "500000.00",
    currency: "USD",
    paymentTerms: buildPaymentTerms({
      schedule: PAYMENT_SCHEDULES.MILESTONE,
      dueDays: 30,
      method: "ACH",
      lateFeePercentage: 1.5
    })
  }),
  
  termRenewal: buildTermRenewal({
    termLength: "24 months",
    autoRenewal: true,
    renewalTerms: "Automatically renews for successive 12-month periods",
    noticePeriod: "90 days"
  }),
  
  classification: buildClassification({
    category: DOCUMENT_CATEGORIES.CONTRACT,
    status: DOCUMENT_STATUSES.DRAFT
  }),
  
  changeSummary: "Initial contract setup with complete terms"
});

const result = await documentService.editFull(documentId, updates);
```

### 7. Add Compliance Requirements

```javascript
import { buildCompliance } from '@utils/documentFieldBuilder';

const updates = {
  ...buildCompliance({
    regulatoryRequirements: ["GDPR", "HIPAA", "SOC 2", "PCI DSS"],
    complianceCertifications: ["ISO 27001", "ISO 9001", "SOC 2 Type II"]
  }),
  change_summary: "Added compliance and certification requirements"
};

const result = await documentService.editFull(documentId, updates);
```

### 8. Update Confidentiality and Dispute Resolution

```javascript
import { 
  buildConfidentiality, 
  buildDisputeResolution,
  DISPUTE_METHODS 
} from '@utils/documentFieldBuilder';

const updates = {
  ...buildConfidentiality({
    confidentialityPeriod: "5 years",
    ndaType: "mutual"
  }),
  ...buildDisputeResolution({
    method: DISPUTE_METHODS.ARBITRATION,
    location: "San Francisco, CA"
  }),
  change_summary: "Updated confidentiality and dispute resolution terms"
};

const result = await documentService.editFull(documentId, updates);
```

### 9. Add Attachments and File Info

```javascript
import { buildFiles, buildAttachment } from '@utils/documentFieldBuilder';

const updates = buildEditFullPayload({
  files: buildFiles({
    sourceFileName: "contract-signed.pdf",
    sourceFileType: "application/pdf",
    sourceFileSize: 2048576, // 2MB in bytes
    attachments: [
      buildAttachment({
        name: "Exhibit A - Scope of Work",
        filePath: "attachments/exhibit-a.pdf",
        type: "exhibit",
        size: 524288
      }),
      buildAttachment({
        name: "Schedule 1 - Pricing",
        filePath: "attachments/schedule-1.xlsx",
        type: "schedule",
        size: 102400
      })
    ],
    pageCount: 25
  }),
  changeSummary: "Added signed contract and exhibits"
});

const result = await documentService.editFull(documentId, updates);
```

### 10. Add Custom Metadata

```javascript
import { buildCustom, buildRelatedDocument } from '@utils/documentFieldBuilder';

const updates = buildEditFullPayload({
  custom: buildCustom({
    customMetadata: {
      department: "Legal",
      cost_center: "CC-1234",
      approval_level: "executive",
      sales_rep: "John Doe",
      region: "West Coast",
      internal_notes: "Rush approval needed"
    },
    relatedDocuments: [
      buildRelatedDocument({
        id: "parent-contract-uuid",
        title: "Master Framework Agreement",
        relationship: "parent"
      }),
      buildRelatedDocument({
        id: "amendment-uuid",
        title: "Amendment No. 1",
        relationship: "amendment"
      })
    ]
  }),
  changeSummary: "Added internal metadata and related documents"
});

const result = await documentService.editFull(documentId, updates);
```

## React Component Examples

### Basic Edit Form

```jsx
import { useState } from 'react';
import documentService from '@services/documentService';
import { DOCUMENT_STATUSES } from '@utils/documentFieldBuilder';

function DocumentEditForm({ documentId, onSuccess }) {
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [status, setStatus] = useState(DOCUMENT_STATUSES.DRAFT);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      const result = await documentService.editFull(documentId, {
        title,
        author,
        status,
        change_summary: "Updated document metadata"
      });
      
      console.log(`Updated ${result.changes_count} fields`);
      onSuccess(result);
    } catch (error) {
      console.error('Failed to update:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <input 
        value={title} 
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
      />
      <input 
        value={author} 
        onChange={(e) => setAuthor(e.target.value)}
        placeholder="Author"
      />
      <select value={status} onChange={(e) => setStatus(e.target.value)}>
        {Object.values(DOCUMENT_STATUSES).map(s => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      <button type="submit" disabled={loading}>
        {loading ? 'Saving...' : 'Save Changes'}
      </button>
    </form>
  );
}
```

### Financial Terms Editor

```jsx
import { useState } from 'react';
import documentService from '@services/documentService';
import { 
  buildPaymentTerms, 
  PAYMENT_SCHEDULES 
} from '@utils/documentFieldBuilder';

function FinancialEditor({ documentId, onUpdate }) {
  const [value, setValue] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [schedule, setSchedule] = useState(PAYMENT_SCHEDULES.MONTHLY);
  const [dueDays, setDueDays] = useState(30);

  const handleSave = async () => {
    try {
      const result = await documentService.editFull(documentId, {
        contract_value: value,
        currency,
        payment_terms: buildPaymentTerms({
          schedule,
          dueDays,
          method: 'wire_transfer'
        }),
        change_summary: `Updated contract value to ${value} ${currency}`
      });
      
      onUpdate(result);
    } catch (error) {
      console.error('Failed to update financials:', error);
    }
  };

  return (
    <div className="financial-editor">
      <h3>Financial Terms</h3>
      <div>
        <label>Contract Value</label>
        <input 
          type="number" 
          value={value} 
          onChange={(e) => setValue(e.target.value)}
          step="0.01"
        />
      </div>
      <div>
        <label>Currency</label>
        <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
          <option value="USD">USD</option>
          <option value="EUR">EUR</option>
          <option value="GBP">GBP</option>
        </select>
      </div>
      <div>
        <label>Payment Schedule</label>
        <select value={schedule} onChange={(e) => setSchedule(e.target.value)}>
          {Object.entries(PAYMENT_SCHEDULES).map(([key, val]) => (
            <option key={val} value={val}>{key}</option>
          ))}
        </select>
      </div>
      <div>
        <label>Due Days</label>
        <input 
          type="number" 
          value={dueDays} 
          onChange={(e) => setDueDays(Number(e.target.value))}
        />
      </div>
      <button onClick={handleSave}>Save Financial Terms</button>
    </div>
  );
}
```

## Error Handling

```javascript
try {
  const result = await documentService.editFull(documentId, updates);
  
  // Success
  console.log(`Changes: ${result.changes_count}`);
  result.changes.forEach(change => console.log(`✓ ${change}`));
  
} catch (error) {
  if (error.response?.status === 400) {
    // Validation errors
    console.error('Validation failed:', error.response.data);
    // Example: { "contract_value": ["A valid number is required."] }
    
  } else if (error.response?.status === 404) {
    // Document or image not found
    console.error('Not found:', error.response.data.error);
    
  } else {
    // Other errors
    console.error('Update failed:', error.message);
  }
}
```

## Response Structure

```javascript
{
  message: "Document fully updated successfully",
  changes_count: 8,
  changes: [
    "Title changed from 'Old Title' to 'New Title'",
    "Version updated to 2.0",
    "Draft status: False",
    "Updated 2 parties",
    "Contract value: 75000.00 USD",
    "Payment terms updated",
    "Dispute resolution: arbitration",
    "Status changed from 'draft' to 'finalized'"
  ],
  document: {
    id: "uuid",
    title: "New Title",
    sections: [...],
    issues: [...],
    metadata: {
      createdAt: "2026-01-01T10:00:00Z",
      updatedAt: "2026-01-01T15:30:00Z",
      type: "contract",
      author: "Jane Smith",
      version: "2.0"
    }
  }
}
```

## Best Practices

### 1. Always Include change_summary
```javascript
// Good
await documentService.editFull(docId, {
  title: "New Title",
  change_summary: "Updated title per legal review"
});

// Bad - harder to track changes
await documentService.editFull(docId, {
  title: "New Title"
});
```

### 2. Use PATCH for Partial Updates
```javascript
// Partial update (default, recommended)
await documentService.editFull(docId, { title: "New" });

// Full update (replaces all fields - use with caution!)
await documentService.editFull(docId, allFields, true);
```

### 3. Validate Before Submitting
```javascript
import { isValidDate, isValidCurrency } from '@utils/documentFieldBuilder';

const effectiveDate = "2026-01-01";
const currency = "USD";

if (!isValidDate(effectiveDate)) {
  throw new Error("Invalid date format. Use YYYY-MM-DD");
}

if (!isValidCurrency(currency)) {
  throw new Error("Invalid currency code");
}

await documentService.editFull(docId, {
  effective_date: effectiveDate,
  currency,
  change_summary: "Updated dates and currency"
});
```

### 4. Handle Images Properly
```javascript
// First verify image exists
const logoId = "123e4567-e89b-12d3-a456-426614174000";

try {
  // Link image to document
  await documentService.editFull(docId, {
    logo_image_id: logoId,
    change_summary: "Added company logo"
  });
} catch (error) {
  if (error.response?.data?.error?.includes('not found')) {
    console.error('Image UUID not found. Upload image first.');
  }
}
```

### 5. Batch Related Updates
```javascript
// Good - atomic update
await documentService.editFull(docId, {
  title: "Updated Title",
  status: "finalized",
  effective_date: "2026-01-01",
  is_draft: false,
  change_summary: "Finalized contract"
});

// Bad - multiple requests
await documentService.editFull(docId, { title: "Updated Title" });
await documentService.editFull(docId, { status: "finalized" });
await documentService.editFull(docId, { effective_date: "2026-01-01" });
```

## Field Reference Quick Lookup

| Category | Key Fields | Builder Function |
|----------|-----------|------------------|
| Core | title, author, version | `buildMetadata()` |
| Version | version_number, is_draft, version_label | `buildVersionManagement()` |
| Parties | parties, signatories | `buildParty()`, `buildSignatory()` |
| Dates | effective_date, expiration_date | `buildDates()` |
| Legal | governing_law, jurisdiction | `buildLegalInfo()` |
| Financial | contract_value, currency, payment_terms | `buildFinancial()`, `buildPaymentTerms()` |
| Term | term_length, auto_renewal | `buildTermRenewal()` |
| Provisions | liability_cap, indemnification_clauses | `buildProvisions()` |
| Compliance | regulatory_requirements | `buildCompliance()` |
| Confidentiality | confidentiality_period, nda_type | `buildConfidentiality()` |
| Dispute | dispute_resolution_method | `buildDisputeResolution()` |
| Classification | category, status | `buildClassification()` |
| Files | attachments, page_count | `buildFiles()`, `buildAttachment()` |
| Images | logo_image_id, watermark_image_id | `buildImages()` |
| Custom | custom_metadata, related_documents | `buildCustom()` |

## Constants Reference

```javascript
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_STATUSES,
  PAYMENT_SCHEDULES,
  DISPUTE_METHODS,
  PARTY_TYPES
} from '@utils/documentFieldBuilder';

// DOCUMENT_CATEGORIES
// contract, policy, regulation, legal_brief, terms, nda, license, other

// DOCUMENT_STATUSES
// draft, under_review, analyzed, approved, finalized

// PAYMENT_SCHEDULES
// monthly, quarterly, annually, one_time, milestone

// DISPUTE_METHODS
// arbitration, mediation, litigation, negotiation

// PARTY_TYPES
// corporation, individual, partnership, llc, government
```

## Testing

```javascript
// Test basic update
const testBasicUpdate = async () => {
  const result = await documentService.editFull('test-doc-id', {
    title: "Test Update",
    change_summary: "Testing edit-full endpoint"
  });
  console.assert(result.changes_count > 0, "Should have changes");
};

// Test full update
const testFullUpdate = async () => {
  const updates = buildEditFullPayload({
    metadata: buildMetadata({ title: "Full Test", author: "Tester" }),
    financial: buildFinancial({ contractValue: "99999.99", currency: "EUR" }),
    classification: buildClassification({ status: DOCUMENT_STATUSES.APPROVED }),
    changeSummary: "Comprehensive test"
  });
  
  const result = await documentService.editFull('test-doc-id', updates);
  console.log('Changes:', result.changes);
};
```

## Summary

The `editFull` API provides:
- ✅ **70+ editable fields** in one request
- ✅ **Atomic updates** - all or nothing
- ✅ **Automatic change tracking**
- ✅ **Builder utilities** for type safety
- ✅ **Quick helpers** for common tasks
- ✅ **Validation** helpers
- ✅ **Constants** for consistency

Perfect for:
- Contract finalization workflows
- Bulk metadata updates
- Company branding integration
- Financial term updates
- Legal provision management
- Custom field management
