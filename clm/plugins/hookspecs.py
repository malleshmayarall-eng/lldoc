"""
Hook specifications for the CLM email plugin system.
=====================================================
Every method here is a *hook specification* — a contract that plugins
may implement.  The ``PluginManager`` calls matching implementations
in registration order.

Markers
-------
- ``@clm_email_hookspec``  — marks a method as a hook *specification*
- ``@clm_email_hookimpl``  — marks a method as a hook *implementation*
"""
import pluggy

PROJECT_NAME = 'clm_email'

clm_email_hookspec = pluggy.HookspecMarker(PROJECT_NAME)
clm_email_hookimpl = pluggy.HookimplMarker(PROJECT_NAME)


class EmailHookSpec:
    """
    Declares every hook that the email ingestion pipeline fires.

    Plugins implement one or more of these methods and decorate them
    with ``@clm_email_hookimpl``.
    """

    @clm_email_hookspec
    def on_email_received(self, node, message_id, subject, sender, email_date):
        """
        Fired when a new (non-duplicate) email is fetched from IMAP,
        *before* any WorkflowDocuments are created from it.

        Parameters
        ----------
        node : WorkflowNode
            The input node that owns this email inbox.
        message_id : str
            RFC Message-ID header value.
        subject : str
            Decoded email subject.
        sender : str
            Sender email address.
        email_date : str
            ISO-formatted date string.
        """

    @clm_email_hookspec
    def on_email_processed(self, node, document):
        """
        Fired after a single WorkflowDocument has been created from an
        email (either an attachment or the email body).

        Parameters
        ----------
        node : WorkflowNode
        document : WorkflowDocument
        """

    @clm_email_hookspec
    def on_email_failed(self, node, message_id, error):
        """
        Fired when processing a single email message fails.

        Parameters
        ----------
        node : WorkflowNode
        message_id : str
            RFC Message-ID (may be empty if parsing failed early).
        error : str
            Human-readable error description.
        """

    @clm_email_hookspec
    def on_inbox_checked(self, node, found, skipped, errors):
        """
        Fired once at the end of a complete inbox poll, regardless of
        whether any new emails were found.

        Parameters
        ----------
        node : WorkflowNode
        found : int
            Number of new documents created in this poll.
        skipped : int
            Number of emails skipped (already processed / duplicate).
        errors : list[str]
            Any error messages accumulated during the poll.
        """
