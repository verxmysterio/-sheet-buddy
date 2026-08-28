import re
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from ..core.security import hash_password, verify_password, create_access_token
from ..models.database import get_db
from ..models.models import User, WalletTransaction, UserOTP
from ..schemas.schemas import (
    UserCreate, UserResponse, Token,
    VerifyOTPRequest, ResendOTPRequest, ForgotPasswordRequest,
    ResetPasswordRequest, ChangePasswordRequest
)
from ..core.email_utils import generate_otp, send_otp_email
from .deps import get_current_user

router = APIRouter(prefix="/auth", tags=["Authentication"])

EMAIL_REGEX = re.compile(r"^[^@]+@[^@]+\.[^@]+$")

@router.post("/register", response_model=UserResponse)
def register(user_in: UserCreate, db: Session = Depends(get_db)):
    # 1. Email format check
    if not EMAIL_REGEX.match(user_in.email):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid email address format."
        )
        
    # 2. Check if user already exists
    existing_user = db.query(User).filter(User.email == user_in.email).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="An account with this email already exists."
        )
        
    # 3. Create user (and grant 100 free page credits for testing/V1 onboarding)
    hashed_pwd = hash_password(user_in.password)
    user = User(
        email=user_in.email,
        hashed_password=hashed_pwd,
        page_credits=100,
        is_verified=False
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    
    # Log the free onboarding credit transaction
    credit_tx = WalletTransaction(
        user_id=user.id,
        amount_in_inr=0.0,
        pages_purchased=100,
        type="REFUND",
        description="Free onboarding credits (V1 promo)"
    )
    db.add(credit_tx)
    db.commit()
    
    # Generate and send verification OTP code
    otp_code = generate_otp()
    expires_at = datetime.utcnow() + timedelta(minutes=15)
    otp_entry = UserOTP(
        email=user.email,
        otp_code=otp_code,
        purpose="VERIFICATION",
        expires_at=expires_at
    )
    db.add(otp_entry)
    db.commit()
    
    try:
        send_otp_email(user.email, otp_code, "VERIFICATION")
    except Exception as e:
        db.delete(otp_entry)
        db.delete(credit_tx)
        db.delete(user)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to send verification email: {str(e)}. Please check your SMTP environment variables."
        )
    
    return user

@router.post("/login", response_model=Token)
def login_json(user_in: UserCreate, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == user_in.email).first()
    if not user or not verify_password(user_in.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password."
        )
    
    # Block login if not verified
    if not user.is_verified:
        otp_code = generate_otp()
        expires_at = datetime.utcnow() + timedelta(minutes=15)
        otp_entry = UserOTP(
            email=user.email,
            otp_code=otp_code,
            purpose="VERIFICATION",
            expires_at=expires_at
        )
        db.add(otp_entry)
        db.commit()
        try:
            send_otp_email(user.email, otp_code, "VERIFICATION")
        except Exception as e:
            db.delete(otp_entry)
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Account is not verified. Failed to auto-send a new verification code: {str(e)}."
            )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="NOT_VERIFIED"
        )
        
    access_token = create_access_token(data={"sub": user.email})
    return {"access_token": access_token, "token_type": "bearer"}

@router.post("/login-form", response_model=Token)
def login_form(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password."
        )
    
    # Block login if not verified
    if not user.is_verified:
        otp_code = generate_otp()
        expires_at = datetime.utcnow() + timedelta(minutes=15)
        otp_entry = UserOTP(
            email=user.email,
            otp_code=otp_code,
            purpose="VERIFICATION",
            expires_at=expires_at
        )
        db.add(otp_entry)
        db.commit()
        try:
            send_otp_email(user.email, otp_code, "VERIFICATION")
        except Exception as e:
            db.delete(otp_entry)
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Account is not verified. Failed to auto-send a new verification code: {str(e)}."
            )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="NOT_VERIFIED"
        )
        
    access_token = create_access_token(data={"sub": user.email})
    return {"access_token": access_token, "token_type": "bearer"}

@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user

@router.post("/verify-otp", response_model=Token)
def verify_otp(req: VerifyOTPRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == req.email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
        
    # Find matching active verification OTP
    otp = db.query(UserOTP).filter(
        UserOTP.email == req.email,
        UserOTP.otp_code == req.otp_code,
        UserOTP.purpose == "VERIFICATION",
        UserOTP.expires_at > datetime.utcnow()
    ).first()
    
    if not otp:
        raise HTTPException(status_code=400, detail="Invalid or expired verification code.")
        
    user.is_verified = True
    db.delete(otp)
    db.commit()
    
    access_token = create_access_token(data={"sub": user.email})
    return {"access_token": access_token, "token_type": "bearer"}

@router.post("/resend-otp")
def resend_otp(req: ResendOTPRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == req.email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    if user.is_verified:
        return {"message": "Account already verified."}
        
    # Generate new verification OTP code
    otp_code = generate_otp()
    expires_at = datetime.utcnow() + timedelta(minutes=15)
    otp_entry = UserOTP(
        email=req.email,
        otp_code=otp_code,
        purpose="VERIFICATION",
        expires_at=expires_at
    )
    db.add(otp_entry)
    db.commit()
    
    try:
        send_otp_email(req.email, otp_code, "VERIFICATION")
    except Exception as e:
        db.delete(otp_entry)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to send email: {str(e)}. Please check your SMTP environment variables."
        )
    return {"message": "Verification code resent successfully."}

@router.post("/forgot-password")
def forgot_password(req: ForgotPasswordRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == req.email).first()
    if not user:
        # Silence email enumeration attacks by returning success
        return {"message": "If the account exists, a recovery code has been sent."}
        
    # Generate recovery OTP code
    otp_code = generate_otp()
    expires_at = datetime.utcnow() + timedelta(minutes=15)
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
            detail=f"Failed to send recovery email: {str(e)}."
        )
    return {"message": "If the account exists, a recovery code has been sent."}

@router.post("/reset-password")
def reset_password(req: ResetPasswordRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == req.email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
        
    # Verify active recovery OTP
    otp = db.query(UserOTP).filter(
        UserOTP.email == req.email,
        UserOTP.otp_code == req.otp_code,
        UserOTP.purpose == "RECOVERY",
        UserOTP.expires_at > datetime.utcnow()
    ).first()
    
    if not otp:
        raise HTTPException(status_code=400, detail="Invalid or expired recovery code.")
        
    user.hashed_password = hash_password(req.new_password)
    user.is_verified = True  # Auto-verify account upon successful recovery reset
    db.delete(otp)
    db.commit()
    
    return {"message": "Password reset successfully. You can now log in."}

@router.post("/change-password")
def change_password(req: ChangePasswordRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not verify_password(req.old_password, current_user.hashed_password):
        raise HTTPException(status_code= status.HTTP_400_BAD_REQUEST, detail="Incorrect current password.")
        
    current_user.hashed_password = hash_password(req.new_password)
    db.commit()
    return {"message": "Password changed successfully."}
