"""
Logging Plugin — Structured logging for every email hook.
==========================================================
Always registered.  Emits structured log lines at INFO level so
that email activity is visible in server logs / log aggregators
without any external webhook configuration.
"""
import logging

from ..hookspecs import clm_email_hookimpl

logger = logging.getLogger('clm.email.events')


class LoggingPlugin:
    """Logs every email event at INFO level."""

    @clm_email_hookimpl
    def on_email_received(self, node, message_id, subject, sender, email_date):
        logger.info(
            '[email:received] node=%s subject=%r sender=%s msg_id=%s',
            node.id, subject, sender, message_id,
        )

    @clm_email_hookimpl
    def on_email_processed(self, node, document):
        logger.info(
            '[email:processed] node=%s doc=%s title=%r status=%s',
            node.id, document.id, document.title, document.extraction_status,
        )

    @clm_email_hookimpl
    def on_email_failed(self, node, message_id, error):
        logger.warning(
            '[email:failed] node=%s msg_id=%s error=%s',
            node.id, message_id, error,
        )

    @clm_email_hookimpl
    def on_inbox_checked(self, node, found, skipped, errors):
        level = logging.INFO if not errors else logging.WARNING
        logger.log(
            level,
            '[email:inbox_checked] node=%s found=%d skipped=%d errors=%d',
            node.id, found, skipped, len(errors),
        )
