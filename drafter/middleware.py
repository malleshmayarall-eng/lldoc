from django.utils.deprecation import MiddlewareMixin
import re


class DisableCSRFMiddleware(MiddlewareMixin):
    """
    Middleware to disable CSRF protection for API endpoints.
    """
    def process_request(self, request):
        # Check if the request path starts with /api/
        if request.path.startswith('/api/'):
            setattr(request, '_dont_enforce_csrf_checks', True)
        return None
