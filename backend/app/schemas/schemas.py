from pydantic import BaseModel, ConfigDict, Field
from typing import Optional, List, Dict, Any
from datetime import datetime, date

class UserCreate(BaseModel):
    email: str
    password: str

class LoginRequest(BaseModel):
    email: str
    password: str
    remember: bool = False

class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    
    id: str
    email: str
    page_credits: int
    is_admin: bool
    is_verified: bool
    created_at: datetime

class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    refresh_token: Optional[str] = None
    expires_in: int = 3600

class RefreshTokenRequest(BaseModel):
    refresh_token: str

class TokenData(BaseModel):
    email: Optional[str] = None

class ConversionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    
    id: str
    bank_name: str
    account_number: Optional[str] = None
    statement_period: Optional[str] = None
    pages_count: int
    transactions_count: int
    status: str
    is_reconciled: Optional[bool] = True
    opening_balance: Optional[float] = 0.0
    closing_balance: Optional[float] = 0.0
    created_at: datetime

class WalletTransactionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    
    id: str
    amount_in_inr: float
    pages_purchased: int
    balance_before: Optional[int] = 0
    balance_after: Optional[int] = 0
    type: str
    description: Optional[str] = None
    status: str
    created_at: datetime

class WalletPurchaseRequest(BaseModel):
    pages: int
    amount: float
    plan_name: Optional[str] = "Custom Credits"

class LedgerRuleCreate(BaseModel):
    rule_name: str
    pattern: str
    match_type: str = "CONTAINS" # CONTAINS, STARTS_WITH, ENDS_WITH, REGEX, EXACT
    min_amount: Optional[float] = None
    max_amount: Optional[float] = None
    txn_type: Optional[str] = "ANY"
    ledger_name: str
    voucher_type: str = "Payment"
    category: str = "General"
    priority: int = 10

class LedgerRuleResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    
    id: str
    user_id: str
    client_id: Optional[str] = None
    rule_name: str
    pattern: str
    match_type: str
    min_amount: Optional[float] = None
    max_amount: Optional[float] = None
    txn_type: Optional[str] = None
    ledger_name: str
    voucher_type: str
    category: str
    priority: int
    is_active: bool
    created_at: datetime

class ClientCreate(BaseModel):
    name: str
    pan: Optional[str] = None
    gstin: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    notes: Optional[str] = None

class ClientResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    
    id: str
    organization_id: Optional[str] = None
    user_id: Optional[str] = None
    name: str
    pan: Optional[str] = None
    gstin: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    notes: Optional[str] = None
    status: str
    created_at: datetime

class AuditLogResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    
    id: str
    actor_id: Optional[str] = None
    actor_email: Optional[str] = None
    action: str
    entity_type: str
    entity_id: Optional[str] = None
    old_value: Optional[str] = None
    new_value: Optional[str] = None
    ip_address: Optional[str] = None
    created_at: datetime

class SupportQueryCreate(BaseModel):
    subject: str
    description: str
    whatsapp_number: Optional[str] = None

class SupportQueryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    
    id: str
    user_id: str
    subject: str
    description: str
    whatsapp_number: Optional[str] = None
    created_at: datetime

class PromoCodeCreate(BaseModel):
    code: str
    credits: int
    type: str = "PER_USER_ONCE" # UNIVERSAL_ONCE, PER_USER_ONCE, TIME_BASED
    expires_at: Optional[datetime] = None

class PromoCodeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    
    id: str
    code: str
    credits: int
    type: str
    is_active: bool
    expires_at: Optional[datetime] = None
    created_at: datetime

class VerifyOTPRequest(BaseModel):
    email: str
    otp_code: str

class ResendOTPRequest(BaseModel):
    email: str

class ForgotPasswordRequest(BaseModel):
    email: str

class ResetPasswordRequest(BaseModel):
    email: str
    otp_code: str
    new_password: str

class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str
