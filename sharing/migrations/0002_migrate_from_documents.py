# Generated migration for data transfer from documents app
from django.db import migrations


def migrate_document_shares(apps, schema_editor):
    """
    Migrate DocumentShare → Share.
    Transforms document-specific shares to generic shares using ContentType.
    """
    DocumentShare = apps.get_model('documents', 'DocumentShare')
    Share = apps.get_model('sharing', 'Share')
    ContentType = apps.get_model('contenttypes', 'ContentType')
    
    # Get ContentType for Document model
    try:
        Document = apps.get_model('documents', 'Document')
        doc_type = ContentType.objects.get_for_model(Document)
    except Exception as e:
        print(f"Warning: Could not get ContentType for Document: {e}")
        return
    
    migrated_count = 0
    error_count = 0
    
    for old_share in DocumentShare.objects.all():
        try:
            Share.objects.create(
                id=old_share.id,
                content_type=doc_type,
                object_id=str(old_share.document_id),
                shared_with_user=old_share.shared_with_user,
                shared_with_team=old_share.shared_with_team,
                invitation_email=old_share.invitation_email,
                invitation_phone=old_share.invitation_phone,
                invitation_token=old_share.invitation_token,
                invitation_accepted=old_share.invitation_accepted,
                invitation_accepted_at=old_share.invitation_accepted_at,
                invitation_message=old_share.invitation_message,
                role=old_share.role,
                share_type=old_share.share_type,
                shared_by=old_share.shared_by,
                shared_at=old_share.shared_at,
                expires_at=old_share.expires_at,
                is_active=old_share.is_active,
                last_accessed_at=old_share.last_accessed_at,
                access_count=old_share.access_count,
                metadata={}  # Initialize empty metadata (new field)
            )
            migrated_count += 1
        except Exception as e:
            print(f"Error migrating share {old_share.id}: {e}")
            error_count += 1
    
    print(f"✓ Migrated {migrated_count} DocumentShare records to Share")
    if error_count > 0:
        print(f"⚠ {error_count} errors occurred during migration")


def migrate_document_access_logs(apps, schema_editor):
    """
    Migrate DocumentAccessLog → AccessLog.
    Transforms document-specific logs to generic logs using ContentType.
    """
    DocumentAccessLog = apps.get_model('documents', 'DocumentAccessLog')
    AccessLog = apps.get_model('sharing', 'AccessLog')
    ContentType = apps.get_model('contenttypes', 'ContentType')
    
    # Get ContentType for Document model
    try:
        Document = apps.get_model('documents', 'Document')
        doc_type = ContentType.objects.get_for_model(Document)
    except Exception as e:
        print(f"Warning: Could not get ContentType for Document: {e}")
        return
    
    migrated_count = 0
    error_count = 0
    
    for old_log in DocumentAccessLog.objects.all():
        try:
            AccessLog.objects.create(
                id=old_log.id,
                content_type=doc_type,
                object_id=str(old_log.document_id),
                user=old_log.user,
                access_token=old_log.access_token,
                ip_address=old_log.ip_address,
                user_agent=old_log.user_agent,
                access_type=old_log.access_type,
                accessed_at=old_log.accessed_at,
                share_id=old_log.share_id,
                session_id=old_log.session_id,
                metadata=old_log.metadata,
                success=True,  # Old logs didn't track failure, assume success
                error_message=''  # New field
            )
            migrated_count += 1
        except Exception as e:
            print(f"Error migrating log {old_log.id}: {e}")
            error_count += 1
    
    print(f"✓ Migrated {migrated_count} DocumentAccessLog records to AccessLog")
    if error_count > 0:
        print(f"⚠ {error_count} errors occurred during migration")


def reverse_migration(apps, schema_editor):
    """
    Reverse migration - delete all migrated data.
    Only safe if DocumentShare and DocumentAccessLog still exist.
    """
    Share = apps.get_model('sharing', 'Share')
    AccessLog = apps.get_model('sharing', 'AccessLog')
    ContentType = apps.get_model('contenttypes', 'ContentType')
    
    try:
        Document = apps.get_model('documents', 'Document')
        doc_type = ContentType.objects.get_for_model(Document)
        
        # Delete only document-related shares/logs
        share_count = Share.objects.filter(content_type=doc_type).count()
        Share.objects.filter(content_type=doc_type).delete()
        
        log_count = AccessLog.objects.filter(content_type=doc_type).count()
        AccessLog.objects.filter(content_type=doc_type).delete()
        
        print(f"✓ Deleted {share_count} Share records and {log_count} AccessLog records")
    except Exception as e:
        print(f"Error during reverse migration: {e}")


class Migration(migrations.Migration):
    """
    Data migration from documents.DocumentShare/DocumentAccessLog 
    to generic sharing.Share/AccessLog models.
    
    This migration:
    1. Copies all DocumentShare records to Share with ContentType
    2. Copies all DocumentAccessLog records to AccessLog with ContentType
    3. Preserves all UUIDs for referential integrity
    4. Is reversible (will delete migrated data if rolled back)
    
    After this migration succeeds, you should:
    1. Verify data integrity in Django admin
    2. Run migration 0016 in documents app to remove old models
    3. Update code imports from documents.models to sharing.models
    """
    
    dependencies = [
        ('sharing', '0001_initial'),
        ('documents', '0001_initial'),
        ('contenttypes', '__latest__'),
    ]
    
    operations = [
        migrations.RunPython(
            migrate_document_shares,
            reverse_code=reverse_migration
        ),
        migrations.RunPython(
            migrate_document_access_logs,
            reverse_code=migrations.RunPython.noop
        ),
    ]
