"""
Fuzzy search for users and teams using PostgreSQL trigram similarity.

Requirements:
1. PostgreSQL database with pg_trgm extension
2. Run: CREATE EXTENSION IF NOT EXISTS pg_trgm;

Installation Instructions:
========================

1. Enable pg_trgm extension in PostgreSQL:
   ```sql
   CREATE EXTENSION IF NOT EXISTS pg_trgm;
   ```

2. Create indexes for better performance:
   ```sql
   -- User search indexes
   CREATE INDEX user_username_trgm_idx ON auth_user USING gin (username gin_trgm_ops);
   CREATE INDEX user_email_trgm_idx ON auth_user USING gin (email gin_trgm_ops);
   CREATE INDEX user_first_name_trgm_idx ON auth_user USING gin (first_name gin_trgm_ops);
   CREATE INDEX user_last_name_trgm_idx ON auth_user USING gin (last_name gin_trgm_ops);
   
   -- Team search indexes
   CREATE INDEX team_name_trgm_idx ON user_management_team USING gin (name gin_trgm_ops);
   CREATE INDEX team_description_trgm_idx ON user_management_team USING gin (description gin_trgm_ops);
   ```

3. Or use Django migration:
   ```python
   from django.contrib.postgres.operations import TrigramExtension
   from django.db import migrations
   
   class Migration(migrations.Migration):
       operations = [
           TrigramExtension(),
       ]
   ```

Usage:
======

from sharing.search import fuzzy_search_users, fuzzy_search_teams, fuzzy_search_all

# Search users
results = fuzzy_search_users('john', limit=10, min_similarity=0.3)

# Search teams
results = fuzzy_search_teams('engineering', limit=10, min_similarity=0.3)

# Search both users and teams
results = fuzzy_search_all('john', limit=20)
"""

from django.contrib.auth.models import User
from django.db.models import Q, Value, FloatField
from django.db.models.functions import Greatest
from user_management.models import Team

try:
    from django.contrib.postgres.search import TrigramSimilarity
    TRIGRAM_AVAILABLE = True
except ImportError:
    TRIGRAM_AVAILABLE = False


def fuzzy_search_users(query, exclude_user_id=None, limit=10, min_similarity=0.3):
    """
    Fuzzy search for users using PostgreSQL trigram similarity.
    
    Searches across: username, email, first_name, last_name
    
    Args:
        query: Search string
        exclude_user_id: Optional user ID to exclude from results
        limit: Maximum number of results (default: 10)
        min_similarity: Minimum similarity score 0.0-1.0 (default: 0.3)
    
    Returns:
        QuerySet of User objects with 'similarity' annotation
        
    Example:
        users = fuzzy_search_users('john doe', limit=5)
        for user in users:
            print(f"{user.username}: {user.similarity}")
    """
    if not query or len(query) < 2:
        return User.objects.none()
    
    # Fallback to basic search if trigram not available
    if not TRIGRAM_AVAILABLE:
        return _basic_user_search(query, exclude_user_id, limit)
    
    query = query.strip()
    
    # Calculate similarity for each field
    similarity = Greatest(
        TrigramSimilarity('username', query),
        TrigramSimilarity('email', query),
        TrigramSimilarity('first_name', query),
        TrigramSimilarity('last_name', query),
    )
    
    queryset = User.objects.annotate(
        similarity=similarity
    ).filter(
        similarity__gte=min_similarity
    ).order_by('-similarity')
    
    if exclude_user_id:
        queryset = queryset.exclude(id=exclude_user_id)
    
    return queryset[:limit]


def fuzzy_search_teams(query, limit=10, min_similarity=0.3):
    """
    Fuzzy search for teams using PostgreSQL trigram similarity.
    
    Searches across: name, description
    
    Args:
        query: Search string
        limit: Maximum number of results (default: 10)
        min_similarity: Minimum similarity score 0.0-1.0 (default: 0.3)
    
    Returns:
        QuerySet of Team objects with 'similarity' annotation
        
    Example:
        teams = fuzzy_search_teams('engineering', limit=5)
        for team in teams:
            print(f"{team.name}: {team.similarity}")
    """
    if not query or len(query) < 2:
        return Team.objects.none()
    
    # Fallback to basic search if trigram not available
    if not TRIGRAM_AVAILABLE:
        return _basic_team_search(query, limit)
    
    query = query.strip()
    
    # Calculate similarity for each field
    similarity = Greatest(
        TrigramSimilarity('name', query),
        TrigramSimilarity('description', query),
    )
    
    queryset = Team.objects.annotate(
        similarity=similarity
    ).filter(
        similarity__gte=min_similarity
    ).order_by('-similarity')
    
    return queryset[:limit]


def fuzzy_search_all(query, exclude_user_id=None, limit=20, min_similarity=0.3):
    """
    Search both users and teams, returning unified results.
    
    Args:
        query: Search string
        exclude_user_id: Optional user ID to exclude from user results
        limit: Maximum total results (split between users and teams)
        min_similarity: Minimum similarity score 0.0-1.0 (default: 0.3)
    
    Returns:
        list of dicts with keys:
            - id: User/Team ID
            - type: 'user' or 'team'
            - name: Display name
            - email: User email (users only)
            - username: Username (users only)
            - description: Team description (teams only)
            - member_count: Number of team members (teams only)
            - similarity: Similarity score
    
    Example:
        results = fuzzy_search_all('john', limit=10)
        for result in results:
            print(f"{result['type']}: {result['name']} ({result['similarity']})")
    """
    if not query or len(query) < 2:
        return []
    
    # Split limit between users and teams
    user_limit = limit // 2
    team_limit = limit - user_limit
    
    results = []
    
    # Search users
    users = fuzzy_search_users(query, exclude_user_id, user_limit, min_similarity)
    for user in users:
        results.append({
            'id': user.id,
            'type': 'user',
            'name': user.get_full_name() or user.username,
            'email': user.email,
            'username': user.username,
            'similarity': getattr(user, 'similarity', 0.0),
        })
    
    # Search teams
    teams = fuzzy_search_teams(query, team_limit, min_similarity)
    for team in teams:
        results.append({
            'id': team.id,
            'type': 'team',
            'name': team.name,
            'description': team.description,
            'member_count': team.members.count(),
            'similarity': getattr(team, 'similarity', 0.0),
        })
    
    # Sort by similarity
    results.sort(key=lambda x: x['similarity'], reverse=True)
    
    return results[:limit]


# Fallback implementations without trigram


def _basic_user_search(query, exclude_user_id=None, limit=10):
    """Basic user search using ILIKE (case-insensitive) when trigram not available."""
    query = query.strip()
    
    queryset = User.objects.filter(
        Q(username__icontains=query) |
        Q(email__icontains=query) |
        Q(first_name__icontains=query) |
        Q(last_name__icontains=query)
    ).annotate(
        similarity=Value(0.5, output_field=FloatField())  # Dummy similarity
    )
    
    if exclude_user_id:
        queryset = queryset.exclude(id=exclude_user_id)
    
    return queryset[:limit]


def _basic_team_search(query, limit=10):
    """Basic team search using ILIKE (case-insensitive) when trigram not available."""
    query = query.strip()
    
    queryset = Team.objects.filter(
        Q(name__icontains=query) |
        Q(description__icontains=query)
    ).annotate(
        similarity=Value(0.5, output_field=FloatField())  # Dummy similarity
    )
    
    return queryset[:limit]


def setup_trigram_indexes():
    """
    SQL statements to create trigram indexes.
    
    Run these in PostgreSQL for optimal performance:
    
    Returns:
        str: SQL statements to execute
    """
    sql = """
-- Enable pg_trgm extension
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- User search indexes
CREATE INDEX IF NOT EXISTS user_username_trgm_idx 
    ON auth_user USING gin (username gin_trgm_ops);
    
CREATE INDEX IF NOT EXISTS user_email_trgm_idx 
    ON auth_user USING gin (email gin_trgm_ops);
    
CREATE INDEX IF NOT EXISTS user_first_name_trgm_idx 
    ON auth_user USING gin (first_name gin_trgm_ops);
    
CREATE INDEX IF NOT EXISTS user_last_name_trgm_idx 
    ON auth_user USING gin (last_name gin_trgm_ops);

-- Team search indexes
CREATE INDEX IF NOT EXISTS team_name_trgm_idx 
    ON user_management_team USING gin (name gin_trgm_ops);
    
CREATE INDEX IF NOT EXISTS team_description_trgm_idx 
    ON user_management_team USING gin (description gin_trgm_ops);

-- Verify indexes
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE indexname LIKE '%_trgm_idx'
ORDER BY tablename, indexname;
"""
    return sql


def check_trigram_available():
    """
    Check if PostgreSQL trigram extension is available.
    
    Returns:
        dict with keys:
            - available: bool - Whether pg_trgm is available
            - extension_installed: bool - Whether extension is installed
            - indexes_exist: bool - Whether trigram indexes exist
            - message: str - Status message
    """
    from django.db import connection
    
    result = {
        'available': TRIGRAM_AVAILABLE,
        'extension_installed': False,
        'indexes_exist': False,
        'message': ''
    }
    
    if not TRIGRAM_AVAILABLE:
        result['message'] = 'pg_trgm not available in Django (requires PostgreSQL)'
        return result
    
    try:
        with connection.cursor() as cursor:
            # Check if extension is installed
            cursor.execute(
                "SELECT COUNT(*) FROM pg_extension WHERE extname = 'pg_trgm'"
            )
            ext_count = cursor.fetchone()[0]
            result['extension_installed'] = ext_count > 0
            
            # Check if indexes exist
            cursor.execute("""
                SELECT COUNT(*) 
                FROM pg_indexes 
                WHERE indexname LIKE '%_trgm_idx'
            """)
            idx_count = cursor.fetchone()[0]
            result['indexes_exist'] = idx_count > 0
            
            if result['extension_installed'] and result['indexes_exist']:
                result['message'] = f'Trigram search fully configured ({idx_count} indexes)'
            elif result['extension_installed']:
                result['message'] = 'Extension installed but indexes missing. Run setup_trigram_indexes()'
            else:
                result['message'] = 'Extension not installed. Run: CREATE EXTENSION pg_trgm;'
                
    except Exception as e:
        result['message'] = f'Error checking trigram: {str(e)}'
    
    return result
