from pydantic import BaseModel
from typing import List, Optional
from abc import ABC, abstractmethod
from datetime import date

class StandardTransaction(BaseModel):
    txn_date: date
    val_date: date
    narration: str
    ref_no: Optional[str] = None
    debit: Optional[float] = None
    credit: Optional[float] = None
    balance: float
    branch_code: Optional[str] = None

class StatementMetadata(BaseModel):
    bank_name: str
    account_name: Optional[str] = None
    account_number: Optional[str] = None
    branch: Optional[str] = None
    statement_period: Optional[str] = None
    opening_balance: float
    closing_balance: float
    pages_count: int
    transactions_count: int

class BankParser(ABC):
    @abstractmethod
    def parse(self, pdf_path: str) -> tuple[StatementMetadata, List[StandardTransaction]]:
        """
        Parses a digital bank statement PDF and returns its metadata
        and a list of standardized transactions.
        """
        pass

def reconcile_statement(opening_balance: float, transactions: List[StandardTransaction], closing_balance: float) -> bool:
    """
    Validates that: Opening Balance + Total Credits - Total Debits == Closing Balance
    """
    total_credits = sum(tx.credit for tx in transactions if tx.credit is not None)
    total_debits = sum(tx.debit for tx in transactions if tx.debit is not None)
    
    expected_closing = opening_balance + total_credits - total_debits
    return abs(expected_closing - closing_balance) < 0.05
