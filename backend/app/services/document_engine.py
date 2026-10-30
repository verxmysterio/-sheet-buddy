import io
import hashlib
import logging
from typing import Dict, Any, List, Optional
from pypdf import PdfReader

logger = logging.getLogger("sheetbuddy.document_engine")

class DocumentInspectionResult:
    def __init__(
        self,
        pages_count: int,
        document_type: str,  # NATIVE_PDF, SCANNED_PDF, HYBRID_PDF
        is_text_extractable: bool,
        file_hash: str,
        total_characters: int,
        page_previews: List[str],
        page_sizes: List[Dict[str, float]],
        has_rotation: bool,
        estimated_quality: str  # HIGH, MEDIUM, POOR
    ):
        self.pages_count = pages_count
        self.document_type = document_type
        self.is_text_extractable = is_text_extractable
        self.file_hash = file_hash
        self.total_characters = total_characters
        self.page_previews = page_previews
        self.page_sizes = page_sizes
        self.has_rotation = has_rotation
        self.estimated_quality = estimated_quality

    def to_dict(self) -> Dict[str, Any]:
        return {
            "pages_count": self.pages_count,
            "document_type": self.document_type,
            "is_text_extractable": self.is_text_extractable,
            "file_hash": self.file_hash,
            "total_characters": self.total_characters,
            "has_rotation": self.has_rotation,
            "estimated_quality": self.estimated_quality,
            "page_sizes": self.page_sizes
        }

class DocumentEngine:
    @staticmethod
    def inspect(file_bytes: bytes) -> DocumentInspectionResult:
        """
        Inspects PDF in-memory, detects layout properties, text density, and scanned vs native status.
        """
        file_hash = hashlib.sha256(file_bytes).hexdigest()
        stream = io.BytesIO(file_bytes)
        reader = PdfReader(stream)
        pages_count = len(reader.pages)
        
        total_chars = 0
        page_previews = []
        page_sizes = []
        has_rotation = False
        empty_pages = 0
        
        for idx, page in enumerate(reader.pages):
            # Page rotation check
            if getattr(page, 'rotation', 0) not in (0, None):
                has_rotation = True
                
            # Dimensions
            try:
                box = page.mediabox
                page_sizes.append({
                    "width": float(box.width),
                    "height": float(box.height)
                })
            except Exception:
                page_sizes.append({"width": 595.0, "height": 842.0})
                
            # Text extraction attempt
            try:
                text = page.extract_text() or ""
            except Exception as e:
                logger.warning(f"Page {idx+1} text extraction error: {e}")
                text = ""
                
            char_count = len(text.strip())
            total_chars += char_count
            if char_count < 20:
                empty_pages += 1
            page_previews.append(text[:25000])
            
        # Determine document type
        if empty_pages == pages_count:
            document_type = "SCANNED_PDF"
            is_text_extractable = False
            estimated_quality = "POOR"
        elif empty_pages > 0 and empty_pages < pages_count:
            document_type = "HYBRID_PDF"
            is_text_extractable = True
            estimated_quality = "MEDIUM"
        else:
            document_type = "NATIVE_PDF"
            is_text_extractable = True
            estimated_quality = "HIGH"
            
        return DocumentInspectionResult(
            pages_count=pages_count,
            document_type=document_type,
            is_text_extractable=is_text_extractable,
            file_hash=file_hash,
            total_characters=total_chars,
            page_previews=page_previews,
            page_sizes=page_sizes,
            has_rotation=has_rotation,
            estimated_quality=estimated_quality
        )
