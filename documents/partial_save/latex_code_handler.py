from .base import ChangeHandler
from ..models import LatexCode
from ..latexcode_serializers import LatexCodeSerializer


class LatexCodeHandler(ChangeHandler):
    type_name = "latex_code"

    def create(self, document, change, user):
        data = change.get("data") or {}
        latex_code = LatexCode.objects.create(
            section_id=data.get("section_id"),
            latex_code=data.get("latex_code", ""),
            edited_code=data.get("edited_code"),
            has_edits=bool(data.get("has_edits")),
            code_type=data.get("code_type", "latex"),
            topic=data.get("topic", ""),
            order=data.get("order", 0),
            custom_metadata=data.get("custom_metadata") or {},
            modified_by=user,
            edit_count=1,
        )
        return {
            "type": self.type_name,
            "id": str(latex_code.id),
            "data": LatexCodeSerializer(latex_code).data,
            "client_id": change.get("client_id"),
        }

    def update(self, document, change, user):
        latex_code = LatexCode.objects.select_for_update().get(
            id=change["id"],
            section__document=document,
        )
        for key, value in (change.get("data") or {}).items():
            setattr(latex_code, key, value)
        latex_code.modified_by = user
        latex_code.edit_count = (latex_code.edit_count or 0) + 1
        latex_code.save()
        return {
            "type": self.type_name,
            "id": str(latex_code.id),
            "data": LatexCodeSerializer(latex_code).data,
        }

    def delete(self, document, change, user):
        latex_code = LatexCode.objects.filter(
            id=change.get("id"),
            section__document=document,
        ).first()
        if latex_code:
            latex_code.delete()
        return {"type": self.type_name, "id": change.get("id")}
