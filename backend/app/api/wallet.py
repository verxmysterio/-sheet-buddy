from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from ..models.database import get_db
from ..models.models import User, WalletTransaction
from ..schemas.schemas import WalletPurchaseRequest, UserResponse, WalletTransactionResponse
from .deps import get_current_user
from typing import List

router = APIRouter(prefix="/wallet", tags=["Wallet & Billing"])

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
        
    # Pricing rules: base ₹0.25/page, extra page credits for bulk volume packs
    if purchase_in.pages == 500:
        expected_amount = 125.00
        credits_to_add = 600  # 500 + 100 free
    elif purchase_in.pages == 1000:
        expected_amount = 250.00
        credits_to_add = 1250 # 1000 + 250 free
    else:
        expected_amount = float(purchase_in.pages) * 0.25
        credits_to_add = purchase_in.pages
        
    if abs(purchase_in.amount - expected_amount) > 0.01:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Incorrect payment amount. Base pricing is ₹0.25 per page credit. For {purchase_in.pages} pages, expected amount is ₹{expected_amount:.2f}."
        )
        
    # Log purchase transaction in PENDING state (admin must approve)
    tx = WalletTransaction(
        user_id=current_user.id,
        amount_in_inr=purchase_in.amount,
        pages_purchased=credits_to_add,
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
    txs = db.query(WalletTransaction).filter(
        WalletTransaction.user_id == current_user.id
    ).order_by(WalletTransaction.created_at.desc()).all()
    return txs

from pydantic import BaseModel

class RedeemRequest(BaseModel):
    code: str

@router.post("/redeem", response_model=UserResponse)
def redeem_credit_code(
    payload: RedeemRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    from ..models.models import PromoCode
    from datetime import datetime
    
    code = payload.code.strip().upper()
    
    # Handle hardcoded legacy/test codes for backward compatibility
    if code in ("SHEETBUDDY50", "BUDDY-EASTER-50"):
        existing_tx = db.query(WalletTransaction).filter(
            WalletTransaction.user_id == current_user.id,
            WalletTransaction.type == "REDEEM"
        ).first()
        
        if existing_tx:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="You have already redeemed your lifetime promo code!"
            )
            
        current_user.page_credits += 50
        tx = WalletTransaction(
            user_id=current_user.id,
            amount_in_inr=0.0,
            pages_purchased=50,
            type="REDEEM",
            description=f"Redeemed promo code: {code}"
        )
        db.add(tx)
        db.commit()
        db.refresh(current_user)
        return current_user
        
    # Query database for custom promo code
    promo = db.query(PromoCode).filter(
        PromoCode.code == code,
        PromoCode.is_active == True
    ).first()
    
    if not promo:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or inactive promo code."
        )
        
    # Check expiry
    if promo.type == "TIME_BASED" and promo.expires_at:
        if datetime.utcnow() > promo.expires_at:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This promo code has expired."
            )
            
    # Check universal redemption limit
    if promo.type == "UNIVERSAL_ONCE":
        global_redeemed = db.query(WalletTransaction).filter(
            WalletTransaction.type == "REDEEM",
            WalletTransaction.description == f"Redeemed promo code: {code}"
        ).first()
        if global_redeemed:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This universal promo code has already been redeemed."
            )
            
    # Check per-user redemption limit
    if promo.type == "PER_USER_ONCE":
        user_redeemed = db.query(WalletTransaction).filter(
            WalletTransaction.user_id == current_user.id,
            WalletTransaction.type == "REDEEM",
            WalletTransaction.description == f"Redeemed promo code: {code}"
        ).first()
        if user_redeemed:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="You have already redeemed this promo code!"
            )
            
    # Success: award credits
    current_user.page_credits += promo.credits
    
    # Log redemption
    tx = WalletTransaction(
        user_id=current_user.id,
        amount_in_inr=0.0,
        pages_purchased=promo.credits,
        type="REDEEM",
        description=f"Redeemed promo code: {code}"
    )
    db.add(tx)
    
    # Deactivate UNIVERSAL_ONCE promo code so it cannot be used again
    if promo.type == "UNIVERSAL_ONCE":
        promo.is_active = False
        
    db.commit()
    db.refresh(current_user)
    
    return current_user
