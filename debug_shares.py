#!/usr/bin/env python
"""
Debug script to check Share records for a specific document.
"""
import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'drafter.settings')
django.setup()

from django.contrib.auth.models import User
from django.contrib.contenttypes.models import ContentType
from documents.models import Document
from sharing.models import Share

# Document ID to check
doc_id = '20cf9717-33de-4945-bc7b-11238acd132f'

print(f"\n{'='*60}")
print(f"DEBUGGING SHARES FOR DOCUMENT: {doc_id}")
print(f"{'='*60}\n")

# Check if document exists
try:
    doc = Document.objects.get(id=doc_id)
    print(f"✅ Document found:")
    print(f"   Title: {doc.title}")
    print(f"   Owner: {doc.created_by.username} (ID={doc.created_by.id})")
    print(f"   Created: {doc.created_at}")
except Document.DoesNotExist:
    print(f"❌ Document NOT FOUND")
    exit(1)

print(f"\n{'='*60}")
print(f"SHARE RECORDS")
print(f"{'='*60}\n")

# Get ContentType for Document
content_type = ContentType.objects.get_for_model(Document)
print(f"ContentType for Document: {content_type} (ID={content_type.id})")

# Find all shares for this document
shares = Share.objects.filter(
    content_type=content_type,
    object_id=str(doc_id)
)

print(f"\nTotal shares found: {shares.count()}\n")

for share in shares:
    print(f"Share ID: {share.id}")
    print(f"  - Content Type: {share.content_type}")
    print(f"  - Object ID: {share.object_id} (type: {type(share.object_id).__name__})")
    print(f"  - Shared with User: {share.shared_with_user}")
    if share.shared_with_user:
        print(f"    User ID: {share.shared_with_user.id}")
        print(f"    Username: {share.shared_with_user.username}")
    print(f"  - Shared with Team: {share.shared_with_team}")
    print(f"  - Role: {share.role}")
    print(f"  - Share Type: {share.share_type}")
    print(f"  - Is Active: {share.is_active}")
    print(f"  - Shared By: {share.shared_by}")
    print(f"  - Shared At: {share.shared_at}")
    print()

print(f"{'='*60}")
print(f"ALL USERS")
print(f"{'='*60}\n")

users = User.objects.all()
for user in users:
    print(f"User: {user.username} (ID={user.id})")
    # Check if user has profile
    try:
        profile = user.profile
        print(f"  ✅ Has profile (ID={profile.id})")
    except:
        print(f"  ❌ No profile")

print(f"\n{'='*60}")
print(f"QUERY TEST")
print(f"{'='*60}\n")

# Test the query used in get_queryset
for user in users:
    print(f"\nTesting for user: {user.username} (ID={user.id})")
    
    # Get user's teams
    try:
        from user_management.models import Team
        user_profile = user.profile
        user_teams = Team.objects.filter(members=user_profile)
        print(f"  Teams: {list(user_teams.values_list('id', flat=True))}")
    except:
        user_teams = []
        print(f"  Teams: [] (no profile)")
    
    # Get shared document IDs
    from django.db.models import Q
    shared_doc_ids = Share.objects.filter(
        content_type=content_type,
        is_active=True
    ).filter(
        Q(shared_with_user=user) |
        Q(shared_with_team__in=user_teams)
    ).values_list('object_id', flat=True)
    
    print(f"  Shared doc IDs: {list(shared_doc_ids)}")
    
    # Check if this doc is in the list
    if str(doc_id) in shared_doc_ids:
        print(f"  ✅ Document {doc_id} IS in shared_doc_ids")
    else:
        print(f"  ❌ Document {doc_id} NOT in shared_doc_ids")
    
    # Final queryset
    queryset = Document.objects.filter(
        Q(created_by=user) |
        Q(id__in=shared_doc_ids)
    ).distinct()
    
    print(f"  Final queryset count: {queryset.count()}")
    if queryset.filter(id=doc_id).exists():
        print(f"  ✅ Document {doc_id} IS accessible")
    else:
        print(f"  ❌ Document {doc_id} NOT accessible")

print(f"\n{'='*60}\n")
