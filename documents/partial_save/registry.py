from .document_handler import DocumentHandler
from .file_handler import FileHandler
from .image_handler import ImageHandler
from .latex_code_handler import LatexCodeHandler
from .paragraph_handler import ParagraphHandler
from .section_handler import SectionHandler
from .table_handler import TableHandler

HANDLERS = {
    DocumentHandler.type_name: DocumentHandler(),
    SectionHandler.type_name: SectionHandler(),
    ParagraphHandler.type_name: ParagraphHandler(),
    TableHandler.type_name: TableHandler(),
    LatexCodeHandler.type_name: LatexCodeHandler(),
    ImageHandler.type_name: ImageHandler(),
    FileHandler.type_name: FileHandler(),
}
