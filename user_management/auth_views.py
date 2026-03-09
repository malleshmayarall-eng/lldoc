from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.models import User
from django.contrib.auth.hashers import make_password, check_password
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import AllowAny, IsAuthenticated
from user_management.models import UserProfile, LoginOTP
from user_management.serializers import UserProfileSerializer
import base64
import json
import random
import logging
from datetime import timedelta

logger = logging.getLogger(__name__)


@csrf_exempt
@api_view(['POST'])
@permission_classes([AllowAny])
def login_view(request):
    """
    Login endpoint
    """
    email = request.data.get('email')
    password = request.data.get('password')
    
    if not email or not password:
        return Response(
            {'message': 'Email and password are required'},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    # Try to find user by email
    try:
        user = User.objects.get(email=email)
    except User.DoesNotExist:
        return Response(
            {'message': 'Invalid email or password'},
            status=status.HTTP_401_UNAUTHORIZED
        )
    
    # Get user profile
    try:
        user_profile = UserProfile.objects.select_related('organization', 'role').get(user=user)
    except UserProfile.DoesNotExist:
        return Response(
            {'message': 'User profile not found'},
            status=status.HTTP_404_NOT_FOUND
        )
    
    # Check if user is active
    if not user_profile.is_active:
        return Response(
            {'message': 'Account is deactivated. Please contact your administrator.'},
            status=status.HTTP_403_FORBIDDEN
        )

    # Check account lockout
    if user_profile.account_locked_until and user_profile.account_locked_until > timezone.now():
        remaining = int((user_profile.account_locked_until - timezone.now()).total_seconds() / 60) + 1
        return Response(
            {'message': f'Account is temporarily locked. Try again in {remaining} minutes.'},
            status=status.HTTP_429_TOO_MANY_REQUESTS
        )
    
    # Authenticate
    if user.check_password(password):
        # Check if two-factor authentication is enabled
        if user_profile.two_factor_enabled:
            # Generate and send OTP instead of logging in immediately
            otp_code = f"{random.randint(0, 999999):06d}"
            otp_hash = make_password(otp_code)

            # Invalidate any existing unused OTPs for this user
            LoginOTP.objects.filter(user=user, is_used=False).update(is_used=True)

            LoginOTP.objects.create(
                user=user,
                otp_hash=otp_hash,
                expires_at=timezone.now() + timedelta(minutes=10),
            )

            # Send OTP email via communications app
            try:
                from communications.dispatch import send_alert
                send_alert(
                    category='system.info',
                    recipient=user,
                    title=f'Your login verification code: {otp_code}',
                    message=(
                        f'Your one-time login code is: {otp_code}\n\n'
                        f'This code expires in 10 minutes.\n'
                        f'If you did not attempt to log in, please change your password immediately.'
                    ),
                    priority='high',
                    metadata={
                        'otp_code': otp_code,
                        'type': 'login_otp',
                    },
                    email=True,
                )
            except Exception as exc:
                logger.error('Failed to send login OTP email to %s: %s', user.email, exc)

            return Response({
                'message': 'Verification code sent to your email',
                'requires_otp': True,
                'email': _mask_email(user.email),
            })

        # No 2FA — log in immediately
        login(request, user)
        
        # Update login tracking
        user_profile.login_count += 1
        user_profile.failed_login_attempts = 0
        user_profile.save(update_fields=['login_count', 'failed_login_attempts'])
        
        # Serialize user data
        serializer = UserProfileSerializer(user_profile)
        
        return Response({
            'message': 'Login successful',
            'user': serializer.data
        })
    else:
        # Track failed attempts
        user_profile.failed_login_attempts += 1
        update_fields = ['failed_login_attempts']

        # Lock account after 10 consecutive failures
        if user_profile.failed_login_attempts >= 10:
            user_profile.account_locked_until = timezone.now() + timedelta(minutes=30)
            update_fields.append('account_locked_until')

        user_profile.save(update_fields=update_fields)

        return Response(
            {'message': 'Invalid email or password'},
            status=status.HTTP_401_UNAUTHORIZED
        )


@csrf_exempt
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def logout_view(request):
    """
    Logout endpoint
    """
    logout(request)
    return Response({'message': 'Logout successful'})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def current_user_view(request):
    """
    Get current authenticated user
    """
    try:
        user_profile = UserProfile.objects.select_related('user', 'organization', 'role').get(
            user=request.user
        )
        serializer = UserProfileSerializer(user_profile)
        return Response(serializer.data)
    except UserProfile.DoesNotExist:
        return Response(
            {'message': 'User profile not found'},
            status=status.HTTP_404_NOT_FOUND
        )


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def verify_session_view(request):
    """
    Verify if session is valid
    """
    return Response({'valid': True})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def change_password_view(request):
    """
    Change password endpoint
    """
    current_password = request.data.get('current_password')
    new_password = request.data.get('new_password')
    
    if not current_password or not new_password:
        return Response(
            {'message': 'Current password and new password are required'},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    if not request.user.check_password(current_password):
        return Response(
            {'message': 'Current password is incorrect'},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    # Set new password
    request.user.set_password(new_password)
    request.user.save()
    
    return Response({'message': 'Password changed successfully'})


@csrf_exempt
@api_view(['POST'])
@permission_classes([AllowAny])
def session_from_jwt_view(request):
    """
    Create a Django session from a JWT (placeholder implementation).

    NOTE: This decodes the JWT payload without signature verification.
    Replace with a proper JWT library before production use.
    """
    token = request.data.get('token') or request.query_params.get('token')
    if not token:
        return Response({'message': 'token is required'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        parts = token.split('.')
        if len(parts) < 2:
            return Response({'message': 'Invalid token format'}, status=status.HTTP_400_BAD_REQUEST)

        payload_b64 = parts[1]
        padded = payload_b64 + '=' * (-len(payload_b64) % 4)
        payload_json = base64.urlsafe_b64decode(padded.encode('utf-8')).decode('utf-8')
        payload = json.loads(payload_json)

        user_id = payload.get('user_id') or payload.get('sub')
        email = payload.get('email')
        if not user_id and not email:
            return Response({'message': 'Token missing user identifier'}, status=status.HTTP_400_BAD_REQUEST)

        if user_id:
            user = User.objects.filter(id=user_id).first()
        else:
            user = User.objects.filter(email=email).first()

        if not user:
            return Response({'message': 'User not found'}, status=status.HTTP_404_NOT_FOUND)

        login(request, user)

        try:
            user_profile = UserProfile.objects.select_related('organization', 'role').get(user=user)
            serializer = UserProfileSerializer(user_profile)
            return Response({'message': 'Session created', 'user': serializer.data})
        except UserProfile.DoesNotExist:
            return Response({'message': 'Session created', 'user': {'id': user.id, 'email': user.email}})

    except (ValueError, json.JSONDecodeError):
        return Response({'message': 'Invalid token payload'}, status=status.HTTP_400_BAD_REQUEST)


# ─── Login OTP endpoints ───────────────────────────────────────────


@csrf_exempt
@api_view(['POST'])
@permission_classes([AllowAny])
def send_login_otp_view(request):
    """
    Re-send the login OTP.

    POST /api/auth/send-login-otp/
    { "email": "user@example.com" }

    Only works if the user has two_factor_enabled.
    Rate-limited to 1 send per 60 seconds.
    """
    email = request.data.get('email')
    if not email:
        return Response({'message': 'Email is required'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        user = User.objects.get(email=email)
    except User.DoesNotExist:
        # Don't reveal whether user exists
        return Response({'message': 'If the email is registered, a new code has been sent.'})

    try:
        user_profile = UserProfile.objects.get(user=user)
    except UserProfile.DoesNotExist:
        return Response({'message': 'If the email is registered, a new code has been sent.'})

    if not user_profile.two_factor_enabled:
        return Response({'message': 'If the email is registered, a new code has been sent.'})

    # Rate limit: no more than 1 OTP per 60 seconds
    recent = LoginOTP.objects.filter(
        user=user,
        is_used=False,
        created_at__gte=timezone.now() - timedelta(seconds=60),
    ).exists()
    if recent:
        return Response(
            {'message': 'Please wait before requesting a new code.'},
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )

    # Invalidate existing OTPs
    LoginOTP.objects.filter(user=user, is_used=False).update(is_used=True)

    otp_code = f"{random.randint(0, 999999):06d}"
    LoginOTP.objects.create(
        user=user,
        otp_hash=make_password(otp_code),
        expires_at=timezone.now() + timedelta(minutes=10),
    )

    try:
        from communications.dispatch import send_alert
        send_alert(
            category='system.info',
            recipient=user,
            title=f'Your login verification code: {otp_code}',
            message=(
                f'Your one-time login code is: {otp_code}\n\n'
                f'This code expires in 10 minutes.\n'
                f'If you did not attempt to log in, please change your password immediately.'
            ),
            priority='high',
            metadata={'otp_code': otp_code, 'type': 'login_otp'},
            email=True,
        )
    except Exception as exc:
        logger.error('Failed to send login OTP email to %s: %s', email, exc)

    return Response({'message': 'If the email is registered, a new code has been sent.'})


@csrf_exempt
@api_view(['POST'])
@permission_classes([AllowAny])
def request_email_login_otp_view(request):
    """
    Passwordless login — send an OTP to the user's email (no password needed).

    POST /api/auth/request-email-login-otp/
    { "email": "user@example.com" }

    Rate-limited to 1 send per 60 seconds.
    Always returns a generic message to avoid revealing whether the email exists.
    """
    email = request.data.get('email')
    if not email:
        return Response({'message': 'Email is required'}, status=status.HTTP_400_BAD_REQUEST)

    generic_msg = 'If the email is registered, a verification code has been sent.'

    try:
        user = User.objects.get(email=email)
    except User.DoesNotExist:
        return Response({'message': generic_msg})

    # Check if user is active
    try:
        user_profile = UserProfile.objects.get(user=user)
        if not user_profile.is_active:
            return Response({'message': generic_msg})
    except UserProfile.DoesNotExist:
        return Response({'message': generic_msg})

    # Check account lockout
    if user_profile.account_locked_until and user_profile.account_locked_until > timezone.now():
        return Response({'message': generic_msg})

    # Rate limit: no more than 1 OTP per 60 seconds
    recent = LoginOTP.objects.filter(
        user=user,
        is_used=False,
        created_at__gte=timezone.now() - timedelta(seconds=60),
    ).exists()
    if recent:
        return Response(
            {'message': 'Please wait before requesting a new code.'},
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )

    # Invalidate existing OTPs
    LoginOTP.objects.filter(user=user, is_used=False).update(is_used=True)

    otp_code = f"{random.randint(0, 999999):06d}"
    LoginOTP.objects.create(
        user=user,
        otp_hash=make_password(otp_code),
        expires_at=timezone.now() + timedelta(minutes=10),
    )

    try:
        from communications.dispatch import send_alert
        send_alert(
            category='system.info',
            recipient=user,
            title=f'Your login verification code: {otp_code}',
            message=(
                f'Your one-time login code is: {otp_code}\n\n'
                f'This code expires in 10 minutes.\n'
                f'If you did not request this code, you can safely ignore this email.'
            ),
            priority='high',
            metadata={'otp_code': otp_code, 'type': 'email_login_otp'},
            email=True,
        )
    except Exception as exc:
        logger.error('Failed to send email login OTP to %s: %s', email, exc)

    return Response({'message': generic_msg})


@csrf_exempt
@api_view(['POST'])
@permission_classes([AllowAny])
def verify_login_otp_view(request):
    """
    Verify the login OTP and complete authentication.

    POST /api/auth/verify-login-otp/
    { "email": "user@example.com", "otp": "123456" }

    On success: logs the user in (Django session) and returns user profile.
    """
    email = request.data.get('email')
    otp = request.data.get('otp')

    if not email or not otp:
        return Response(
            {'message': 'Email and OTP are required'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        user = User.objects.get(email=email)
    except User.DoesNotExist:
        return Response(
            {'message': 'Invalid email or code'},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    # Find a valid, unused OTP for this user
    valid_otps = LoginOTP.objects.filter(
        user=user,
        is_used=False,
        expires_at__gt=timezone.now(),
    ).order_by('-created_at')

    verified = False
    matched_otp = None
    for login_otp in valid_otps:
        if check_password(otp, login_otp.otp_hash):
            verified = True
            matched_otp = login_otp
            break

    if not verified:
        return Response(
            {'message': 'Invalid or expired code'},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    # Mark OTP as used
    matched_otp.is_used = True
    matched_otp.save(update_fields=['is_used'])

    # Log the user in
    login(request, user)

    # Update login tracking
    try:
        user_profile = UserProfile.objects.select_related('organization', 'role').get(user=user)
        user_profile.login_count += 1
        user_profile.failed_login_attempts = 0
        user_profile.save(update_fields=['login_count', 'failed_login_attempts'])

        serializer = UserProfileSerializer(user_profile)
        return Response({
            'message': 'Login successful',
            'user': serializer.data,
        })
    except UserProfile.DoesNotExist:
        return Response(
            {'message': 'User profile not found'},
            status=status.HTTP_404_NOT_FOUND,
        )


@csrf_exempt
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def toggle_two_factor_view(request):
    """
    Toggle two-factor authentication on or off.

    POST /api/auth/two-factor/toggle/
    { "enabled": true }
    """
    enabled = request.data.get('enabled')
    if enabled is None:
        return Response(
            {'message': '"enabled" field is required (true/false)'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        profile = request.user.profile
    except UserProfile.DoesNotExist:
        return Response({'message': 'User profile not found'}, status=status.HTTP_404_NOT_FOUND)

    profile.two_factor_enabled = bool(enabled)
    profile.save(update_fields=['two_factor_enabled'])

    return Response({
        'message': f'Two-factor authentication {"enabled" if profile.two_factor_enabled else "disabled"}',
        'two_factor_enabled': profile.two_factor_enabled,
    })


# ─── Helpers ────────────────────────────────────────────────────────


def _mask_email(email):
    """Mask an email address for display: 'us***@example.com'."""
    if not email or '@' not in email:
        return '***'
    local, domain = email.split('@', 1)
    if len(local) <= 2:
        masked_local = local[0] + '***'
    else:
        masked_local = local[:2] + '***'
    return f'{masked_local}@{domain}'
