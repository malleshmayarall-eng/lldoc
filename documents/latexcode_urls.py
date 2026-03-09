from django.urls import path
from rest_framework.routers import SimpleRouter

from .latexcode_views import LatexCodeViewSet

router = SimpleRouter()
router.register(r"latex-codes", LatexCodeViewSet, basename="latex-code")

urlpatterns = router.urls
