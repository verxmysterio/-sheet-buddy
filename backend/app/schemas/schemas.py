from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

class UserCreate(BaseModel):
    email: str
    password: str

class UserResponse(BaseModel):
    id: str
    email: str
    page_credits: int
    is_admin: bool
    created_at: datetime

    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    email: Optional[str] = None

class ConversionResponse(BaseModel):
    id: str
    bank_name: str
    account_number: Optional[str] = None
    statement_period: Optional[str] = None
    pages_count: int
    transactions_count: int
    status: str
    created_at: datetime

    class Config:
        from_attributes = True

class WalletTransactionResponse(BaseModel):
    id: str
    amount_in_inr: float
    pages_purchased: int
    type: str
    description: Optional[str] = None
    status: str
    created_at: datetime

    class Config:
        from_attributes = True

class WalletPurchaseRequest(BaseModel):
    pages: int
    amount: float

class ConversionSummary(BaseModel):
    bank_name: str
    account_name: Optional[str] = None
    account_number: Optional[str] = None
    branch: Optional[str] = None
    statement_period: Optional[str] = None
    pages_count: int
    transactions_count: int
    opening_balance: float
    closing_balance: float

class SupportQueryCreate(BaseModel):
    subject: str
    description: str
    whatsapp_number: Optional[str] = None

class SupportQueryResponse(BaseModel):
    id: str
    user_id: str
    subject: str
    description: str
    whatsapp_number: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True

class PromoCodeCreate(BaseModel):
    code: str
    credits: int
    type: str # UNIVERSAL_ONCE, PER_USER_ONCE, TIME_BASED
    expires_at: Optional[datetime] = None

class PromoCodeResponse(BaseModel):
    id: str
    code: str
    credits: int
    type: str
    is_active: bool
    expires_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True
