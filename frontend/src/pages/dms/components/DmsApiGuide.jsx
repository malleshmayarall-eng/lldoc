const DmsApiGuide = () => (
  <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
    <details className="group">
      <summary className="cursor-pointer text-lg font-semibold text-gray-900">
        DMS API Guide
      </summary>
      <div className="mt-4 space-y-6 text-sm text-gray-700">
        <div>
          <p className="font-medium text-gray-900">Base URL</p>
          <p className="mt-1 rounded bg-gray-50 px-3 py-2 text-xs text-gray-700">/api/dms/</p>
        </div>

        <div>
          <p className="font-medium text-gray-900">Authentication</p>
          <p className="mt-1">All endpoints require an authenticated session (IsAuthenticated).</p>
        </div>

        <div className="space-y-4">
          <div>
            <p className="font-medium text-gray-900">1a) Preflight Upload (extract only)</p>
            <p className="mt-1 text-xs text-gray-600">POST /api/dms/documents/preflight/ (multipart/form-data)</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li><span className="font-medium">file</span> (required) - PDF file to inspect</li>
              <li><span className="font-medium">title</span> (optional) - title override</li>
              <li><span className="font-medium">metadata</span> (optional) - custom metadata JSON</li>
              <li><span className="font-medium">extract_metadata</span> (optional) - defaults to true</li>
              <li><span className="font-medium">extract_text</span> (optional) - defaults to true</li>
            </ul>
          </div>

          <div>
            <p className="font-medium text-gray-900">1b) Upload PDF (final save)</p>
            <p className="mt-1 text-xs text-gray-600">POST /api/dms/documents/ (multipart/form-data)</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li><span className="font-medium">file</span> (required) - PDF file to store</li>
              <li><span className="font-medium">title</span> (optional) - title override</li>
              <li><span className="font-medium">metadata</span> (optional) - merged JSON payload</li>
              <li><span className="font-medium">extract_metadata</span> (optional) - defaults to true</li>
              <li><span className="font-medium">extract_text</span> (optional) - defaults to true</li>
            </ul>
            <p className="mt-2 text-xs text-gray-600">
              The UI merges extracted PDF metadata with user-entered fields before this final upload.
            </p>
          </div>

          <div>
            <p className="font-medium text-gray-900">2) Search Documents</p>
            <p className="mt-1 text-xs text-gray-600">POST /api/dms/documents/search/</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li><span className="font-medium">query</span> searches metadata_index (and extracted_text when include_text=true)</li>
              <li><span className="font-medium">metadata_filters</span> uses JSON containment matching</li>
              <li><span className="font-medium">include_text</span> toggles full-text search</li>
            </ul>
          </div>

          <div>
            <p className="font-medium text-gray-900">3) Retrieve Document Metadata</p>
            <p className="mt-1 text-xs text-gray-600">GET /api/dms/documents/&lt;id&gt;/?include_pdf=true</p>
          </div>

          <div>
            <p className="font-medium text-gray-900">4) Download PDF</p>
            <p className="mt-1 text-xs text-gray-600">GET /api/dms/documents/&lt;id&gt;/download/</p>
          </div>

          <div>
            <p className="font-medium text-gray-900">5) Document Alerts</p>
            <p className="mt-1 text-xs text-gray-600">GET /api/dms/documents/&lt;id&gt;/alerts/?warning_days=30</p>
            <p className="mt-1 text-xs text-gray-600">GET /api/dms/documents/alerts/?warning_days=30</p>
            <p className="mt-2 text-xs text-gray-600">
              Alerts are generated from effective_date, expiration_date, and termination_date.
            </p>
          </div>
        </div>

        <div>
          <p className="font-medium text-gray-900">Extracted Metadata</p>
          <p className="mt-1">title, author, subject, creator, producer, keywords, page_count, raw_metadata</p>
        </div>

        <div>
          <p className="font-medium text-gray-900">Common Errors</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li><span className="font-medium">400</span> - Missing file or invalid payload</li>
            <li><span className="font-medium">401</span> - Not authenticated</li>
            <li><span className="font-medium">404</span> - Document not found</li>
          </ul>
        </div>
      </div>
    </details>
  </section>
);

export default DmsApiGuide;
