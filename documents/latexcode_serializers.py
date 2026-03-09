from rest_framework import serializers

from .models import LatexCode, Section


class LatexCodeSerializer(serializers.ModelSerializer):
    section_id = serializers.PrimaryKeyRelatedField(
        source="section",
        queryset=Section.objects.all(),
        required=False,
        allow_null=True,
    )

    class Meta:
        model = LatexCode
        fields = [
            "id",
            "section_id",
            "latex_code",
            "edited_code",
            "has_edits",
            "code_type",
            "topic",
            "custom_metadata",
            "order",
            "last_modified",
            "modified_by",
            "edit_count",
        ]
        read_only_fields = ["id", "last_modified", "modified_by", "edit_count"]
