"""
Hook specifications for the CLM input node plugin system.
==========================================================
Every method here is a *hook specification* — a contract that plugins
may implement.  The ``PluginManager`` calls matching implementations
in registration order (or by priority via ``trylast`` / ``tryfirst``).

Markers
-------
- ``@clm_input_hookspec``  — marks a method as a hook *specification*
- ``@clm_input_hookimpl``  — marks a method as a hook *implementation*

Hook Return Conventions
-----------------------
- Hooks that return ``dict`` are *merged* — each plugin can add/override
  keys (later plugins win).
- Hooks that return ``list`` are *concatenated* (e.g., validation errors).
- Hooks that return ``None`` are fire-and-forget side-effects.
"""
import pluggy

PROJECT_NAME = 'clm_input'

clm_input_hookspec = pluggy.HookspecMarker(PROJECT_NAME)
clm_input_hookimpl = pluggy.HookimplMarker(PROJECT_NAME)


class InputHookSpec:
    """
    Declares every hook that the input node document pipeline fires.

    Plugins implement one or more of these methods and decorate them
    with ``@clm_input_hookimpl``.
    """

    # ------------------------------------------------------------------
    # 1. PRE-INGEST — Before a WorkflowDocument is created
    # ------------------------------------------------------------------

    @clm_input_hookspec(firstresult=False)
    def on_pre_ingest(self, node, file_name, file_size, file_type, metadata):
        """
        Fired before a WorkflowDocument is created from an uploaded /
        fetched file.  Plugins can:
        - Reject the file (return ``{'reject': True, 'reason': '...'}``).
        - Rename the file (return ``{'file_name': 'new_name.pdf'}``).
        - Add/override global metadata (return ``{'metadata': {…}}``).

        Parameters
        ----------
        node : WorkflowNode
            The input node receiving this document.
        file_name : str
            Original filename (may be empty for email bodies).
        file_size : int
            File size in bytes.
        file_type : str
            Detected file extension / MIME type.
        metadata : dict
            Mutable dict of global_metadata being assembled.
            Plugins can mutate this directly *or* return overrides.

        Returns
        -------
        dict or None
            ``{'reject': True, 'reason': '...'}`` to reject.
            ``{'metadata': {…}}`` to add global metadata fields.
            ``{'file_name': '...'}`` to rename.
            ``None`` to do nothing.
        """

    # ------------------------------------------------------------------
    # 2. POST-EXTRACT — After AI extraction completes
    # ------------------------------------------------------------------

    @clm_input_hookspec(firstresult=False)
    def on_post_extract(self, node, document, extracted_fields):
        """
        Fired after the AI extraction pipeline finishes for a document.
        Plugins can transform or enrich the extracted metadata.

        Parameters
        ----------
        node : WorkflowNode
        document : WorkflowDocument
            The document (already saved).
        extracted_fields : dict
            Mutable dict of field_name → value from extraction.
            Plugins may add, remove, or modify keys in-place.

        Returns
        -------
        dict or None
            ``{'fields': {…}}`` to merge into extracted_metadata.
            ``None`` to do nothing.
        """

    # ------------------------------------------------------------------
    # 3. VALIDATE — Check extracted data quality
    # ------------------------------------------------------------------

    @clm_input_hookspec(firstresult=False)
    def on_validate(self, node, document, extracted_fields):
        """
        Fired after extraction and any post-extract transforms.
        Plugins return validation issues — the core aggregates them
        and stores them on ``document.global_metadata._plugin_issues``.

        Parameters
        ----------
        node : WorkflowNode
        document : WorkflowDocument
        extracted_fields : dict
            The current extracted_metadata (post-transform).

        Returns
        -------
        list[dict] or None
            Each dict: ``{'field': '...', 'severity': 'error'|'warning'|'info',
                          'message': '...', 'plugin': '...'}``
            Return ``[]`` or ``None`` if no issues.
        """

    # ------------------------------------------------------------------
    # 4. TRANSFORM — Mutate / derive metadata fields
    # ------------------------------------------------------------------

    @clm_input_hookspec(firstresult=False)
    def on_transform(self, node, document):
        """
        Fired after validation.  Plugins can compute derived fields,
        normalise values, etc.  Changes should be made directly on
        ``document.extracted_metadata`` and/or ``document.global_metadata``.

        The document is *not* auto-saved — the caller does a single
        ``document.save()`` after all hooks complete.

        Parameters
        ----------
        node : WorkflowNode
        document : WorkflowDocument
        """

    # ------------------------------------------------------------------
    # 5. DOCUMENT READY — Side-effects after pipeline completes
    # ------------------------------------------------------------------

    @clm_input_hookspec(firstresult=False)
    def on_document_ready(self, node, document):
        """
        Fired once a document is fully processed, validated, and
        transformed — right before it enters the DAG.  Use for
        fire-and-forget side-effects (webhooks, notifications, audit).

        Parameters
        ----------
        node : WorkflowNode
        document : WorkflowDocument
            Fully processed document with final metadata.
        """

    # ------------------------------------------------------------------
    # 6. BATCH COMPLETE — After all documents in a batch are done
    # ------------------------------------------------------------------

    @clm_input_hookspec(firstresult=False)
    def on_batch_complete(self, node, documents, stats):
        """
        Fired once at the end of an input node execution, after all
        documents have been individually processed.

        Parameters
        ----------
        node : WorkflowNode
        documents : list[WorkflowDocument]
            All documents that were processed in this batch.
        stats : dict
            Summary: ``{'total': N, 'ready': N, 'rejected': N,
                        'failed': N, 'issues': N}``
        """

    # ------------------------------------------------------------------
    # 7. ON ERROR — When document processing fails
    # ------------------------------------------------------------------

    @clm_input_hookspec(firstresult=False)
    def on_error(self, node, document, error, stage):
        """
        Fired when any stage of the pipeline fails for a document.

        Parameters
        ----------
        node : WorkflowNode
        document : WorkflowDocument or None
            ``None`` if the error occurred during pre-ingest (before creation).
        error : str
            Human-readable error description.
        stage : str
            One of: 'pre_ingest', 'extract', 'validate', 'transform', 'ready'.
        """
