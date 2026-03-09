# Frontend Prompting — Document Viewer System

## Overview

The viewer system provides a minimal, standalone document viewing experience for external users (clients, partners, reviewers). It's completely separate from the main editor UI — no sidebars, no menus, just the PDF document and optionally an AI chatbot.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  /view/:token   (React route — standalone layout)       │
│                                                         │
│  1. resolveViewerToken(token) → determine auth flow     │
│  2. Show appropriate gate:                              │
│     • PUBLIC      → show PDF immediately                │
│     • EMAIL_OTP   → email input → OTP input → PDF      │
│     • INVITE_ONLY → accept invitation → PDF             │
│     • PASSWORD    → password input → PDF                │
│  3. Once authenticated → render PDF viewer + AI chat    │
└─────────────────────────────────────────────────────────┘
```

## API Reference

### Base URL: `/api/viewer/`

---

### 1. Resolve Token (first call on page load)

```
GET /api/viewer/resolve/:token/
No auth required.
```

**Response:**
```json
{
  "valid": true,
  "access_mode": "public",        // "public" | "email_otp" | "invite_only"
  "role": "viewer",               // "viewer" | "commentator"
  "document_title": "NDA Draft v2",
  "document_type": "contract",
  "shared_by": "John Doe",
  "requires_password": false,
  "requires_otp": false,
  "requires_invitation_accept": false,
  "allowed_actions": ["view", "download", "ai_chat"],
  "settings": {
    "branding_message": "Shared by Acme Legal",
    "theme": "light"
  },
  "expires_at": "2026-04-01T00:00:00Z",
  "invitation_accepted": false,
  "existing_user": true,
  "recipient_name": "Jane Client"
}
```

**Error responses:** `404` (invalid), `403` (expired/revoked/max-reached)

---

### 2. Public PDF (direct stream)

```
GET /api/viewer/public/pdf/:token/
GET /api/viewer/public/pdf/:token/?download=1
No auth required. Only works for access_mode="public".
```

Returns `application/pdf` — embed in `<iframe>` or `<embed>`.

---

### 3. OTP Flow

**Send OTP:**
```
POST /api/viewer/otp/send/
{ "viewer_token": "abc123...", "email": "client@law.com" }
```
Response: `{ "message": "Verification code sent.", "email": "...", "expires_in_seconds": 600 }`

**Verify OTP:**
```
POST /api/viewer/otp/verify/
{ "viewer_token": "abc123...", "email": "client@law.com", "otp": "482916" }
```
Response:
```json
{
  "message": "Email verified successfully.",
  "session": {
    "session_token": "xyz789...",
    "email": "client@law.com",
    "document_id": "uuid",
    "document_title": "NDA Draft",
    "role": "viewer",
    "allowed_actions": ["view", "ai_chat"],
    "settings": { ... },
    "created_at": "...",
    "expires_at": "..."
  }
}
```

---

### 4. Password Flow

```
POST /api/viewer/password/verify/
{ "viewer_token": "abc123...", "password": "secret123" }
```
Returns same session object as OTP verify.

---

### 5. Invitation Accept

```
POST /api/viewer/invitation/accept/
{ "viewer_token": "abc123...", "email": "partner@firm.com" }
```
Response includes `"existing_user": true/false` and session.

---

### 6. Authenticated Viewer Endpoints

**All require:** `Authorization: ViewerSession <session_token>` header or `?session=<token>` query param.

**Document Info:**
```
GET /api/viewer/document/
```

**PDF Stream:**
```
GET /api/viewer/document/pdf/
GET /api/viewer/document/pdf/?download=1
```

**Shared Documents List:**
```
GET /api/viewer/shared-documents/
```
Response:
```json
{
  "count": 3,
  "documents": [
    {
      "document_id": "uuid",
      "document_title": "NDA Draft",
      "document_type": "contract",
      "document_status": "finalized",
      "role": "viewer",
      "access_mode": "email_otp",
      "viewer_token": "abc123...",
      "shared_by": "John Doe",
      "shared_at": "2026-02-20T...",
      "expires_at": null,
      "token_valid": true,
      "allowed_actions": ["view", "download"]
    }
  ]
}
```

---

### 7. AI Chat

```
POST /api/viewer/ai-chat/
{
  "viewer_token": "...",          // for public tokens
  "session_token": "...",         // for authenticated
  "message": "What does clause 5.2 say?",
  "scope": "document",
  "scope_id": null,
  "conversation_history": [
    { "role": "user", "text": "..." },
    { "role": "assistant", "text": "..." }
  ]
}
```

---

### 8. Token Management (for document owners — uses Django session)

```
POST   /api/viewer/tokens/                           Create token
GET    /api/viewer/tokens/                           List my tokens
GET    /api/viewer/tokens/:id/                       Get token details
PATCH  /api/viewer/tokens/:id/                       Update settings
DELETE /api/viewer/tokens/:id/                       Revoke (soft delete)
GET    /api/viewer/tokens/:id/analytics/             Access analytics
POST   /api/viewer/tokens/:id/resend-invitation/     Resend email
GET    /api/viewer/tokens/by-document/:docId/        Tokens for a document
```

**Create token payload:**
```json
{
  "document_id": "uuid",
  "access_mode": "email_otp",
  "role": "viewer",
  "recipient_email": "client@law.com",
  "recipient_name": "Jane Client",
  "expires_in_hours": 72,
  "max_access_count": 50,
  "password": "optional-secret",
  "allowed_actions": ["view", "download", "ai_chat"],
  "settings": {
    "watermark_enabled": true,
    "watermark_text": "CONFIDENTIAL",
    "branding_message": "Shared by Acme Legal",
    "theme": "light",
    "disable_text_selection": true,
    "analytics_enabled": true
  },
  "send_invitation": true
}
```

---

## React Component Patterns

### Route Structure
```jsx
// Standalone viewer layout — no app chrome
<Route path="/view/:token" element={<ViewerLayout />}>
  <Route index element={<ViewerPage />} />
</Route>

// Shared documents dashboard (for returning viewers)
<Route path="/shared" element={<SharedDocumentsPage />} />
```

### ViewerPage Flow
```jsx
function ViewerPage() {
  const { token } = useParams();
  const [tokenInfo, setTokenInfo] = useState(null);
  const [phase, setPhase] = useState('loading'); // loading | public | otp | password | invite | viewing

  useEffect(() => {
    resolveViewerToken(token).then(info => {
      setTokenInfo(info);
      if (info.access_mode === 'public' && !info.requires_password) {
        setPhase('viewing'); // straight to PDF
      } else if (info.requires_password) {
        setPhase('password');
      } else if (info.requires_otp) {
        setPhase('otp');
      } else if (info.requires_invitation_accept) {
        setPhase('invite');
      }
    });
  }, [token]);

  if (phase === 'viewing') {
    const pdfUrl = tokenInfo.access_mode === 'public'
      ? getPublicPdfUrl(token)
      : getAuthenticatedPdfUrl();
    return <ViewerShell pdfUrl={pdfUrl} tokenInfo={tokenInfo} />;
  }

  // Render appropriate gate component
  switch (phase) {
    case 'otp': return <OTPGate token={token} onVerified={() => setPhase('viewing')} />;
    case 'password': return <PasswordGate token={token} onVerified={() => setPhase('viewing')} />;
    case 'invite': return <InviteGate token={token} info={tokenInfo} onAccepted={() => setPhase('viewing')} />;
    default: return <LoadingScreen />;
  }
}
```

### ViewerShell (minimal chrome)
```jsx
function ViewerShell({ pdfUrl, tokenInfo }) {
  return (
    <div className="viewer-shell">
      {/* Optional branding header */}
      {tokenInfo.settings?.branding_message && (
        <div className="viewer-branding">{tokenInfo.settings.branding_message}</div>
      )}

      {/* PDF embed — full page */}
      <iframe src={pdfUrl} className="viewer-pdf-frame" />

      {/* AI Chat FAB (if allowed) */}
      {tokenInfo.allowed_actions?.includes('ai_chat') && (
        <ViewerAIChatFAB token={tokenInfo} />
      )}

      {/* Download button (if allowed) */}
      {tokenInfo.allowed_actions?.includes('download') && (
        <DownloadButton />
      )}
    </div>
  );
}
```

### OTP Gate
```jsx
function OTPGate({ token, onVerified }) {
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState('email'); // email | otp

  const handleSendOTP = async () => {
    await sendOTP(token, email);
    setStep('otp');
  };

  const handleVerifyOTP = async () => {
    await verifyOTP(token, email, otp);
    onVerified();
  };

  if (step === 'email') {
    return (
      <div className="otp-gate">
        <h2>Verify your email to view this document</h2>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} />
        <button onClick={handleSendOTP}>Send Code</button>
      </div>
    );
  }

  return (
    <div className="otp-gate">
      <h2>Enter verification code</h2>
      <p>Sent to {email}</p>
      <input type="text" maxLength={6} value={otp} onChange={e => setOtp(e.target.value)} />
      <button onClick={handleVerifyOTP}>Verify</button>
    </div>
  );
}
```

## Frontend Service Import

```js
import viewerService from '@/services/viewerService';
// or destructured:
import {
  resolveViewerToken,
  getPublicPdfUrl,
  sendOTP,
  verifyOTP,
  verifyPassword,
  acceptInvitation,
  getViewerDocumentInfo,
  getSharedDocuments,
  sendViewerAIChat,
  // Token management (owner)
  createViewerToken,
  listViewerTokens,
  getViewerTokensByDocument,
  revokeViewerToken,
} from '@/services/viewerService';
```
