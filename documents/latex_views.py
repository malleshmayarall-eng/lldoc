from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from django.shortcuts import get_object_or_404

from .models import Document
from .latex_serializers import LatexDocumentSerializer


class LatexDocumentView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, document_id):
        document = get_object_or_404(Document, id=document_id)
        serializer = LatexDocumentSerializer(document)
        return Response(serializer.data)

    def patch(self, request, document_id):
        document = get_object_or_404(Document, id=document_id)
        serializer = LatexDocumentSerializer(document, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)

        if "latex_code" in serializer.validated_data and "is_latex_code" not in serializer.validated_data:
            serializer.validated_data["is_latex_code"] = True

        serializer.save()
        return Response(serializer.data, status=status.HTTP_200_OK)
