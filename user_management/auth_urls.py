from django.urls import path
from . import auth_views

urlpatterns = [
    path('login/', auth_views.login_view, name='login'),
    path('logout/', auth_views.logout_view, name='logout'),
    path('me/', auth_views.current_user_view, name='current-user'),
    path('verify/', auth_views.verify_session_view, name='verify-session'),
    path('change-password/', auth_views.change_password_view, name='change-password'),
    path('session-from-jwt/', auth_views.session_from_jwt_view, name='session-from-jwt'),
    # Email-based 2FA at login
    path('send-login-otp/', auth_views.send_login_otp_view, name='send-login-otp'),
    path('verify-login-otp/', auth_views.verify_login_otp_view, name='verify-login-otp'),
    path('two-factor/toggle/', auth_views.toggle_two_factor_view, name='toggle-two-factor'),
    # Passwordless email OTP login
    path('request-email-login-otp/', auth_views.request_email_login_otp_view, name='request-email-login-otp'),
]
