from django.apps import AppConfig


class SharingConfig(AppConfig):
    """
    Generic sharing system for Django.
    
    Provides role-based access control and sharing for ANY model using
    Django's contenttypes framework.
    
    Features:
    - User/Team sharing
    - External invitations (email/phone)
    - Secure token-based access
    - Comprehensive access logging
    - Analytics and audit trails
    """
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'sharing'
    verbose_name = 'Sharing & Collaboration'
