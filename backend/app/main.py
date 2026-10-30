import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .core.config import settings
from .models.database import engine, Base, SessionLocal
from .api import auth, convert, wallet, admin, support, csv_templates
from sqlalchemy import text

logger = logging.getLogger("sheetbuddy.main")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. Startup: Create tables and run migration guards
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        if not settings.DATABASE_URL.startswith("sqlite"):
            db.execute(text("SET lock_timeout = 5000"))
            db.commit()
            
        # SQLite schema migration guards
        migration_queries = [
            "ALTER TABLE users ADD COLUMN is_admin BOOLEAN DEFAULT FALSE NOT NULL",
            "ALTER TABLE users ADD COLUMN is_verified BOOLEAN DEFAULT FALSE NOT NULL",
            "ALTER TABLE wallet_transactions ADD COLUMN status VARCHAR(50) DEFAULT 'COMPLETED' NOT NULL",
            "ALTER TABLE wallet_transactions ADD COLUMN balance_before INTEGER DEFAULT 0 NOT NULL",
            "ALTER TABLE wallet_transactions ADD COLUMN balance_after INTEGER DEFAULT 0 NOT NULL",
            "ALTER TABLE wallet_transactions ADD COLUMN reference_type VARCHAR(50)",
            "ALTER TABLE wallet_transactions ADD COLUMN reference_id VARCHAR(100)",
            "ALTER TABLE conversions ADD COLUMN client_id VARCHAR(36)",
            "ALTER TABLE conversions ADD COLUMN is_reconciled BOOLEAN DEFAULT TRUE NOT NULL",
            "ALTER TABLE conversions ADD COLUMN opening_balance FLOAT DEFAULT 0.0 NOT NULL",
            "ALTER TABLE conversions ADD COLUMN closing_balance FLOAT DEFAULT 0.0 NOT NULL",
            "ALTER TABLE conversions ADD COLUMN cached_xml TEXT",
            "ALTER TABLE support_queries ADD COLUMN status VARCHAR(50) DEFAULT 'OPEN' NOT NULL"
        ]
        for query in migration_queries:
            try:
                db.execute(text(query))
                db.commit()
            except Exception:
                db.rollback()
                
        # Seed default Admin User
        from .models.models import User
        from .core.security import hash_password
        admin_user = db.query(User).filter(User.email == "admin@sheetbuddy.com").first()
        if not admin_user:
            admin_user = User(
                email="admin@sheetbuddy.com",
                hashed_password=hash_password("adminpassword"),
                page_credits=99999,
                is_admin=True,
                is_verified=True
            )
            db.add(admin_user)
            db.commit()
            
        # Seed Native Banks
        from .models.models import BankConfig
        defaults = [
            ("sbi", "State Bank of India (SBI)", "SBI,STATE BANK", "NATIVE", "{}"),
            ("hdfc", "HDFC Bank", "HDFC,HDFCBANK", "NATIVE", "{}"),
            ("icici", "ICICI Bank", "ICICI,ICICIBANK", "NATIVE", "{}"),
            ("axis", "Axis Bank", "AXIS,AXISBANK,UTIB", "NATIVE", "{}"),
            ("bob", "Bank of Baroda (BOB)", "BOB,BARODA,BARB", "NATIVE", "{}"),
            ("pnb", "Punjab National Bank (PNB)", "PNB,PUNJAB NATIONAL", "NATIVE", "{}"),
            ("kotak", "Kotak Mahindra Bank", "KOTAK,KKBK", "NATIVE", "{}")
        ]
        for key, name, patterns, parser_type, cfg in defaults:
            existing = db.query(BankConfig).filter_by(bank_key=key).first()
            if not existing:
                config = BankConfig(
                    bank_key=key,
                    name=name,
                    match_patterns=patterns,
                    parser_type=parser_type,
                    config_json=cfg
                )
                db.add(config)
            else:
                existing.parser_type = "NATIVE"
                existing.name = name
                existing.match_patterns = patterns
        db.commit()
    except Exception as e:
        db.rollback()
        logger.warning(f"Startup initialization note: {e}")
    finally:
        db.close()
        
    yield
    # 2. Shutdown

app = FastAPI(
    title="Sheet Buddy — Tally Bank Statement Automation SaaS",
    description="Automated Indian Bank Statement PDF Parsing, Mathematical Reconciliation & Tally Prime XML Export.",
    version="2.0.0",
    lifespan=lifespan
)

from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

# Global validation error handler: ensures error details are ALWAYS strings, never unparsed objects
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request, exc: RequestValidationError):
    error_messages = []
    for err in exc.errors():
        loc = ".".join(str(l) for l in err.get("loc", []) if l != "body")
        msg = err.get("msg", "Invalid value")
        if loc:
            error_messages.append(f"{loc}: {msg}")
        else:
            error_messages.append(msg)
    clean_detail = "; ".join(error_messages) or "Validation error"
    return JSONResponse(
        status_code=422,
        content={"detail": clean_detail, "validation_errors": exc.errors()}
    )

# Set up CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Standard API Routes
app.include_router(auth.router, prefix="/api")
app.include_router(convert.router, prefix="/api")
app.include_router(csv_templates.router, prefix="/api")
app.include_router(wallet.router, prefix="/api")
app.include_router(admin.router, prefix="/api")
app.include_router(support.router, prefix="/api")

# Versioned /api/v1 and /api/v2 aliases
app.include_router(auth.router, prefix="/api/v1")
app.include_router(convert.router, prefix="/api/v1")
app.include_router(csv_templates.router, prefix="/api/v1")
app.include_router(wallet.router, prefix="/api/v1")
app.include_router(admin.router, prefix="/api/v1")
app.include_router(support.router, prefix="/api/v1")

app.include_router(auth.router, prefix="/api/v2")
app.include_router(convert.router, prefix="/api/v2")
app.include_router(csv_templates.router, prefix="/api/v2")
app.include_router(wallet.router, prefix="/api/v2")
app.include_router(admin.router, prefix="/api/v2")
app.include_router(support.router, prefix="/api/v2")

@app.get("/")
def read_root():
    return {
        "status": "online",
        "service": "Sheet Buddy",
        "version": "2.0.0",
        "tagline": "A Complete Tally Supporting Tool for Bank Statement Entries"
    }
