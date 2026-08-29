import re
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from ..core.security import hash_password, verify_password, create_access_token
from ..models.database import get_db
from ..models.models import User, WalletTransaction, UserOTP
from ..schemas.schemas import (
    UserCreate, LoginRequest, UserResponse, Token,
    VerifyOTPRequest, ResendOTPRequest, ForgotPasswordRequest,
    ResetPasswordRequest, ChangePasswordRequest
)
from ..core.email_utils import generate_otp, send_otp_email
from .deps import get_current_user

router = APIRouter(prefix="/auth", tags=["Authentication"])

EMAIL_REGEX = re.compile(r"^[^@]+@[^@]+\.[^@]+$")

@router.post("/register", response_model=UserResponse)
def register(user_in: UserCreate, db: Session = Depends(get_db)):
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Registration is disabled. Please contact the administrator to get an account."
    )

@router.post("/login", response_model=Token)
def login_json(user_in: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == user_in.email).first()
    if not user or not verify_password(user_in.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password."
        )
    
    # If remember is checked, issue a 365-day token. Otherwise, standard 1-day.
    expires_delta = timedelta(days=365) if user_in.remember else timedelta(days=1)
    access_token = create_access_token(data={"sub": user.email}, expires_delta=expires_delta)
    return {"access_token": access_token, "token_type": "bearer"}

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
