from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_nested import routers
from .views import (
    DocumentViewSet, 
    IssueViewSet, 
    DocumentImageViewSet, 
    DocumentSearchViewSet,
    UnifiedSearchViewSet,
    ReferenceContextViewSet,
    SectionReferenceViewSet,
    UserInfoView
)
from .structure_views import (
    SectionViewSet, 
    ParagraphViewSet, 
    SentenceViewSet, 
    TableViewSet,
    ImageComponentViewSet,
    DocumentFileViewSet,
    DocumentFileComponentViewSet,
    HeaderFooterPDFViewSet,
    ParagraphHistoryViewSet,
)
from .workflow_views import (
    DocumentWorkflowViewSet,
    WorkflowApprovalViewSet,
    WorkflowCommentViewSet,
    WorkflowNotificationViewSet,
    WorkflowDecisionStepViewSet,
)
from .dashboard_views import DashboardViewSet
from .branching_views import (
    MasterDocumentViewSet,
    DocumentBranchViewSet,
    DocumentDuplicateViewSet,
)
from .quick_latex_views import QuickLatexDocumentViewSet
from . import latex_urls, latexcode_urls, latex_render_urls


router = DefaultRouter()
# Register specific routes FIRST, before the empty prefix
# This prevents the empty prefix from catching everything
router.register(r'search', DocumentSearchViewSet, basename='document-search')
router.register(r'unified-search', UnifiedSearchViewSet, basename='unified-search')
router.register(r'reference-context', ReferenceContextViewSet, basename='reference-context')
router.register(r'issues', IssueViewSet, basename='issue')
router.register(r'images', DocumentImageViewSet, basename='documentimage')
router.register(r'sections', SectionViewSet, basename='section')
router.register(r'paragraphs', ParagraphViewSet, basename='paragraph')
router.register(r'sentences', SentenceViewSet, basename='sentence')
router.register(r'tables', TableViewSet, basename='table')
router.register(r'image-components', ImageComponentViewSet, basename='image-component')
router.register(r'files', DocumentFileViewSet, basename='document-file')
router.register(r'file-components', DocumentFileComponentViewSet, basename='file-component')
# Header/Footer PDF manual selection
router.register(r'header-footer-pdfs', HeaderFooterPDFViewSet, basename='header-footer-pdf')
# Section references
router.register(r'section-references', SectionReferenceViewSet, basename='section-reference')
# Paragraph history
router.register(r'paragraph-history', ParagraphHistoryViewSet, basename='paragraph-history')
# Workflow system
router.register(r'workflows', DocumentWorkflowViewSet, basename='workflow')
router.register(r'workflow-approvals', WorkflowApprovalViewSet, basename='workflow-approval')
router.register(r'workflow-comments', WorkflowCommentViewSet, basename='workflow-comment')
router.register(r'workflow-notifications', WorkflowNotificationViewSet, basename='workflow-notification')
# Workflow decision steps (yes/no scenarios)
router.register(r'workflow-decisions', WorkflowDecisionStepViewSet, basename='workflow-decision')
# Dashboard
router.register(r'dashboard', DashboardViewSet, basename='dashboard')
# Master Documents & Branching
router.register(r'masters', MasterDocumentViewSet, basename='master-document')
router.register(r'branches', DocumentBranchViewSet, basename='document-branch')
router.register(r'duplicate', DocumentDuplicateViewSet, basename='document-duplicate')
# Quick LaTeX Documents
router.register(r'quick-latex', QuickLatexDocumentViewSet, basename='quick-latex')
# Register DocumentViewSet LAST with empty prefix
# Since main urls.py already includes this at 'api/documents/'
router.register(r'', DocumentViewSet, basename='document')

# Create nested routers for sections -> paragraphs -> sentences
sections_router = routers.NestedSimpleRouter(router, r'sections', lookup='section')
sections_router.register(r'paragraphs', ParagraphViewSet, basename='section-paragraphs')
sections_router.register(r'tables', TableViewSet, basename='section-tables')
sections_router.register(r'image-components', ImageComponentViewSet, basename='section-image-components')
sections_router.register(r'file-components', DocumentFileComponentViewSet, basename='section-file-components')

paragraphs_router = routers.NestedSimpleRouter(sections_router, r'paragraphs', lookup='paragraph')
paragraphs_router.register(r'sentences', SentenceViewSet, basename='paragraph-sentences')

urlpatterns = [
    path('user-info/', UserInfoView.as_view(), name='user-info'),
    path('<uuid:document_id>/sections/', SectionViewSet.as_view({'get': 'list', 'post': 'create'}), name='document-sections'),
    path('', include(latex_urls)),
    path('', include(latexcode_urls)),
    path('', include(latex_render_urls)),
    path('', include(router.urls)),
    path('', include(sections_router.urls)),
    path('', include(paragraphs_router.urls)),
]


