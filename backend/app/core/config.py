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

    # SMTP Settings (free email sending configuration)
    SMTP_HOST: str = os.getenv("SMTP_HOST", "")
    SMTP_PORT: int = int(os.getenv("SMTP_PORT", "587"))
    SMTP_USER: str = os.getenv("SMTP_USER", "")
    SMTP_PASSWORD: str = os.getenv("SMTP_PASSWORD", "")
    SMTP_FROM: str = os.getenv("SMTP_FROM", "")

    # Resend API Settings (for Render Free Tier where SMTP ports are blocked)
    RESEND_API_KEY: str = os.getenv("RESEND_API_KEY", "")

settings = Settings()

# Ensure directories exist
os.makedirs(settings.TEMP_UPLOAD_DIR, exist_ok=True)
os.makedirs(settings.XML_CACHE_DIR, exist_ok=True)
