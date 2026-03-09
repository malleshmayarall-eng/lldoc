"""
Viewer App — Authentication

Custom DRF authentication classes for the viewer system.

Two authentication methods:
1. ViewerSessionAuthentication — for email_otp / invite_only viewers
   Header: Authorization: ViewerSession <session_token>
   Query:  ?session=<session_token>

2. ViewerTokenAuthentication — for public viewers
   Query:  ?token=<viewer_token>
   Header: Authorization: ViewerToken <viewer_token>

These return a lightweight "ViewerUser" wrapper (not a Django User) that
carries the viewer_token and session info for permission checks.
"""

from rest_framework import authentication, exceptions
from .models import ViewerToken, ViewerSession


class ViewerUser:
    """
    Lightweight user-like object for viewer authentication.
    
    DRF expects `request.user` to have `is_authenticated`.
    This provides a non-Django-User object that carries viewer context.
    """
    def __init__(self, viewer_token, session=None, email=None):
        self.viewer_token = viewer_token
        self.session = session
        self.email = email or (session.email if session else None)
        self.is_authenticated = True
        self.is_staff = False
        self.is_superuser = False
        # Viewer role info
        self.role = viewer_token.role
        self.allowed_actions = viewer_token.allowed_actions
        self.document = viewer_token.document
        self.is_viewer = True

    @property
    def pk(self):
        return str(self.viewer_token.id)

    @property
    def id(self):
        return self.pk

    def __str__(self):
        return f"Viewer({self.email or 'anonymous'})"

    def get_full_name(self):
        return self.viewer_token.recipient_name or self.email or 'Anonymous Viewer'

    def has_perm(self, perm, obj=None):
        return False

    def has_module_perms(self, app_label):
        return False


class ViewerSessionAuthentication(authentication.BaseAuthentication):
    """
    Authenticate via ViewerSession token.
    
    Usage:
        Authorization: ViewerSession abc123...
        or query param: ?session=abc123...
    """
    keyword = 'ViewerSession'

    def authenticate(self, request):
        # Try header first
        auth_header = authentication.get_authorization_header(request).decode('utf-8')
        if auth_header and auth_header.startswith(f'{self.keyword} '):
            session_token = auth_header[len(f'{self.keyword} '):]
        else:
            # Try query param
            session_token = request.query_params.get('session')

        if not session_token:
            return None  # Let other authenticators try

        try:
            session = ViewerSession.objects.select_related(
                'viewer_token', 'viewer_token__document'
            ).get(session_token=session_token)
        except ViewerSession.DoesNotExist:
            raise exceptions.AuthenticationFailed('Invalid viewer session.')

        if not session.is_valid():
            raise exceptions.AuthenticationFailed('Viewer session expired.')

        if not session.viewer_token.can_access():
            raise exceptions.AuthenticationFailed('Viewer token is no longer valid.')

        viewer_user = ViewerUser(
            viewer_token=session.viewer_token,
            session=session,
            email=session.email,
        )
        return (viewer_user, session)

    def authenticate_header(self, request):
        return self.keyword


class ViewerTokenAuthentication(authentication.BaseAuthentication):
    """
    Authenticate via public ViewerToken (no session needed).
    
    Usage:
        Authorization: ViewerToken abc123...
        or query param: ?token=abc123...
    
    Only works for public-mode tokens (access_mode='public').
    """
    keyword = 'ViewerToken'

    def authenticate(self, request):
        # Try header first
        auth_header = authentication.get_authorization_header(request).decode('utf-8')
        if auth_header and auth_header.startswith(f'{self.keyword} '):
            token_str = auth_header[len(f'{self.keyword} '):]
        else:
            # Try query param
            token_str = request.query_params.get('token')

        if not token_str:
            return None

        try:
            viewer_token = ViewerToken.objects.select_related('document').get(
                token=token_str
            )
        except ViewerToken.DoesNotExist:
            raise exceptions.AuthenticationFailed('Invalid viewer token.')

        if not viewer_token.can_access():
            raise exceptions.AuthenticationFailed('Viewer token expired or inactive.')

        # For non-public tokens, require session auth instead
        if viewer_token.access_mode != 'public' and not viewer_token.password_hash:
            return None  # Let ViewerSessionAuthentication handle it

        viewer_user = ViewerUser(
            viewer_token=viewer_token,
            email=viewer_token.recipient_email,
        )
        return (viewer_user, viewer_token)

    def authenticate_header(self, request):
        return self.keyword
