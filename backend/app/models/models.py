import uuid
from sqlalchemy import Column, String, Integer, Float, DateTime, ForeignKey, Text, Boolean
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
from .database import Base

def generate_uuid():
    return str(uuid.uuid4())

def get_utc_now():
    return datetime.now(timezone.utc)

class User(Base):
    __tablename__ = "users"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    email = Column(String(150), unique=True, index=True, nullable=False)
    hashed_password = Column(String(200), nullable=False)
    page_credits = Column(Integer, default=0, nullable=False)
    is_admin = Column(Boolean, default=False, nullable=False)
    is_verified = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=get_utc_now)
    updated_at = Column(DateTime, default=get_utc_now, onupdate=get_utc_now)
    
    conversions = relationship("Conversion", back_populates="user", cascade="all, delete-orphan")
    wallet_transactions = relationship("WalletTransaction", back_populates="user", cascade="all, delete-orphan")
    ledger_rules = relationship("LedgerRule", back_populates="user", cascade="all, delete-orphan")
    refresh_tokens = relationship("RefreshToken", back_populates="user", cascade="all, delete-orphan")

class Organization(Base):
    __tablename__ = "organizations"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    name = Column(String(200), nullable=False)
    pan = Column(String(10), nullable=True)
    gstin = Column(String(15), nullable=True)
    plan_type = Column(String(50), default="STANDARD", nullable=False)
    created_at = Column(DateTime, default=get_utc_now)
    
    members = relationship("OrganizationMember", back_populates="organization", cascade="all, delete-orphan")
    clients = relationship("Client", back_populates="organization", cascade="all, delete-orphan")

class OrganizationMember(Base):
    __tablename__ = "organization_members"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), ForeignKey("organizations.id"), nullable=False)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    role = Column(String(50), default="ACCOUNTANT", nullable=False)  # OWNER, ADMIN, ACCOUNTANT, REVIEWER, VIEWER
    created_at = Column(DateTime, default=get_utc_now)
    
    organization = relationship("Organization", back_populates="members")
    user = relationship("User")

class Client(Base):
    __tablename__ = "clients"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), ForeignKey("organizations.id"), nullable=True)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=True)
    name = Column(String(200), nullable=False)
    pan = Column(String(10), nullable=True)
    gstin = Column(String(15), nullable=True)
    email = Column(String(150), nullable=True)
    phone = Column(String(20), nullable=True)
    notes = Column(Text, nullable=True)
    status = Column(String(50), default="ACTIVE", nullable=False)
    created_at = Column(DateTime, default=get_utc_now)
    
    organization = relationship("Organization", back_populates="clients")
    conversions = relationship("Conversion", back_populates="client")

class Conversion(Base):
    __tablename__ = "conversions"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    client_id = Column(String(36), ForeignKey("clients.id"), nullable=True)
    bank_name = Column(String(100), nullable=False)
    account_number = Column(String(50), nullable=True)
    statement_period = Column(String(100), nullable=True)
    pages_count = Column(Integer, nullable=False)
    transactions_count = Column(Integer, nullable=False)
    status = Column(String(50), nullable=False, default="SUCCESS")  # SUCCESS, FAILED
    file_fingerprint = Column(String(64), nullable=False, index=True)  # SHA-256 file hash
    is_reconciled = Column(Boolean, default=True, nullable=False)
    opening_balance = Column(Float, default=0.0, nullable=False)
    closing_balance = Column(Float, default=0.0, nullable=False)
    cached_xml = Column(Text, nullable=True)
    created_at = Column(DateTime, default=get_utc_now)
    
    user = relationship("User", back_populates="conversions")
    client = relationship("Client", back_populates="conversions")

class LedgerRule(Base):
    __tablename__ = "ledger_rules"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    client_id = Column(String(36), ForeignKey("clients.id"), nullable=True)
    rule_name = Column(String(100), nullable=False)
    pattern = Column(String(200), nullable=False)
    match_type = Column(String(50), default="CONTAINS", nullable=False) # CONTAINS, STARTS_WITH, ENDS_WITH, REGEX, EXACT
    min_amount = Column(Float, nullable=True)
    max_amount = Column(Float, nullable=True)
    txn_type = Column(String(20), nullable=True)  # CREDIT, DEBIT, ANY
    ledger_name = Column(String(150), nullable=False)
    voucher_type = Column(String(50), default="Payment", nullable=False)
    category = Column(String(100), default="General", nullable=False)
    priority = Column(Integer, default=10, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=get_utc_now)
    
    user = relationship("User", back_populates="ledger_rules")

class WalletTransaction(Base):
    __tablename__ = "wallet_transactions"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    amount_in_inr = Column(Float, nullable=False)
    pages_purchased = Column(Integer, nullable=False)  # positive for additions, negative for deductions
    balance_before = Column(Integer, default=0, nullable=False)
    balance_after = Column(Integer, default=0, nullable=False)
    type = Column(String(50), nullable=False)  # PURCHASE, CONVERSION, ADMIN_ADJUSTMENT, PROMO, REFUND, BONUS
    reference_type = Column(String(50), nullable=True)  # CONVERSION_ID, PAYMENT_TICKET_ID, PROMO_CODE
    reference_id = Column(String(100), nullable=True)
    description = Column(String(255), nullable=True)
    status = Column(String(50), nullable=False, default="COMPLETED")  # PENDING, APPROVED, REJECTED, COMPLETED
    created_at = Column(DateTime, default=get_utc_now)
    
    user = relationship("User", back_populates="wallet_transactions")

class AuditLog(Base):
    __tablename__ = "audit_logs"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    actor_id = Column(String(36), nullable=True)
    actor_email = Column(String(150), nullable=True)
    action = Column(String(100), nullable=False)  # CREDIT_ADJUSTMENT, PROMO_CREATE, USER_CREATE, PAYMENT_APPROVE, etc.
    entity_type = Column(String(50), nullable=False)
    entity_id = Column(String(50), nullable=True)
    old_value = Column(Text, nullable=True)
    new_value = Column(Text, nullable=True)
    ip_address = Column(String(50), nullable=True)
    user_agent = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=get_utc_now)

class BankConfig(Base):
    __tablename__ = "bank_configs"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    bank_key = Column(String(50), unique=True, index=True, nullable=False)
    name = Column(String(100), nullable=False)
    match_patterns = Column(Text, nullable=False)
    parser_type = Column(String(50), nullable=False) # SIMULATOR, RULE_BASED, NATIVE
    config_json = Column(Text, nullable=False, default="{}")
    created_at = Column(DateTime, default=get_utc_now)

class SupportQuery(Base):
    __tablename__ = "support_queries"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    subject = Column(String(200), nullable=False)
    description = Column(Text, nullable=False)
    whatsapp_number = Column(String(50), nullable=True)
    status = Column(String(50), default="OPEN", nullable=False)
    created_at = Column(DateTime, default=get_utc_now)
    
    user = relationship("User")

class PromoCode(Base):
    __tablename__ = "promo_codes"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    code = Column(String(50), unique=True, index=True, nullable=False)
    credits = Column(Integer, nullable=False, default=50)
    type = Column(String(50), nullable=False) # UNIVERSAL_ONCE, PER_USER_ONCE, TIME_BASED
    is_active = Column(Boolean, default=True, nullable=False)
    expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=get_utc_now)

class PromoCodeRedemption(Base):
    __tablename__ = "promo_code_redemptions"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    promo_code_id = Column(String(36), ForeignKey("promo_codes.id"), nullable=False)
    redeemed_at = Column(DateTime, default=get_utc_now)

class RefreshToken(Base):
    __tablename__ = "refresh_tokens"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    token_hash = Column(String(64), unique=True, index=True, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    is_revoked = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=get_utc_now)
    
    user = relationship("User", back_populates="refresh_tokens")

class UserOTP(Base):
    __tablename__ = "user_otps"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    email = Column(String(150), nullable=False, index=True)
    otp_code = Column(String(10), nullable=False)
    purpose = Column(String(50), nullable=False)  # VERIFICATION, RECOVERY
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=get_utc_now)
