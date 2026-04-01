from django.db import models
from django.contrib.auth.models import User
from django.core.validators import EmailValidator
import uuid
import copy


# ──────────────────────────────────────────────────────────────────────
# Domain Feature Registry
# ──────────────────────────────────────────────────────────────────────

DOMAIN_CHOICES = [
    ('default', 'Default (All Features)'),
    ('procurement', 'Procurement'),
    ('legal', 'Legal'),
    ('finance', 'Finance & Banking'),
    ('healthcare', 'Healthcare'),
    ('real_estate', 'Real Estate'),
    ('insurance', 'Insurance'),
    ('technology', 'Technology'),
    ('education', 'Education'),
    ('government', 'Government'),
    ('consulting', 'Consulting'),
]

# Master feature schema — every flag that exists in the system.
# True = enabled by default when no domain profile overrides it.
ALL_FEATURES = {
    'apps': {
        'documents':      True,
        'clm':            True,
        'dms':            True,
        'fileshare':      True,
        'viewer':         True,
        'communications': True,
        'aiservices':     True,
        'sharing':        True,
        'workflows':      True,
    },
    'editor': {
        'ai_chat':              True,
        'ai_scoring':           True,
        'ai_rewrite':           True,
        'ai_paragraph_analyze': True,
        'tables':               True,
        'latex':                True,
        'images':               True,
        'file_components':      True,
        'section_references':   True,
        'branching':            True,
        'quick_latex':          True,
        'header_footer_pdf':    True,
        'header_footer_text':   True,
        'export_pdf':           True,
        'change_tracking':      True,
        'comments':             True,
        'approval_workflow':    True,
    },
    'dashboard': {
        'workflow_stats': True,
        'clm_stats':     True,
        'recent_docs':   True,
        'team_activity':  True,
        'ai_insights':    True,
    },
}

# Per-domain default overrides — only list the flags that differ from
# ALL_FEATURES.  Missing keys inherit the master defaults.
DOMAIN_DEFAULTS = {
    'procurement': {
        # Procurement: Quick LaTeX is the PRIMARY document creation method.
        # CLM workflows are a core feature.  Standard editor is secondary.
        # Advanced/niche features hidden; easy features highlighted.
        'apps': {
            'dms':            True,   # PDF ingestion for vendor docs
            'fileshare':      True,   # Vendor document storage
            'viewer':         True,   # External vendor review links
            'communications': True,   # Alerts on approvals
        },
        'editor': {
            # Quick LaTeX is the primary mode — keep it on.
            'quick_latex':          True,
            # Standard LaTeX blocks inside standard editor — off (use quick-latex instead)
            'latex':                False,
            # Basic features that stay visible
            'tables':               True,
            'images':               True,
            'comments':             True,
            'export_pdf':           True,
            'change_tracking':      True,
            'header_footer_pdf':    True,
            'header_footer_text':   True,
            # CLM-related editor features
            'approval_workflow':    True,
            # Advanced / less relevant features hidden by default
            'ai_chat':              True,    # AI assist for drafting
            'ai_rewrite':           True,    # Rewrite suggestions
            'ai_scoring':           False,   # Legal scoring — not primary
            'ai_paragraph_analyze': False,   # Deep legal analysis — not primary
            'branching':            False,   # Document branching — advanced
            'section_references':   False,   # Cross-references — advanced
            'file_components':      False,   # Embedded files — advanced
        },
        'dashboard': {
            'workflow_stats': True,
            'clm_stats':     True,
            'recent_docs':   True,
            'team_activity':  True,
            'ai_insights':    False,  # Legal AI insights — not primary
        },
    },
    'legal': {
        # Legal firms get everything — the core use-case.
    },
    'finance': {
        'editor': {
            'latex': False,
            'quick_latex': False,
        },
    },
    'healthcare': {
        'apps': {
            'clm': False,
        },
        'editor': {
            'latex': False,
            'quick_latex': False,
        },
        'dashboard': {
            'clm_stats': False,
        },
    },
    'real_estate': {
        'editor': {
            'latex': False,
            'quick_latex': False,
            'ai_scoring': False,
        },
        'dashboard': {
            'clm_stats': False,
        },
    },
    'insurance': {
        'editor': {
            'latex': False,
            'quick_latex': False,
        },
    },
    'technology': {
        # Tech companies get everything.
    },
    'education': {
        'apps': {
            'clm': False,
        },
        'editor': {
            'branching': False,
        },
        'dashboard': {
            'clm_stats': False,
        },
    },
    'government': {
        'editor': {
            'latex': False,
            'quick_latex': False,
        },
    },
    'consulting': {
        # Consulting firms get everything.
    },
    'default': {
        # Default — everything enabled, the actual system without any domain-specific config.
    },
}


def get_domain_feature_defaults(domain: str) -> dict:
    """
    Return the full feature-flag dict for *domain* by deep-merging
    DOMAIN_DEFAULTS[domain] on top of ALL_FEATURES.
    """
    base = copy.deepcopy(ALL_FEATURES)
    overrides = DOMAIN_DEFAULTS.get(domain, {})
    for category, flags in overrides.items():
        if category in base:
            base[category].update(flags)
    return base


def resolve_feature_flags(domain: str, overrides: dict | None = None) -> dict:
    """
    Resolve the final feature flags for an organisation.

    1. Start with domain defaults.
    2. Deep-merge organisation-level overrides (if any).
    3. Strip any ``__removed__`` sentinel values.
    """
    result = get_domain_feature_defaults(domain)
    if overrides:
        for category, flags in overrides.items():
            if category in result and isinstance(flags, dict):
                for key, value in flags.items():
                    if value == '__removed__':
                        # Revert to domain default — just skip.
                        continue
                    result[category][key] = value
    return result


class Organization(models.Model):
    """
    Organization/Company that users belong to.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    
    # Organization Details
    name = models.CharField(max_length=255, unique=True, help_text="Organization name")
    legal_name = models.CharField(max_length=255, null=True, blank=True, help_text="Legal business name")
    organization_type = models.CharField(max_length=100, choices=[
        ('law_firm', 'Law Firm'),
        ('corporation', 'Corporation'),
        ('government', 'Government Agency'),
        ('nonprofit', 'Non-Profit'),
        ('individual', 'Individual/Sole Practitioner'),
        ('other', 'Other'),
    ], default='corporation')
    
    # Domain — controls which features / editor tools are available.
    domain = models.CharField(
        max_length=50,
        choices=DOMAIN_CHOICES,
        default='default',
        help_text="Industry domain — determines default feature flags",
    )
    feature_overrides = models.JSONField(
        default=dict,
        blank=True,
        help_text="Per-org overrides on top of domain defaults. Use __removed__ to revert a flag.",
    )
    
    # Contact Information
    email = models.EmailField(validators=[EmailValidator()], null=True, blank=True)
    phone = models.CharField(max_length=20, null=True, blank=True)
    website = models.URLField(null=True, blank=True)
    
    # Address
    address_line1 = models.CharField(max_length=255, null=True, blank=True)
    address_line2 = models.CharField(max_length=255, null=True, blank=True)
    city = models.CharField(max_length=100, null=True, blank=True)
    state = models.CharField(max_length=100, null=True, blank=True)
    postal_code = models.CharField(max_length=20, null=True, blank=True)
    country = models.CharField(max_length=100, default='USA')
    
    # Business Information
    tax_id = models.CharField(max_length=50, null=True, blank=True, help_text="Tax ID/EIN")
    registration_number = models.CharField(max_length=100, null=True, blank=True)
    
    # Logo and Branding
    logo = models.ImageField(upload_to='organizations/logos/%Y/%m/', null=True, blank=True)
    primary_color = models.CharField(max_length=7, default='#1E40AF', help_text="Hex color code")
    secondary_color = models.CharField(max_length=7, default='#6B7280', help_text="Hex color code")
    
    # Subscription/Plan
    subscription_plan = models.CharField(max_length=50, choices=[
        ('free', 'Free'),
        ('basic', 'Basic'),
        ('professional', 'Professional'),
        ('enterprise', 'Enterprise'),
    ], default='free')
    max_users = models.IntegerField(default=5, help_text="Maximum number of users allowed")
    max_documents = models.IntegerField(default=100, help_text="Maximum number of documents")
    
    # Settings
    is_active = models.BooleanField(default=True)
    settings = models.JSONField(default=dict, blank=True, help_text="Organization-specific settings")
    
    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        ordering = ['name']
        indexes = [
            models.Index(fields=['name']),
            models.Index(fields=['is_active']),
        ]
    
    def __str__(self):
        return self.name
    
    def get_active_users_count(self):
        """Get count of active users in this organization."""
        return self.user_profiles.filter(is_active=True).count()

    def get_feature_flags(self) -> dict:
        """Return the resolved feature flags for this organisation."""
        return resolve_feature_flags(self.domain, self.feature_overrides)

    def is_feature_enabled(self, category: str, feature: str) -> bool:
        """Check if a specific feature is enabled.

        Usage::

            org.is_feature_enabled('apps', 'clm')
            org.is_feature_enabled('editor', 'latex')
        """
        flags = self.get_feature_flags()
        return flags.get(category, {}).get(feature, False)


class Role(models.Model):
    """
    User roles with permissions.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    
    # Role Details
    name = models.CharField(max_length=100, unique=True, help_text="Role name (e.g., 'Admin', 'Editor')")
    display_name = models.CharField(max_length=100, help_text="Human-readable role name")
    description = models.TextField(null=True, blank=True)
    
    # Role Type
    role_type = models.CharField(max_length=50, choices=[
        ('system_admin', 'System Administrator'),
        ('org_admin', 'Organization Administrator'),
        ('legal_reviewer', 'Legal Reviewer'),
        ('editor', 'Editor'),
        ('viewer', 'Viewer'),
        ('guest', 'Guest'),
        ('custom', 'Custom Role'),
    ], default='viewer')
    
    # Permissions
    permissions = models.JSONField(default=dict, help_text="Permission settings")
    # Example: {
    #   "documents": {"create": true, "read": true, "update": true, "delete": false},
    #   "users": {"create": false, "read": true, "update": false, "delete": false},
    #   "settings": {"read": true, "update": false}
    # }
    
    # Role Settings
    is_system_role = models.BooleanField(default=False, help_text="System-defined role (cannot be deleted)")
    is_active = models.BooleanField(default=True)
    priority = models.IntegerField(default=0, help_text="Higher number = higher priority")
    
    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        ordering = ['-priority', 'name']
        indexes = [
            models.Index(fields=['name']),
            models.Index(fields=['role_type']),
        ]
    
    def __str__(self):
        return self.display_name


class UserProfile(models.Model):
    """
    Extended user profile with organization and role information.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    
    # Organization and Role
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name='user_profiles')
    role = models.ForeignKey(Role, on_delete=models.PROTECT, related_name='users')
    
    # Personal Information
    job_title = models.CharField(max_length=100, null=True, blank=True)
    department = models.CharField(max_length=100, null=True, blank=True)
    phone = models.CharField(max_length=20, null=True, blank=True)
    mobile = models.CharField(max_length=20, null=True, blank=True)
    
    # Profile Picture
    avatar = models.ImageField(upload_to='users/avatars/%Y/%m/', null=True, blank=True)
    
    # Professional Details
    bar_number = models.CharField(max_length=50, null=True, blank=True, help_text="Bar association number")
    license_state = models.CharField(max_length=100, null=True, blank=True)
    specialization = models.CharField(max_length=255, null=True, blank=True)
    
    # User Preferences
    timezone = models.CharField(max_length=50, default='UTC')
    language = models.CharField(max_length=10, default='en')
    date_format = models.CharField(max_length=20, default='YYYY-MM-DD')
    notifications_enabled = models.BooleanField(default=True)
    email_notifications = models.BooleanField(default=True)
    
    # User Settings
    preferences = models.JSONField(default=dict, blank=True, help_text="User-specific preferences")
    # Example: {"theme": "dark", "sidebar_collapsed": false, "auto_save": true}
    
    # Account Status
    is_active = models.BooleanField(default=True)
    is_verified = models.BooleanField(default=False, help_text="Email verified")
    email_verified_at = models.DateTimeField(null=True, blank=True)
    
    # Login Tracking
    last_login_ip = models.GenericIPAddressField(null=True, blank=True)
    last_login_location = models.CharField(max_length=255, null=True, blank=True)
    login_count = models.IntegerField(default=0)
    failed_login_attempts = models.IntegerField(default=0)
    account_locked_until = models.DateTimeField(null=True, blank=True)
    
    # Security
    two_factor_enabled = models.BooleanField(default=False)
    password_changed_at = models.DateTimeField(null=True, blank=True)
    force_password_change = models.BooleanField(default=False)
    
    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    deactivated_at = models.DateTimeField(null=True, blank=True)
    
    class Meta:
        ordering = ['user__last_name', 'user__first_name']
        indexes = [
            models.Index(fields=['organization', 'is_active']),
            models.Index(fields=['role']),
        ]
    
    def __str__(self):
        return f"{self.user.get_full_name()} - {self.organization.name}"
    
    def get_full_name(self):
        """Get user's full name."""
        return self.user.get_full_name() or self.user.username
    
    def has_permission(self, resource, action):
        """Check if user has specific permission."""
        permissions = self.role.permissions.get(resource, {})
        return permissions.get(action, False)


class OrganizationDocumentSettings(models.Model):
    """
    Organization-level document system settings.
    Controls defaults and compliance for all documents in the organization.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.OneToOneField(
        Organization,
        on_delete=models.CASCADE,
        related_name='document_settings'
    )

    # Defaults
    default_document_type = models.CharField(max_length=100, default='contract')
    default_status = models.CharField(max_length=50, default='draft')
    default_language = models.CharField(max_length=10, default='en')

    # Governance
    require_etag = models.BooleanField(default=True)
    enable_versioning = models.BooleanField(default=True)
    allow_external_sharing = models.BooleanField(default=False)
    retention_days = models.IntegerField(default=365, help_text="Retention policy in days")

    # AI defaults
    default_ai_model = models.CharField(
        max_length=100, default='gemini-2.5-flash',
        help_text='Default AI model for CLM nodes, document analysis, etc.',
    )

    # Performance/limits
    auto_save_interval_seconds = models.IntegerField(default=30)
    max_file_size_mb = models.IntegerField(default=25)
    allowed_file_types = models.JSONField(default=list, blank=True)

    # Misc
    preferences = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['organization']

    def __str__(self):
        return f"Document settings for {self.organization.name}"


class UserDocumentSettings(models.Model):
    """
    User-level document system settings.
    Overrides organization defaults for a user.
    """
    VIEW_CHOICES = [
        ('edit', 'Edit'),
        ('preview', 'Preview'),
        ('diff', 'Diff'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    profile = models.OneToOneField(
        UserProfile,
        on_delete=models.CASCADE,
        related_name='document_settings'
    )

    # UX preferences
    auto_save_enabled = models.BooleanField(default=True)
    auto_save_interval_seconds = models.IntegerField(default=30)
    change_tracking_enabled = models.BooleanField(default=True)
    show_change_markers = models.BooleanField(default=True)
    default_view = models.CharField(max_length=20, choices=VIEW_CHOICES, default='edit')

    # AI/assistant preferences
    ai_assist_enabled = models.BooleanField(default=True)
    notification_on_mentions = models.BooleanField(default=True)

    # Misc
    preferences = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['profile']

    def __str__(self):
        return f"Document settings for {self.profile.get_full_name()}"


class InputNodeCredential(models.Model):
    """
    Reusable credentials for CLM input node source types.

    Instead of storing secrets (IMAP passwords, API keys, access tokens)
    inside each WorkflowNode.config, users save them once in their profile
    settings.  Nodes then reference a credential by its UUID, and the
    backend resolves the actual secrets at execution time.

    Supported credential_type values mirror the input node source_type:
      email_inbox, google_drive, dropbox, onedrive, s3, ftp
    """
    CREDENTIAL_TYPE_CHOICES = [
        ('email_inbox',  'Email / IMAP'),
        ('google_drive', 'Google Drive'),
        ('dropbox',      'Dropbox'),
        ('onedrive',     'OneDrive / SharePoint'),
        ('s3',           'AWS S3'),
        ('ftp',          'FTP / SFTP'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    profile = models.ForeignKey(
        UserProfile,
        on_delete=models.CASCADE,
        related_name='input_credentials',
    )
    label = models.CharField(
        max_length=120,
        help_text='User-facing name, e.g. "Work Gmail" or "Contracts S3"',
    )
    credential_type = models.CharField(max_length=30, choices=CREDENTIAL_TYPE_CHOICES)
    credentials = models.JSONField(
        default=dict,
        help_text=(
            'Source-specific secrets. Schema depends on credential_type:\n'
            '  email_inbox:  {email_host, email_user, email_password}\n'
            '  google_drive: {google_access, google_api_key, google_credentials_json}\n'
            '  dropbox:      {dropbox_access_token}\n'
            '  onedrive:     {onedrive_access_token}\n'
            '  s3:           {s3_access_key, s3_secret_key, s3_region}\n'
            '  ftp:          {ftp_host, ftp_port, ftp_user, ftp_password, ftp_protocol}'
        ),
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['credential_type', 'label']
        indexes = [
            models.Index(fields=['profile', 'credential_type']),
        ]

    def __str__(self):
        return f"{self.label} ({self.get_credential_type_display()}) — {self.profile}"

    @property
    def redacted(self):
        """Return credentials with secrets masked for safe API output."""
        MASK = '••••••'
        SECRET_KEYS = {
            'email_password', 'google_api_key', 'google_credentials_json',
            'dropbox_access_token', 'onedrive_access_token',
            's3_secret_key', 'ftp_password',
        }
        safe = {}
        for k, v in (self.credentials or {}).items():
            if k in SECRET_KEYS and v:
                safe[k] = MASK
            else:
                safe[k] = v
        return safe


class Team(models.Model):
    """
    Teams within an organization for collaboration.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    
    # Team Details
    name = models.CharField(max_length=255)
    description = models.TextField(null=True, blank=True)
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name='teams')
    
    # Team Lead
    team_lead = models.ForeignKey(UserProfile, on_delete=models.SET_NULL, null=True, blank=True,
                                  related_name='led_teams')
    
    # Members
    members = models.ManyToManyField(UserProfile, related_name='teams', blank=True)
    
    # Team Settings
    is_active = models.BooleanField(default=True)
    is_public = models.BooleanField(default=False, help_text="Visible to all org members")
    
    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(UserProfile, on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name='created_teams')
    
    class Meta:
        ordering = ['organization', 'name']
        unique_together = ['organization', 'name']
        indexes = [
            models.Index(fields=['organization', 'is_active']),
        ]
    
    def __str__(self):
        return f"{self.name} ({self.organization.name})"
    
    def get_members_count(self):
        """Get count of team members."""
        return self.members.count()


class InvitationToken(models.Model):
    """
    Invitation tokens for new users to join an organization.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    
    # Invitation Details
    email = models.EmailField(validators=[EmailValidator()])
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name='invitations')
    role = models.ForeignKey(Role, on_delete=models.CASCADE)
    
    # Token
    token = models.CharField(max_length=100, unique=True)
    
    # Invitation Status
    is_used = models.BooleanField(default=False)
    is_expired = models.BooleanField(default=False)
    
    # Metadata
    invited_by = models.ForeignKey(UserProfile, on_delete=models.SET_NULL, null=True, blank=True)
    message = models.TextField(null=True, blank=True, help_text="Optional message to invitee")
    
    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(help_text="Invitation expiry date")
    used_at = models.DateTimeField(null=True, blank=True)
    
    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['token']),
            models.Index(fields=['email', 'is_used']),
        ]
    
    def __str__(self):
        return f"Invitation for {self.email} to {self.organization.name}"


class LoginOTP(models.Model):
    """
    One-time password for email-based two-factor authentication at login.

    Flow:
      1. User submits email + password → backend validates credentials.
      2. If ``user.profile.two_factor_enabled`` is True, a 6-digit OTP is
         generated, hashed, and stored here; the plain code is emailed.
      3. User submits the code via ``verify-login-otp`` → backend verifies
         the hash and logs the user in.

    OTPs expire after 10 minutes and are single-use.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='login_otps')
    otp_hash = models.CharField(max_length=256, help_text='Hashed OTP code')
    expires_at = models.DateTimeField()
    is_used = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['user', 'is_used', 'expires_at']),
        ]

    def __str__(self):
        return f"LoginOTP for {self.user.email} @ {self.created_at}"

    def is_valid(self):
        """Return True if this OTP has not been used and has not expired."""
        from django.utils import timezone
        return not self.is_used and self.expires_at > timezone.now()
