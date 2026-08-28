import uuid
from sqlalchemy import Column, String, Integer, Float, DateTime, ForeignKey, Text, Boolean
from sqlalchemy.orm import relationship
from datetime import datetime
from .database import Base

def generate_uuid():
    return str(uuid.uuid4())

class User(Base):
    __tablename__ = "users"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    email = Column(String(150), unique=True, index=True, nullable=False)
    hashed_password = Column(String(200), nullable=False)
    page_credits = Column(Integer, default=0, nullable=False)
    is_admin = Column(Boolean, default=False, nullable=False)
    is_verified = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    conversions = relationship("Conversion", back_populates="user", cascade="all, delete-orphan")
    wallet_transactions = relationship("WalletTransaction", back_populates="user", cascade="all, delete-orphan")

class Conversion(Base):
    __tablename__ = "conversions"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    bank_name = Column(String(100), nullable=False)
    account_number = Column(String(50), nullable=True)
    statement_period = Column(String(100), nullable=True)
    pages_count = Column(Integer, nullable=False)
    transactions_count = Column(Integer, nullable=False)
    status = Column(String(50), nullable=False, default="SUCCESS")  # SUCCESS, FAILED
    file_fingerprint = Column(String(64), nullable=False, index=True)  # SHA-256 file hash
    created_at = Column(DateTime, default=datetime.utcnow)
    
    user = relationship("User", back_populates="conversions")

class WalletTransaction(Base):
    __tablename__ = "wallet_transactions"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    amount_in_inr = Column(Float, nullable=False)
    pages_purchased = Column(Integer, nullable=False)  # positive for additions, negative for deductions
    type = Column(String(50), nullable=False)  # PURCHASE, DEBIT, REFUND
    description = Column(String(255), nullable=True)
    status = Column(String(50), nullable=False, default="COMPLETED")  # PENDING, APPROVED, REJECTED, COMPLETED
    created_at = Column(DateTime, default=datetime.utcnow)
    
    user = relationship("User", back_populates="wallet_transactions")

class BankConfig(Base):
    __tablename__ = "bank_configs"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    bank_key = Column(String(50), unique=True, index=True, nullable=False)
    name = Column(String(100), nullable=False)
    match_patterns = Column(Text, nullable=False)
    parser_type = Column(String(50), nullable=False) # SIMULATOR, RULE_BASED, NATIVE
    config_json = Column(Text, nullable=False, default="{}")
    created_at = Column(DateTime, default=datetime.utcnow)

class SupportQuery(Base):
    __tablename__ = "support_queries"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    subject = Column(String(200), nullable=False)
    description = Column(Text, nullable=False)
    whatsapp_number = Column(String(50), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    user = relationship("User")

class PromoCode(Base):
    __tablename__ = "promo_codes"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    code = Column(String(50), unique=True, index=True, nullable=False)
    credits = Column(Integer, nullable=False, default=50)
    type = Column(String(50), nullable=False) # UNIVERSAL_ONCE, PER_USER_ONCE, TIME_BASED
    is_active = Column(Boolean, default=True, nullable=False)
    expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class UserOTP(Base):
    __tablename__ = "user_otps"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    email = Column(String(150), nullable=False, index=True)
    otp_code = Column(String(10), nullable=False)
    purpose = Column(String(50), nullable=False)  # VERIFICATION, RECOVERY
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
