"""
Viewer App — URL Configuration

All endpoints are under /api/viewer/

PUBLIC (no auth):
    GET    resolve/<token>/           → resolve token info
    GET    public/pdf/<token>/        → stream PDF (public tokens)
    POST   otp/send/                  → send OTP email
    POST   otp/verify/                → verify OTP → session
    POST   password/verify/           → verify password → session
    POST   invitation/accept/         → accept invitation → session
    POST   ai-chat/                   → AI chat (with token/session in body)

AUTHENTICATED VIEWER (ViewerSession header):
    GET    document/                  → document info
    GET    document/pdf/              → stream PDF
    GET    shared-documents/          → list docs shared with email

TOKEN MANAGEMENT (Django session auth — document owner):
    GET    tokens/                    → list my tokens
    POST   tokens/                    → create token
    GET    tokens/<id>/               → token detail
    PATCH  tokens/<id>/               → update token
    DELETE tokens/<id>/               → revoke token
    GET    tokens/<id>/analytics/     → token analytics
    POST   tokens/<id>/resend-invitation/ → resend email
    GET    tokens/by-document/<id>/   → tokens for a document
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    ViewerTokenViewSet,
    resolve_viewer_token,
    public_pdf_view,
    legacy_share_pdf_view,
    otp_send,
    otp_verify,
    password_verify,
    invitation_accept,
    viewer_document_info,
    viewer_document_pdf,
    shared_documents_list,
    viewer_ai_chat,
    viewer_document_structure,
    viewer_comments_list,
    viewer_comment_create,
    viewer_comment_delete,
    viewer_comment_resolve,
    viewer_document_approve,
    viewer_document_approvals,
    viewer_alerts_list,
    viewer_alert_mark_read,
    viewer_alerts_mark_all_read,
    editor_review_comments,
    editor_reply_comment,
    editor_resolve_comment,
    editor_delete_comment,
    editor_create_comment,
    editor_alerts_list,
    editor_alert_mark_read,
    editor_alerts_mark_all_read,
    share_for_approval,
    document_activity_feed,
)

router = DefaultRouter()
router.register(r'tokens', ViewerTokenViewSet, basename='viewer-token')

urlpatterns = [
    # ── Public (no auth) ─────────────────────────────────────────
    path('resolve/<str:token>/', resolve_viewer_token, name='viewer-resolve'),
    path('public/pdf/<str:token>/', public_pdf_view, name='viewer-public-pdf'),
    path('legacy/pdf/<str:token>/', legacy_share_pdf_view, name='viewer-legacy-pdf'),

    # ── OTP flow ─────────────────────────────────────────────────
    path('otp/send/', otp_send, name='viewer-otp-send'),
    path('otp/verify/', otp_verify, name='viewer-otp-verify'),

    # ── Password flow ────────────────────────────────────────────
    path('password/verify/', password_verify, name='viewer-password-verify'),

    # ── Invitation flow ──────────────────────────────────────────
    path('invitation/accept/', invitation_accept, name='viewer-invitation-accept'),

    # ── Authenticated viewer ─────────────────────────────────────
    path('document/', viewer_document_info, name='viewer-document-info'),
    path('document/pdf/', viewer_document_pdf, name='viewer-document-pdf'),
    path('shared-documents/', shared_documents_list, name='viewer-shared-documents'),

    # ── AI Chat ──────────────────────────────────────────────────
    path('ai-chat/', viewer_ai_chat, name='viewer-ai-chat'),

    # ── Document structure (commentator view) ────────────────────
    path('structure/<str:token>/', viewer_document_structure, name='viewer-structure'),

    # ── Comments CRUD ────────────────────────────────────────────
    path('comments/<str:token>/', viewer_comments_list, name='viewer-comments-list'),
    path('comments/', viewer_comment_create, name='viewer-comment-create'),
    path('comments/<uuid:comment_id>/delete/', viewer_comment_delete, name='viewer-comment-delete'),
    path('comments/<uuid:comment_id>/resolve/', viewer_comment_resolve, name='viewer-comment-resolve'),

    # ── Document approval ────────────────────────────────────────────
    path('approve/', viewer_document_approve, name='viewer-approve'),
    path('approvals/<str:token>/', viewer_document_approvals, name='viewer-approvals'),

    # ── Alerts ───────────────────────────────────────────────────────
    path('alerts/<str:token>/', viewer_alerts_list, name='viewer-alerts-list'),
    path('alerts/<uuid:alert_id>/read/', viewer_alert_mark_read, name='viewer-alert-read'),
    path('alerts/<str:token>/read-all/', viewer_alerts_mark_all_read, name='viewer-alerts-read-all'),

    # ── Review Comments (document owner — Django session auth) ───────
    path('review-comments/<uuid:document_id>/', editor_review_comments, name='editor-review-comments'),
    path('review-comments/<uuid:document_id>/create/', editor_create_comment, name='editor-create-comment'),
    path('review-comments/<uuid:comment_id>/reply/', editor_reply_comment, name='editor-reply-comment'),
    path('review-comments/<uuid:comment_id>/resolve/', editor_resolve_comment, name='editor-resolve-comment'),
    path('review-comments/<uuid:comment_id>/delete/', editor_delete_comment, name='editor-delete-comment'),

    # ── Editor Alerts (document owner — Django session auth) ─────────
    path('editor-alerts/', editor_alerts_list, name='editor-alerts-list'),
    path('editor-alerts/<uuid:alert_id>/read/', editor_alert_mark_read, name='editor-alert-read'),
    path('editor-alerts/read-all/', editor_alerts_mark_all_read, name='editor-alerts-read-all'),

    # ── Share for Approval (document owner — Django session auth) ────
    path('share-for-approval/', share_for_approval, name='share-for-approval'),

    # ── Activity Feed (document owner — Django session auth) ─────────
    path('activity-feed/<uuid:document_id>/', document_activity_feed, name='activity-feed'),

    # ── Token management (router) ────────────────────────────────────
    path('', include(router.urls)),
]
