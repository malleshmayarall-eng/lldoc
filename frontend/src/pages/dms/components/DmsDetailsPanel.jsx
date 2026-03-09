import { useEffect, useState } from 'react';
import { Download, FileText, RefreshCcw } from 'lucide-react';
import { dmsService } from '../../../services/dmsService';

const DmsDetailsPanel = ({ document: selectedDocument }) => {
  const [status, setStatus] = useState({ loading: false, error: null });
  const [details, setDetails] = useState(selectedDocument || null);

  useEffect(() => {
    setDetails(selectedDocument || null);
  }, [selectedDocument]);

  const loadDetails = async (includePdf = false) => {
    if (!selectedDocument?.id) return;
    setStatus({ loading: true, error: null });
    try {
      const data = await dmsService.getDocument(selectedDocument.id, { includePdf });
      setDetails(data);
      setStatus({ loading: false, error: null });
    } catch (error) {
      setStatus({
        loading: false,
        error: error?.response?.data?.detail || error?.message || 'Failed to load details.',
      });
    }
  };

  const handleDownload = async () => {
    if (!selectedDocument?.id) return;
    setStatus({ loading: true, error: null });
    try {
      const blob = await dmsService.downloadDocument(selectedDocument.id);
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement('a');
      link.href = url;
      link.download = `${details?.title || details?.original_filename || 'document'}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
      setStatus({ loading: false, error: null });
    } catch (error) {
      setStatus({
        loading: false,
        error: error?.response?.data?.detail || error?.message || 'Download failed.',
      });
    }
  };

  if (!details) {
    return null;
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-blue-600" />
            <h2 className="text-lg font-semibold text-gray-900">Document Details</h2>
          </div>
          <p className="mt-1 text-sm text-gray-600">{details.title || details.original_filename}</p>
          <p className="mt-1 text-xs text-gray-500">{details.id}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => loadDetails(false)}
            className="inline-flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => loadDetails(true)}
            className="inline-flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
          >
            Load PDF Base64
          </button>
          <button
            type="button"
            onClick={handleDownload}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700"
          >
            <Download className="h-4 w-4" />
            Download
          </button>
        </div>
      </div>

      {status.error && <p className="mt-3 text-sm text-red-600">{status.error}</p>}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-md border border-gray-200 p-4">
          <p className="text-sm font-semibold text-gray-800">Metadata</p>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs text-gray-700">
            {JSON.stringify(details.metadata || {}, null, 2)}
          </pre>
        </div>
        <div className="rounded-md border border-gray-200 p-4">
          <p className="text-sm font-semibold text-gray-800">Extracted Text</p>
          <p className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs text-gray-700">
            {details.extracted_text || 'No extracted text available.'}
          </p>
        </div>
      </div>

      {details.pdf_base64 && (
        <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-4 text-xs text-gray-700">
          PDF base64 loaded. Length: {details.pdf_base64.length} chars.
        </div>
      )}
    </section>
  );
};

export default DmsDetailsPanel;
