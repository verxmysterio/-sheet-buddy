from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from ..models.database import get_db
from ..models.models import User, Conversion, WalletTransaction
from .deps import get_current_user
from pydantic import BaseModel
from ..schemas.schemas import PromoCodeCreate, PromoCodeResponse
from typing import List

router = APIRouter(prefix="/admin", tags=["Admin Operations"])

def get_current_admin(current_user: User = Depends(get_current_user)):
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have administrative access rights."
        )
    return current_user

class CreditUpdateRequest(BaseModel):
    credits: int

@router.get("/users")
def list_users(
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin)
):
    users = db.query(User).all()
    res = []
    for u in users:
        conv_count = db.query(Conversion).filter(Conversion.user_id == u.id).count()
        res.append({
            "id": u.id,
            "email": u.email,
            "page_credits": u.page_credits,
            "is_admin": u.is_admin,
            "created_at": u.created_at,
            "conversion_count": conv_count
        })
    return res

@router.post("/users/{user_id}/credits")
def adjust_user_credits(
    user_id: str,
    payload: CreditUpdateRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin)
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
        
    user.page_credits += payload.credits
    
    # Log transaction
    tx = WalletTransaction(
        user_id=user.id,
        amount_in_inr=0.0,
        pages_purchased=payload.credits,
        type="ADMIN_ADJUST",
        description=f"Adjusted by Admin: {payload.credits} page credits"
    )
    db.add(tx)
    db.commit()
    db.refresh(user)
    return {
        "user_id": user.id,
        "email": user.email,
        "new_credits": user.page_credits
    }

@router.post("/users/{user_id}/toggle-admin")
def toggle_user_admin(
    user_id: str,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin)
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
        
    user.is_admin = not user.is_admin
    db.commit()
    return {
        "user_id": user.id,
        "email": user.email,
        "is_admin": user.is_admin
    }

@router.get("/stats")
def get_global_stats(
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin)
):
    total_users = db.query(User).count()
    total_conversions = db.query(Conversion).count()
    
    # Sum credits
    total_credits = sum(u.page_credits for u in db.query(User).all())
    
    # Sum simulated revenue
    payments = db.query(WalletTransaction).filter(WalletTransaction.type == "PURCHASE").all()
    total_revenue = sum(p.amount_in_inr for p in payments)
    
    # Bank stats
    bank_stats = {}
    convs = db.query(Conversion).all()
    for c in convs:
        bank_stats[c.bank_name] = bank_stats.get(c.bank_name, 0) + 1
        
    return {
        "total_users": total_users,
        "total_conversions": total_conversions,
        "total_credits": total_credits,
        "total_revenue": total_revenue,
        "bank_stats": bank_stats
    }

@router.get("/conversions")
def get_global_conversions(
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin)
):
    convs = db.query(Conversion).order_by(Conversion.created_at.desc()).all()
    res = []
    for c in convs:
        res.append({
            "id": c.id,
            "user_email": c.user.email if c.user else "Deleted User",
            "bank_name": c.bank_name,
            "statement_period": c.statement_period,
            "pages_count": c.pages_count,
            "transactions_count": c.transactions_count,
            "created_at": c.created_at,
            "status": c.status
        })
    return res

@router.get("/payments")
def get_global_payments(
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin)
):
    txs = db.query(WalletTransaction).filter(WalletTransaction.type == "PURCHASE").order_by(WalletTransaction.created_at.desc()).all()
    res = []
    for t in txs:
        res.append({
            "id": t.id,
            "user_email": t.user.email if t.user else "Deleted User",
            "amount_in_inr": t.amount_in_inr,
            "pages_purchased": t.pages_purchased,
            "description": t.description,
            "status": getattr(t, 'status', 'COMPLETED'),
            "created_at": t.created_at
        })
    return res

@router.post("/payments/{tx_id}/approve")
def approve_payment(
    tx_id: str,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin)
):
    tx = db.query(WalletTransaction).filter(WalletTransaction.id == tx_id).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found.")
        
    status_val = getattr(tx, 'status', 'COMPLETED')
    if status_val != 'PENDING':
        raise HTTPException(status_code=400, detail=f"Transaction is already {status_val}.")
        
    tx.status = 'APPROVED'
    tx.description = f"Purchased {tx.pages_purchased} page credits (Approved by Admin)"
    
    user = tx.user
    if user:
        user.page_credits += tx.pages_purchased
        
    db.commit()
    return {"status": "success", "detail": f"Approved transaction {tx_id}. User credited."}

@router.post("/payments/{tx_id}/reject")
def reject_payment(
    tx_id: str,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin)
):
    tx = db.query(WalletTransaction).filter(WalletTransaction.id == tx_id).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found.")
        
    status_val = getattr(tx, 'status', 'COMPLETED')
    if status_val != 'PENDING':
        raise HTTPException(status_code=400, detail=f"Transaction is already {status_val}.")
        
    tx.status = 'REJECTED'
    tx.description = f"Purchased {tx.pages_purchased} page credits (Rejected by Admin)"
    db.commit()
    return {"status": "success", "detail": f"Rejected transaction {tx_id}."}

class BankConfigSchema(BaseModel):
    bank_key: str
    name: str
    match_patterns: str
    parser_type: str
    config_json: str

@router.get("/banks")
def list_banks(
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin)
):
    from ..models.models import BankConfig
    configs = db.query(BankConfig).all()
    res = []
    for c in configs:
        res.append({
            "id": c.id,
            "bank_key": c.bank_key,
            "name": c.name,
            "match_patterns": c.match_patterns,
            "parser_type": c.parser_type,
            "config_json": c.config_json,
            "created_at": c.created_at
        })
    return res

@router.post("/banks")
def create_bank(
    payload: BankConfigSchema,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin)
):
    from ..models.models import BankConfig
    
    dup = db.query(BankConfig).filter(BankConfig.bank_key == payload.bank_key).first()
    if dup:
        raise HTTPException(status_code=400, detail="Bank key must be unique.")
        
    cfg = BankConfig(
        bank_key=payload.bank_key,
        name=payload.name,
        match_patterns=payload.match_patterns,
        parser_type=payload.parser_type,
        config_json=payload.config_json
    )
    db.add(cfg)
    db.commit()
    db.refresh(cfg)
    return {
        "id": cfg.id,
        "bank_key": cfg.bank_key,
        "name": cfg.name,
        "match_patterns": cfg.match_patterns,
        "parser_type": cfg.parser_type,
        "config_json": cfg.config_json
    }

@router.put("/banks/{bank_id}")
def update_bank(
    bank_id: str,
    payload: BankConfigSchema,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin)
):
    from ..models.models import BankConfig
    cfg = db.query(BankConfig).filter(BankConfig.id == bank_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="Bank configuration not found.")
        
    cfg.bank_key = payload.bank_key
    cfg.name = payload.name
    cfg.match_patterns = payload.match_patterns
    cfg.parser_type = payload.parser_type
    cfg.config_json = payload.config_json
    
    db.commit()
    db.refresh(cfg)
    return {
        "id": cfg.id,
        "bank_key": cfg.bank_key,
        "name": cfg.name,
        "match_patterns": cfg.match_patterns,
        "parser_type": cfg.parser_type,
        "config_json": cfg.config_json
    }

@router.delete("/banks/{bank_id}")
def delete_bank(
    bank_id: str,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin)
):
    from ..models.models import BankConfig
    cfg = db.query(BankConfig).filter(BankConfig.id == bank_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="Bank configuration not found.")
        
    db.delete(cfg)
    db.commit()
    return {"detail": "Bank configuration deleted successfully."}

@router.get("/support-queries")
def list_support_queries(
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin)
):
    from ..models.models import SupportQuery
    queries = db.query(SupportQuery).order_by(SupportQuery.created_at.desc()).all()
    res = []
    for q in queries:
        res.append({
            "id": q.id,
            "user_email": q.user.email if q.user else "Deleted User",
            "subject": q.subject,
            "description": q.description,
            "whatsapp_number": q.whatsapp_number,
            "created_at": q.created_at
        })
    return res

@router.post("/promo-codes", response_model=PromoCodeResponse)
def create_promo_code(
    promo_in: PromoCodeCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin)
):
    from ..models.models import PromoCode
    # Check if code already exists
    existing = db.query(PromoCode).filter(PromoCode.code == promo_in.code.strip().upper()).first()
    if existing:
        raise HTTPException(status_code=400, detail="Promo code already exists.")
        
    promo = PromoCode(
        code=promo_in.code.strip().upper(),
        credits=promo_in.credits,
        type=promo_in.type, # UNIVERSAL_ONCE, PER_USER_ONCE, TIME_BASED
        expires_at=promo_in.expires_at,
        is_active=True
    )
    db.add(promo)
    db.commit()
    db.refresh(promo)
    return promo

@router.get("/promo-codes", response_model=List[PromoCodeResponse])
def list_promo_codes(
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin)
):
    from ..models.models import PromoCode
    codes = db.query(PromoCode).order_by(PromoCode.created_at.desc()).all()
    return codes

@router.post("/promo-codes/{code_id}/toggle")
def toggle_promo_code(
    code_id: str,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin)
):
    from ..models.models import PromoCode
    promo = db.query(PromoCode).filter(PromoCode.id == code_id).first()
    if not promo:
        raise HTTPException(status_code=404, detail="Promo code not found.")
    promo.is_active = not promo.is_active
    db.commit()
    return {"status": "success", "is_active": promo.is_active}

class AdminUserCreateRequest(BaseModel):
    email: str
    password: str
    page_credits: int = 100
    is_admin: bool = False

@router.post("/users")
def create_user(
    payload: AdminUserCreateRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin)
):
    from ..core.security import hash_password
    import re
    EMAIL_REGEX = re.compile(r"^[^@]+@[^@]+\.[^@]+$")
    if not EMAIL_REGEX.match(payload.email):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid email address format."
        )
        
    # Check if user already exists
    existing = db.query(User).filter(User.email == payload.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="User already exists.")
        
    new_user = User(
        email=payload.email,
        hashed_password=hash_password(payload.password),
        page_credits=payload.page_credits,
        is_admin=payload.is_admin,
        is_verified=True
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    # Log credit addition transaction
    tx = WalletTransaction(
        user_id=new_user.id,
        amount_in_inr=0.0,
        pages_purchased=payload.page_credits,
        type="REFUND",
        description="Admin seeded credits on creation"
    )
    db.add(tx)
    db.commit()
    
    return {"message": "User created successfully.", "user_id": new_user.id}
