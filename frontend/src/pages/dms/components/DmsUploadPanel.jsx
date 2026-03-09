import { useMemo, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { dmsService } from '../../../services/dmsService';

const DmsUploadPanel = ({ onUploaded }) => {
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [metadataJson, setMetadataJson] = useState('');
  const [extractMetadata, setExtractMetadata] = useState(true);
  const [extractText, setExtractText] = useState(true);
  const [status, setStatus] = useState({ loading: false, error: null, success: null });
  const [step, setStep] = useState('preflight');
  const [preflightData, setPreflightData] = useState(null);
  const [metaForm, setMetaForm] = useState({
    document_id: '',
    document_name: '',
    document_type: 'contract',
    category: '',
    status: 'active',
    dates: {
      uploaded_date: '',
      signed_date: '',
      effective_date: '',
      expiration_date: '',
      termination_date: '',
      archived_date: '',
    },
    signing: {
      is_signed: false,
      signature_type: 'esign',
      signatories: [{ name: '', role: '', organization: '' }],
    },
    compliance: {
      jurisdiction: '',
      retention_end_date: '',
      legal_hold: false,
    },
    notes: '',
  });

  const preflightMetadata = useMemo(() => preflightData?.metadata || {}, [preflightData]);

  const updateMetaForm = (path, value) => {
    setMetaForm((prev) => {
      const clone = structuredClone(prev);
      const keys = path.split('.');
      let pointer = clone;
      keys.forEach((key, index) => {
        if (index === keys.length - 1) {
          pointer[key] = value;
        } else {
          pointer[key] = pointer[key] ?? {};
          pointer = pointer[key];
        }
      });
      return clone;
    });
  };

  const updateSignatory = (index, field, value) => {
    setMetaForm((prev) => {
      const clone = structuredClone(prev);
      clone.signing.signatories = clone.signing.signatories || [];
      clone.signing.signatories[index] = {
        ...clone.signing.signatories[index],
        [field]: value,
      };
      return clone;
    });
  };

  const addSignatory = () => {
    setMetaForm((prev) => ({
      ...prev,
      signing: {
        ...prev.signing,
        signatories: [...(prev.signing.signatories || []), { name: '', role: '', organization: '' }],
      },
    }));
  };

  const handlePreflight = async (event) => {
    event.preventDefault();
    if (!file) {
      setStatus({ loading: false, error: 'Please select a PDF file to upload.', success: null });
      return;
    }

    let metadataPayload = undefined;
    if (metadataJson.trim()) {
      try {
        metadataPayload = JSON.parse(metadataJson);
      } catch (error) {
        setStatus({ loading: false, error: 'Metadata must be valid JSON.', success: null });
        return;
      }
    }

    setStatus({ loading: true, error: null, success: null });
    try {
      const preview = await dmsService.preflightDocument({
        file,
        title: title.trim() || undefined,
        metadata: metadataPayload,
        extractMetadata,
        extractText,
      });
      setPreflightData(preview);
      setMetaForm((prev) => ({
        ...prev,
        document_name: preview?.title || preview?.original_filename || prev.document_name,
        dates: {
          ...prev.dates,
          uploaded_date: new Date().toISOString().slice(0, 10),
        },
      }));
      setStatus({ loading: false, error: null, success: null });
      setStep('metadata');
    } catch (error) {
      setStatus({
        loading: false,
        error: error?.response?.data?.detail || error?.message || 'Upload failed.',
        success: null,
      });
    }
  };

  const handleFinalUpload = async (event) => {
    event.preventDefault();
    if (!file) {
      setStatus({ loading: false, error: 'Please select a PDF file to upload.', success: null });
      return;
    }

    let metadataPayload = undefined;
    const metadataFromJson = metadataJson.trim();
    if (metadataFromJson) {
      try {
        metadataPayload = JSON.parse(metadataFromJson);
      } catch (error) {
        setStatus({ loading: false, error: 'Metadata must be valid JSON.', success: null });
        return;
      }
    }

    const combinedMetadata = {
      ...(metadataPayload || {}),
      extracted_pdf: preflightMetadata,
      ...metaForm,
    };

    setStatus({ loading: true, error: null, success: null });
    try {
      const uploaded = await dmsService.uploadDocument({
        file,
        title: title.trim() || undefined,
        metadata: combinedMetadata,
        extractMetadata,
        extractText,
      });
      setStatus({ loading: false, error: null, success: `Uploaded ${uploaded.title || uploaded.original_filename}.` });
      setFile(null);
      setTitle('');
      setMetadataJson('');
      setPreflightData(null);
      setStep('preflight');
      if (onUploaded) onUploaded(uploaded);
    } catch (error) {
      setStatus({
        loading: false,
        error: error?.response?.data?.detail || error?.message || 'Upload failed.',
        success: null,
      });
    }
  };

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-2">
        <UploadCloud className="h-5 w-5 text-blue-600" />
        <h2 className="text-lg font-semibold text-gray-900">Upload PDF</h2>
      </div>
      <p className="mt-1 text-sm text-gray-600">
        First, preflight a PDF to extract metadata, then fill missing fields before saving.
      </p>

      {step === 'preflight' ? (
        <form className="mt-4 space-y-4" onSubmit={handlePreflight}>
        <div>
          <label className="block text-sm font-medium text-gray-700">PDF File</label>
          <input
            type="file"
            accept="application/pdf"
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            onChange={(event) => setFile(event.target.files?.[0] || null)}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">Title (optional)</label>
          <input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Contract"
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">Metadata JSON (optional)</label>
          <textarea
            value={metadataJson}
            onChange={(event) => setMetadataJson(event.target.value)}
            rows={4}
            placeholder='{"author": "Alice", "custom_key": "custom_value"}'
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-xs font-mono"
          />
        </div>

        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={extractMetadata}
              onChange={(event) => setExtractMetadata(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600"
            />
            Extract metadata
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={extractText}
              onChange={(event) => setExtractText(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600"
            />
            Extract text
          </label>
        </div>

        {status.error && <p className="text-sm text-red-600">{status.error}</p>}
        {status.success && <p className="text-sm text-green-600">{status.success}</p>}

        <button
          type="submit"
          disabled={status.loading}
          className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
        >
          {status.loading ? 'Extracting…' : 'Extract metadata'}
        </button>
      </form>
      ) : (
        <form className="mt-4 space-y-4" onSubmit={handleFinalUpload}>
          <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
            Extracted metadata: title “{preflightData?.title || preflightData?.original_filename || 'Untitled'}”,
            author “{preflightMetadata?.author || 'Unknown'}”.
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-gray-700">Document ID</label>
              <input
                type="text"
                value={metaForm.document_id}
                onChange={(event) => updateMetaForm('document_id', event.target.value)}
                placeholder="DOC-2026-001"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700">Document Name</label>
              <input
                type="text"
                value={metaForm.document_name}
                onChange={(event) => updateMetaForm('document_name', event.target.value)}
                placeholder="Contract"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700">Document Type</label>
              <select
                value={metaForm.document_type}
                onChange={(event) => updateMetaForm('document_type', event.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
              >
                <option value="contract">Contract</option>
                <option value="policy">Policy</option>
                <option value="agreement">Agreement</option>
                <option value="certificate">Certificate</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700">Category</label>
              <input
                type="text"
                value={metaForm.category}
                onChange={(event) => updateMetaForm('category', event.target.value)}
                placeholder="Legal"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700">Status</label>
              <select
                value={metaForm.status}
                onChange={(event) => updateMetaForm('status', event.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
              >
                <option value="active">Active</option>
                <option value="expired">Expired</option>
                <option value="terminated">Terminated</option>
                <option value="archived">Archived</option>
              </select>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-700">Dates</p>
            <div className="mt-2 grid gap-3 md:grid-cols-3">
              {[
                ['uploaded_date', 'Uploaded'],
                ['signed_date', 'Signed'],
                ['effective_date', 'Effective'],
                ['expiration_date', 'Expiration'],
                ['termination_date', 'Termination'],
                ['archived_date', 'Archived'],
              ].map(([key, label]) => (
                <div key={key}>
                  <label className="block text-xs text-gray-600">{label}</label>
                  <input
                    type="date"
                    value={metaForm.dates[key] || ''}
                    onChange={(event) => updateMetaForm(`dates.${key}`, event.target.value)}
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-700">Signing</p>
            <div className="mt-2 grid gap-3 md:grid-cols-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={metaForm.signing.is_signed}
                  onChange={(event) => updateMetaForm('signing.is_signed', event.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600"
                />
                Signed
              </label>
              <div>
                <label className="block text-xs text-gray-600">Signature type</label>
                <select
                  value={metaForm.signing.signature_type}
                  onChange={(event) => updateMetaForm('signing.signature_type', event.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="wet">Wet</option>
                  <option value="digital">Digital</option>
                  <option value="esign">eSign</option>
                </select>
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {metaForm.signing.signatories.map((signatory, index) => (
                <div key={index} className="grid gap-2 md:grid-cols-3">
                  <input
                    type="text"
                    value={signatory.name}
                    onChange={(event) => updateSignatory(index, 'name', event.target.value)}
                    placeholder="Name"
                    className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                  <input
                    type="text"
                    value={signatory.role}
                    onChange={(event) => updateSignatory(index, 'role', event.target.value)}
                    placeholder="Role"
                    className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                  <input
                    type="text"
                    value={signatory.organization}
                    onChange={(event) => updateSignatory(index, 'organization', event.target.value)}
                    placeholder="Organization"
                    className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
              ))}
              <button
                type="button"
                onClick={addSignatory}
                className="text-xs font-semibold text-blue-600"
              >
                + Add signatory
              </button>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-700">Compliance</p>
            <div className="mt-2 grid gap-3 md:grid-cols-3">
              <div>
                <label className="block text-xs text-gray-600">Jurisdiction</label>
                <input
                  type="text"
                  value={metaForm.compliance.jurisdiction}
                  onChange={(event) => updateMetaForm('compliance.jurisdiction', event.target.value)}
                  placeholder="US-NY"
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600">Retention end date</label>
                <input
                  type="date"
                  value={metaForm.compliance.retention_end_date}
                  onChange={(event) => updateMetaForm('compliance.retention_end_date', event.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={metaForm.compliance.legal_hold}
                  onChange={(event) => updateMetaForm('compliance.legal_hold', event.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600"
                />
                Legal hold
              </label>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700">Notes</label>
            <textarea
              value={metaForm.notes}
              onChange={(event) => updateMetaForm('notes', event.target.value)}
              rows={2}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>

          {status.error && <p className="text-sm text-red-600">{status.error}</p>}
          {status.success && <p className="text-sm text-green-600">{status.success}</p>}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setStep('preflight')}
              className="inline-flex items-center justify-center rounded-md border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700"
            >
              Back
            </button>
            <button
              type="submit"
              disabled={status.loading}
              className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
            >
              {status.loading ? 'Saving…' : 'Save document'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
};

export default DmsUploadPanel;
