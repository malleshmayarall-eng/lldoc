from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated

from .models import LatexCode
from .latexcode_serializers import LatexCodeSerializer


class LatexCodeViewSet(viewsets.ModelViewSet):
    serializer_class = LatexCodeSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        queryset = LatexCode.objects.all().select_related("section")
        document_id = self.request.GET.get("document")
        section_id = self.request.GET.get("section")

        if document_id:
            queryset = queryset.filter(section__document_id=document_id)
        if section_id:
            queryset = queryset.filter(section_id=section_id)

        return queryset

    def perform_create(self, serializer):
        instance = serializer.save()
        if self.request.user and self.request.user.is_authenticated:
            instance.modified_by = self.request.user
            instance.edit_count = (instance.edit_count or 0) + 1
            instance.save(update_fields=["modified_by", "edit_count"])

    def perform_update(self, serializer):
        instance = serializer.save()
        if self.request.user and self.request.user.is_authenticated:
            instance.modified_by = self.request.user
            instance.edit_count = (instance.edit_count or 0) + 1
            instance.save(update_fields=["modified_by", "edit_count"])
