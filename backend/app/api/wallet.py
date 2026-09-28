from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from ..models.database import get_db
from ..models.models import User, WalletTransaction, PromoCode, PromoCodeRedemption
from ..schemas.schemas import WalletPurchaseRequest, UserResponse, WalletTransactionResponse
from .deps import get_current_user
from typing import List
from datetime import datetime, timezone
from pydantic import BaseModel

router = APIRouter(prefix="/wallet", tags=["Wallet & Billing"])

def get_utc_now():
    return datetime.now(timezone.utc)

@router.get("/balance", response_model=dict)
def get_balance(current_user: User = Depends(get_current_user)):
    return {
        "page_credits": current_user.page_credits
    }

@router.post("/purchase", response_model=WalletTransactionResponse)
def purchase_credits(
    purchase_in: WalletPurchaseRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if purchase_in.pages <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Purchase page count must be greater than zero."
        )
        
    if purchase_in.pages == 500:
        expected_amount = 125.00
        credits_to_add = 600  # 500 + 100 bonus
    elif purchase_in.pages == 1000:
        expected_amount = 250.00
        credits_to_add = 1250 # 1000 + 250 bonus
    else:
        expected_amount = float(purchase_in.pages) * 0.25
        credits_to_add = purchase_in.pages
        
    if abs(purchase_in.amount - expected_amount) > 0.01:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Incorrect payment amount. Base pricing is ₹0.25 per page credit. For {purchase_in.pages} pages, expected amount is ₹{expected_amount:.2f}."
        )
        
    tx = WalletTransaction(
        user_id=current_user.id,
        amount_in_inr=purchase_in.amount,
        pages_purchased=credits_to_add,
        balance_before=current_user.page_credits,
        balance_after=current_user.page_credits, # Stays same until approved
        type="PURCHASE",
        description=f"Purchased {purchase_in.pages} page credits (Bonus: {credits_to_add - purchase_in.pages} extra pages free, Pending Approval)",
        status="PENDING"
    )
    db.add(tx)
    db.commit()
    db.refresh(tx)
    return tx

@router.get("/transactions", response_model=List[WalletTransactionResponse])
def get_wallet_transactions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    return db.query(WalletTransaction).filter(
        WalletTransaction.user_id == current_user.id
    ).order_by(WalletTransaction.created_at.desc()).all()

class RedeemRequest(BaseModel):
    code: str

@router.post("/redeem", response_model=UserResponse)
def redeem_credit_code(
    payload: RedeemRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    code = payload.code.strip().upper()
    
    # Handle hardcoded legacy/test codes
    if code in ("SHEETBUDDY50", "BUDDY-EASTER-50"):
        existing_tx = db.query(WalletTransaction).filter(
            WalletTransaction.user_id == current_user.id,
            WalletTransaction.type.in_(["REDEEM", "PROMO"])
        ).first()
        
        if existing_tx:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="You have already redeemed your lifetime promo code!"
            )
            
        bal_before = current_user.page_credits
        current_user.page_credits += 50
        bal_after = current_user.page_credits
        
        tx = WalletTransaction(
            user_id=current_user.id,
            amount_in_inr=0.0,
            pages_purchased=50,
            balance_before=bal_before,
            balance_after=bal_after,
            type="PROMO",
            description=f"Redeemed promo code: {code}"
        )
        db.add(tx)
        db.commit()
        db.refresh(current_user)
        return current_user
        
    promo = db.query(PromoCode).filter(
        PromoCode.code == code,
        PromoCode.is_active == True
    ).first()
    
    if not promo:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or inactive promo code."
        )
        
    if promo.type == "TIME_BASED" and promo.expires_at:
        if get_utc_now() > promo.expires_at.replace(tzinfo=timezone.utc if promo.expires_at.tzinfo is None else None):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This promo code has expired."
            )
            
    # Check per-user redemption limit
    user_redeemed = db.query(WalletTransaction).filter(
        WalletTransaction.user_id == current_user.id,
        WalletTransaction.description.like(f"%{code}%")
    ).first()
    if user_redeemed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You have already redeemed this promo code!"
        )
        
    bal_before = current_user.page_credits
    current_user.page_credits += promo.credits
    bal_after = current_user.page_credits
    
    tx = WalletTransaction(
        user_id=current_user.id,
        amount_in_inr=0.0,
        pages_purchased=promo.credits,
        balance_before=bal_before,
        balance_after=bal_after,
        type="PROMO",
        description=f"Redeemed promo code: {code}"
    )
    db.add(tx)
    
    if promo.type == "UNIVERSAL_ONCE":
        promo.is_active = False
        
    db.commit()
    db.refresh(current_user)
    return current_user
