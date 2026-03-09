from rest_framework import serializers

from .models import Document


class LatexDocumentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Document
        fields = [
            "id",
            "title",
            "is_latex_code",
            "latex_code",
            "document_metadata",
            "custom_metadata",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]
