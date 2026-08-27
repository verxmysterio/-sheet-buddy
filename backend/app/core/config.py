import os
from pydantic import BaseModel

class Settings(BaseModel):
    PROJECT_NAME: str = "Sheet Buddy"
    SECRET_KEY: str = os.getenv("SECRET_KEY", "super-secret-key-for-jwt-signing-change-in-prod")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 1 day expiration
    
    # Database (uses SQLite locally by default, can be overridden by DATABASE_URL in production)
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///./balance_sheet_buddy.db").replace("postgres://", "postgresql://") if os.getenv("DATABASE_URL") else "sqlite:///./balance_sheet_buddy.db"
    
    # Uploads
    TEMP_UPLOAD_DIR: str = os.getenv("TEMP_UPLOAD_DIR", os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "scratch", "temp_uploads"))
    XML_CACHE_DIR: str = os.getenv("XML_CACHE_DIR", os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "scratch", "xml_cache"))

settings = Settings()

# Ensure directories exist
os.makedirs(settings.TEMP_UPLOAD_DIR, exist_ok=True)
os.makedirs(settings.XML_CACHE_DIR, exist_ok=True)
