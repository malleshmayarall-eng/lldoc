from rest_framework import serializers
from django.contrib.auth.models import User
from django.contrib.contenttypes.models import ContentType
from sharing.models import Share
from .models import DriveFolder, DriveFile, DriveFavorite
from .utils import get_effective_share


class UserBasicSerializer(serializers.ModelSerializer):
    full_name = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'first_name', 'last_name', 'full_name']
        read_only_fields = fields

    def get_full_name(self, obj):
        return obj.get_full_name() or obj.username


class DriveFolderSerializer(serializers.ModelSerializer):
    owner_info = UserBasicSerializer(source='owner', read_only=True)
    path = serializers.SerializerMethodField()
    ancestor_ids = serializers.SerializerMethodField()
    share_role = serializers.SerializerMethodField()
    is_favorite = serializers.SerializerMethodField()

    class Meta:
        model = DriveFolder
        fields = [
            'id',
            'name',
            'description',
            'owner',
            'owner_info',
            'organization',
            'team',
            'parent',
            'is_root',
            'root_type',
            'drive_scope',
            'path',
            'ancestor_ids',
            'share_role',
            'is_favorite',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'owner', 'organization', 'created_at', 'updated_at']

    def get_path(self, obj):
        return obj.get_path()

    def get_ancestor_ids(self, obj):
        return [str(ancestor.id) for ancestor in obj.get_ancestors()]

    def get_share_role(self, obj):
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if not user or not user.is_authenticated:
            return None
        share = get_effective_share(user, obj)
        return share.role if share else None

    def get_is_favorite(self, obj):
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if not user or not user.is_authenticated:
            return False
        content_type = ContentType.objects.get_for_model(obj.__class__)
        return DriveFavorite.objects.filter(
            user=user,
            content_type=content_type,
            object_id=str(obj.id),
        ).exists()


class DriveFolderCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = DriveFolder
        fields = ['id', 'name', 'description', 'parent', 'is_root', 'root_type', 'team']
        read_only_fields = ['id']

    def validate(self, attrs):
        is_root = attrs.get('is_root', False)
        root_type = attrs.get('root_type', 'personal')
        team = attrs.get('team')

        if is_root and root_type == 'team' and not team:
            raise serializers.ValidationError({'team': 'Team is required for team root folders.'})

        if team and root_type != 'team':
            raise serializers.ValidationError({'team': 'Team can only be set for team root folders.'})

        if not is_root and root_type != 'personal':
            raise serializers.ValidationError({'root_type': 'Only root folders can set root_type.'})

        return attrs


class DriveFileSerializer(serializers.ModelSerializer):
    owner_info = UserBasicSerializer(source='owner', read_only=True)
    file_url = serializers.SerializerMethodField()
    share_role = serializers.SerializerMethodField()
    share_count = serializers.SerializerMethodField()
    is_favorite = serializers.SerializerMethodField()

    class Meta:
        model = DriveFile
        fields = [
            'id',
            'name',
            'description',
            'tags',
            'owner',
            'owner_info',
            'organization',
            'team',
            'folder',
            'file',
            'file_url',
            'file_size',
            'mime_type',
            'checksum',
            'source',
            'drive_scope',
            'share_role',
            'share_count',
            'is_favorite',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'id',
            'owner',
            'organization',
            'file_size',
            'mime_type',
            'checksum',
            'share_count',
            'created_at',
            'updated_at',
        ]

    def get_file_url(self, obj):
        if obj.file:
            return obj.file.url
        return None

    def get_share_role(self, obj):
        request = self.context.get('request')
        if not request or not request.user.is_authenticated:
            return None
        share = get_effective_share(request.user, obj)
        return share.role if share else None

    def get_share_count(self, obj):
        content_type = ContentType.objects.get_for_model(obj.__class__)
        return Share.objects.filter(content_type=content_type, object_id=str(obj.id), is_active=True).count()

    def get_is_favorite(self, obj):
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if not user or not user.is_authenticated:
            return False
        content_type = ContentType.objects.get_for_model(obj.__class__)
        return DriveFavorite.objects.filter(
            user=user,
            content_type=content_type,
            object_id=str(obj.id),
        ).exists()


class DriveFavoriteSerializer(serializers.Serializer):
    content_type_id = serializers.IntegerField(required=True)
    object_id = serializers.CharField(required=True, max_length=255)

    def validate(self, attrs):
        content_type_id = attrs.get('content_type_id')
        object_id = attrs.get('object_id')

        try:
            content_type = ContentType.objects.get(id=content_type_id)
        except ContentType.DoesNotExist:
            raise serializers.ValidationError({'content_type_id': 'Invalid content type.'})

        model_class = content_type.model_class()
        if model_class not in (DriveFolder, DriveFile):
            raise serializers.ValidationError({'content_type_id': 'Favorites only support DriveFolder or DriveFile.'})

        if not model_class.objects.filter(pk=object_id).exists():
            raise serializers.ValidationError({'object_id': 'Object not found.'})

        attrs['content_type'] = content_type
        return attrs


class DriveFileUploadSerializer(serializers.ModelSerializer):
    class Meta:
        model = DriveFile
        fields = ['id', 'name', 'description', 'tags', 'folder', 'file']
        read_only_fields = ['id']

    def validate(self, attrs):
        if self.instance is None and not attrs.get('file'):
            raise serializers.ValidationError({'file': 'File is required.'})
        if not attrs.get('name') and attrs.get('file'):
            attrs['name'] = attrs['file'].name
        return attrs
