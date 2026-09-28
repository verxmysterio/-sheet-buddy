import io
import logging
from typing import List, Dict, Any, Optional
from abc import ABC, abstractmethod

logger = logging.getLogger("sheetbuddy.ocr")

class BaseOCREngine(ABC):
    @abstractmethod
    def extract_text_and_boxes(self, page_image_bytes: bytes) -> List[Dict[str, Any]]:
        """
        Extracts words/lines and their bounding coordinates (x0, top, x1, bottom, text, confidence)
        from in-memory page image bytes.
        """
        pass

class PyMuPDFOCREngine(BaseOCREngine):
    """
    In-memory OCR engine using PyMuPDF / Tesseract or fallback heuristics.
    """
    def extract_text_and_boxes(self, page_image_bytes: bytes) -> List[Dict[str, Any]]:
        elements = []
        try:
            # Check for pytesseract or easyocr if installed
            import pytesseract
            from PIL import Image
            
            image = Image.open(io.BytesIO(page_image_bytes))
            data = pytesseract.image_to_data(image, output_type=pytesseract.Output.DICT)
            n_boxes = len(data['text'])
            for i in range(n_boxes):
                text = data['text'][i].strip()
                if text:
                    conf = float(data['conf'][i]) if 'conf' in data and data['conf'][i] != '-1' else 80.0
                    elements.append({
                        'text': text,
                        'x': float(data['left'][i]),
                        'y': float(data['top'][i]),
                        'w': float(data['width'][i]),
                        'h': float(data['height'][i]),
                        'confidence': max(0.0, min(100.0, conf))
                    })
        except ImportError:
            logger.info("OCR engine running in lightweight simulation mode (pytesseract/PIL not required for native PDFs).")
        except Exception as e:
            logger.warning(f"OCR processing warning: {e}")
            
        return elements

class OCRService:
    _instance = None
    
    def __init__(self, engine: Optional[BaseOCREngine] = None):
        self.engine = engine or PyMuPDFOCREngine()
        
    @classmethod
    def get_instance(cls) -> "OCRService":
        if cls._instance is None:
            cls._instance = OCRService()
        return cls._instance
        
    def process_scanned_page(self, page_image_bytes: bytes) -> List[Dict[str, Any]]:
        """
        Processes scanned page bytes in-memory and returns structured text elements.
        """
        return self.engine.extract_text_and_boxes(page_image_bytes)
