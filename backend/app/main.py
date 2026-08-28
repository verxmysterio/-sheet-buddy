from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .core.config import settings
from .models.database import engine, Base
from .api import auth, convert, wallet, admin, support

app = FastAPI(
    title=settings.PROJECT_NAME,
    description="SaaS Utility to convert Bank Statement PDFs to Tally Prime XML.",
    version="1.0.0"
)

@app.on_event("startup")
def on_startup():
    from .models.database import SessionLocal, engine, Base
    from .models.models import User
    from .core.security import hash_password
    from sqlalchemy import text
    
    # Create database tables
    Base.metadata.create_all(bind=engine)
    
    db = SessionLocal()
    try:
        # Set lock timeout for PostgreSQL to prevent indefinite hanging on locked tables
        if not settings.DATABASE_URL.startswith("sqlite"):
            db.execute(text("SET lock_timeout = 5000"))
            db.commit()
            
        # SQLite migration check: auto-add is_admin column if missing
        try:
            db.execute(text("SELECT is_admin FROM users LIMIT 1"))
        except Exception:
            db.rollback()
            try:
                db.execute(text("ALTER TABLE users ADD COLUMN is_admin BOOLEAN DEFAULT FALSE NOT NULL"))
                db.commit()
            except Exception as e:
                db.rollback()
                print("Schema update log:", e)
        
        # SQLite migration check: auto-add is_verified column if missing
        try:
            db.execute(text("SELECT is_verified FROM users LIMIT 1"))
        except Exception:
            db.rollback()
            try:
                db.execute(text("ALTER TABLE users ADD COLUMN is_verified BOOLEAN DEFAULT FALSE NOT NULL"))
                db.commit()
            except Exception as e:
                db.rollback()
                print("Schema update is_verified log:", e)
        
        # SQLite migration check: auto-add status column to wallet_transactions if missing
        try:
            db.execute(text("SELECT status FROM wallet_transactions LIMIT 1"))
        except Exception:
            db.rollback()
            try:
                db.execute(text("ALTER TABLE wallet_transactions ADD COLUMN status VARCHAR(50) DEFAULT 'COMPLETED' NOT NULL"))
                db.commit()
            except Exception as e:
                db.rollback()
                print("Schema update status col log:", e)
        
        try:
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
            else:
                if not admin_user.is_verified:
                    admin_user.is_verified = True
                    db.commit()
                
            # Seed default bank configs
            from .models.models import BankConfig
            defaults = [
                ("sbi", "State Bank of India", "SBI,STATE BANK", "NATIVE", "{}"),
                ("bob", "Bank of Baroda", "BOB,BARODA", "NATIVE", "{}"),
                ("axis", "Axis Bank", "AXIS,AXISBANK", "NATIVE", "{}")
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
            db.commit()
            
            try:
                db.execute(text("UPDATE bank_configs SET parser_type = 'NATIVE', name = 'Bank of Baroda', config_json = '{}' WHERE bank_key = 'bob'"))
                db.execute(text("UPDATE bank_configs SET parser_type = 'NATIVE', name = 'Axis Bank', config_json = '{}' WHERE bank_key = 'axis'"))
                db.commit()
            except Exception as e:
                db.rollback()
                print("BankConfig type update log:", e)
        except Exception as e:
            db.rollback()
            print("Startup data seeding error:", e)
    finally:
        db.close()

# Set up CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For V1/development, allow all origins. Can be restricted in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Bind api routers
app.include_router(auth.router, prefix="/api")
app.include_router(convert.router, prefix="/api")
app.include_router(wallet.router, prefix="/api")
app.include_router(admin.router, prefix="/api")
app.include_router(support.router, prefix="/api")

@app.get("/")
def read_root():
    return {
        "status": "online",
        "service": settings.PROJECT_NAME,
        "version": "1.0.0"
    }
