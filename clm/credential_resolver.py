"""
Credential Resolver — resolves credential_id in node config to actual secrets.

When a WorkflowNode.config contains ``credential_id``, this module fetches the
corresponding ``InputNodeCredential`` row from the user's profile and merges
the stored secrets into the config dict so that downstream handlers
(listener_executor, source_integrations) continue to work unchanged.

Usage in node execution::

    from clm.credential_resolver import resolve_credentials
    config = resolve_credentials(node.config, user=triggered_by)
    # config now contains the actual email_host, email_password, etc.
"""
import logging

logger = logging.getLogger(__name__)


def resolve_credentials(config: dict, user=None) -> dict:
    """
    Return a **copy** of *config* with credential secrets merged in.

    If ``config['credential_id']`` is present (a UUID string), the
    corresponding ``InputNodeCredential`` is fetched and its ``.credentials``
    dict is shallow-merged into the returned config.  The original *config*
    is never mutated.

    If the credential cannot be found (deleted, wrong user, etc.) the
    returned config is unchanged and a warning is logged.

    Parameters
    ----------
    config : dict
        The node's ``config`` JSONField value.
    user : django.contrib.auth.models.User | None
        The Django user whose profile owns the credential.  When *None*
        (background tasks), the credential is looked up without an
        ownership check.
    """
    cred_id = config.get('credential_id')
    if not cred_id:
        return config  # nothing to resolve

    from user_management.models import InputNodeCredential

    merged = dict(config)
    try:
        qs = InputNodeCredential.objects.select_related('profile__user')
        cred = qs.get(pk=cred_id)

        # Optional ownership check — skip for background/celery tasks
        if user is not None:
            if cred.profile.user_id != user.id:
                logger.warning(
                    "Credential %s does not belong to user %s — skipping",
                    cred_id, user.pk,
                )
                return config

        # Shallow-merge stored secrets into config.
        # Stored secrets override any stale values that might remain in config.
        merged.update(cred.credentials or {})
        logger.debug("Resolved credential %s (%s) for node config", cred_id, cred.credential_type)

    except InputNodeCredential.DoesNotExist:
        logger.warning("InputNodeCredential %s not found — using raw config", cred_id)
    except Exception as exc:
        logger.error("Error resolving credential %s: %s", cred_id, exc)

    return merged
