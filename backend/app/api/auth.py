import re
import secrets
import hashlib
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from ..core.security import hash_password, verify_password, create_access_token
from ..core.email_utils import send_otp_email, generate_otp
from ..models.database import get_db
from ..models.models import User, WalletTransaction, UserOTP, RefreshToken, AuditLog
from ..schemas.schemas import (
    UserCreate, LoginRequest, UserResponse, Token, RefreshTokenRequest,
    VerifyOTPRequest, ResendOTPRequest, ForgotPasswordRequest,
    ResetPasswordRequest, ChangePasswordRequest
)
from .deps import get_current_user

router = APIRouter(prefix="/auth", tags=["Authentication"])

def get_utc_now():
    return datetime.now(timezone.utc)

@router.post("/register", response_model=UserResponse)
def register(user_in: UserCreate, db: Session = Depends(get_db)):
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Registration is disabled. Please contact the administrator to get an account."
    )

@router.post("/login", response_model=Token)
def login_json(user_in: LoginRequest, request: Request, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == user_in.email).first()
    if not user or not verify_password(user_in.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password."
        )
    
    # 1. Issue Access Token (60 min standard, 365 days if remember)
    expires_delta = timedelta(days=365) if user_in.remember else timedelta(days=1)
    access_token = create_access_token(data={"sub": user.email}, expires_delta=expires_delta)
    
    # 2. Issue Refresh Token
    raw_refresh = secrets.token_urlsafe(64)
    token_hash = hashlib.sha256(raw_refresh.encode()).hexdigest()
    refresh_record = RefreshToken(
        user_id=user.id,
        token_hash=token_hash,
        expires_at=get_utc_now() + timedelta(days=365)
    )
    db.add(refresh_record)
    
    # Audit log
    audit = AuditLog(
        actor_id=user.id,
        actor_email=user.email,
        action="USER_LOGIN",
        entity_type="USER",
        entity_id=user.id,
        ip_address=request.client.host if request.client else None
    )
    db.add(audit)
    db.commit()
    
    return {
        "access_token": access_token, 
        "token_type": "bearer",
        "refresh_token": raw_refresh,
        "expires_in": int(expires_delta.total_seconds())
    }

@router.post("/refresh", response_model=Token)
def refresh_access_token(req: RefreshTokenRequest, db: Session = Depends(get_db)):
    token_hash = hashlib.sha256(req.refresh_token.encode()).hexdigest()
    record = db.query(RefreshToken).filter(
        RefreshToken.token_hash == token_hash,
        RefreshToken.is_revoked == False
    ).first()
    
    if not record or record.expires_at < get_utc_now():
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token.")
        
    user = db.query(User).filter(User.id == record.user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found.")
        
    new_access_token = create_access_token(data={"sub": user.email}, expires_delta=timedelta(days=1))
    return {
        "access_token": new_access_token,
        "token_type": "bearer",
        "refresh_token": req.refresh_token,
        "expires_in": 86400
    }

@router.post("/login-form", response_model=Token)
def login_form(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password."
        )
    
    access_token = create_access_token(data={"sub": user.email})
    return {"access_token": access_token, "token_type": "bearer"}

@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user

@router.post("/change-password")
def change_password(req: ChangePasswordRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not verify_password(req.old_password, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Incorrect current password.")
        
    current_user.hashed_password = hash_password(req.new_password)
    db.commit()
    return {"message": "Password changed successfully."}


@router.post("/forgot-password")
def forgot_password(req: ForgotPasswordRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == req.email).first()
    if not user:
        # Avoid user enumeration - return standard success message
        return {"message": "If the account exists, a recovery code has been sent."}
    
    otp_code = generate_otp()
    expires_at = get_utc_now() + timedelta(minutes=15)
    
    # Clean up any existing recovery OTPs for this email
    db.query(UserOTP).filter(UserOTP.email == req.email, UserOTP.purpose == "RECOVERY").delete()
    
    otp_entry = UserOTP(
        email=req.email,
        otp_code=otp_code,
        purpose="RECOVERY",
        expires_at=expires_at
    )
    db.add(otp_entry)
    db.commit()
    
    try:
        send_otp_email(req.email, otp_code, "RECOVERY")
    except Exception as e:
        db.delete(otp_entry)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to send recovery email: {str(e)}"
        )
    return {"message": "If the account exists, a recovery code has been sent."}

@router.post("/reset-password")
def reset_password(req: ResetPasswordRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == req.email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
        
    otp = db.query(UserOTP).filter(
        UserOTP.email == req.email,
        UserOTP.otp_code == req.otp_code,
        UserOTP.purpose == "RECOVERY"
    ).order_by(UserOTP.created_at.desc()).first()
    
    if not otp:
        raise HTTPException(status_code=400, detail="Invalid or expired recovery code.")
        
    now = get_utc_now()
    exp = otp.expires_at
    if exp.tzinfo is None:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
    if exp < now:
        db.delete(otp)
        db.commit()
        raise HTTPException(status_code=400, detail="Invalid or expired recovery code.")
        
    user.hashed_password = hash_password(req.new_password)
    user.is_verified = True
    db.delete(otp)
    db.commit()
    
    return {"message": "Password reset successfully. You can now log in."}
