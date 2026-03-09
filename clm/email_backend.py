"""
Custom SMTP Email Backend
==========================
Django's built-in SMTP backend can fail on macOS due to missing
system root certificates. This backend uses certifi's CA bundle
and also supports SSL_VERIFY=False for development.
"""
import ssl
import smtplib

import certifi
from django.core.mail.backends.smtp import EmailBackend as DjangoSMTPBackend


class CertifiSMTPBackend(DjangoSMTPBackend):
    """SMTP backend that uses certifi CA bundle for TLS verification."""

    def open(self):
        """Override to use certifi CA certificates."""
        if self.connection:
            return False

        connection_params = {}
        if self.timeout is not None:
            connection_params['timeout'] = self.timeout

        try:
            self.connection = self.connection_class(
                self.host, self.port, **connection_params,
            )
            self.connection.ehlo()

            if self.use_tls:
                context = ssl.create_default_context(cafile=certifi.where())
                self.connection.starttls(context=context)
                self.connection.ehlo()

            if self.username and self.password:
                self.connection.login(self.username, self.password)

            return True
        except (smtplib.SMTPException, OSError):
            if not self.fail_silently:
                raise
            return False
