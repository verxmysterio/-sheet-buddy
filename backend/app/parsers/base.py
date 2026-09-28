from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from abc import ABC, abstractmethod
from datetime import date, datetime
import uuid
import re

class StandardTransaction(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    txn_date: date
    val_date: Optional[date] = None
    narration: str
    ref_no: Optional[str] = None
    debit: Optional[float] = None
    credit: Optional[float] = None
    balance: float
    branch_code: Optional[str] = None
    
    # Enhanced v2 Accounting Fields
    utr: Optional[str] = None
    upi_reference: Optional[str] = None
    neft_reference: Optional[str] = None
    rtgs_reference: Optional[str] = None
    imps_reference: Optional[str] = None
    cheque_number: Optional[str] = None
    transaction_type: str = "DEBIT"  # DEBIT or CREDIT
    category: str = "Unknown"
    suggested_ledger: Optional[str] = None
    assigned_ledger: Optional[str] = None
    voucher_type: str = "Payment"  # Payment or Receipt
    confidence_score: float = 100.0
    confidence_grade: str = "HIGH"  # HIGH, MEDIUM, LOW
    reconciliation_status: str = "PASS"  # PASS, WARNING, FAIL, UNKNOWN
    reconciliation_difference: float = 0.0
    expected_balance: Optional[float] = None
    is_duplicate: bool = False
    duplicate_type: Optional[str] = None  # EXACT, PROBABLE, POSSIBLE
    duplicate_reason: Optional[str] = None
    requires_review: bool = False
    review_reasons: List[str] = Field(default_factory=list)
    parser_name: Optional[str] = None
    parser_version: str = "2.0"
    page_number: int = 1
    source_row: Optional[int] = None
    raw_text: Optional[str] = None

    def __init__(self, **data):
        if 'val_date' not in data or data['val_date'] is None:
            data['val_date'] = data.get('txn_date')
        if 'transaction_type' not in data:
            if data.get('credit') and data['credit'] > 0:
                data['transaction_type'] = "CREDIT"
                data['voucher_type'] = "Receipt"
            else:
                data['transaction_type'] = "DEBIT"
                data['voucher_type'] = "Payment"
        super().__init__(**data)

# Alias for semantic clarity
ParsedTransaction = StandardTransaction

class StatementMetadata(BaseModel):
    bank_name: str
    account_name: Optional[str] = None
    account_number: Optional[str] = None
    branch: Optional[str] = None
    ifsc_code: Optional[str] = None
    statement_period: Optional[str] = None
    opening_balance: float
    closing_balance: float
    total_debits: float = 0.0
    total_credits: float = 0.0
    pages_count: int
    transactions_count: int
    is_reconciled: bool = False
    reconciliation_discrepancy: float = 0.0
    detected_bank: Optional[str] = None
    detection_confidence: float = 100.0
    detection_signals: List[str] = Field(default_factory=list)
    format_version: str = "v2"
    parser_name: Optional[str] = None
    review_queue_count: int = 0
    duplicate_count: int = 0
    high_confidence_count: int = 0

class BankParser(ABC):
    @abstractmethod
    def parse(self, pdf_path_or_bytes: Any) -> tuple[StatementMetadata, List[StandardTransaction]]:
        """
        Parses a digital bank statement PDF and returns its metadata
        and a list of standardized transactions.
        """
        pass

# --- Reference and UTR Extractor ---
def extract_references_from_narration(narration: str) -> Dict[str, Optional[str]]:
    """
    Extracts Indian banking reference tokens (UPI, UTR, NEFT, RTGS, IMPS, Cheque No) from transaction narration.
    """
    refs: Dict[str, Optional[str]] = {
        "utr": None,
        "upi_reference": None,
        "neft_reference": None,
        "rtgs_reference": None,
        "imps_reference": None,
        "cheque_number": None,
        "primary_ref": None
    }
    
    if not narration:
        return refs
        
    text = narration.strip().upper()
    
    # UPI references: e.g. UPI/CR/412345678901/..., UPI/412345678901/...
    upi_match = re.search(r'UPI/(?:CR|DR|P2A|P2P|NB)?/?(\d{10,14})', text)
    if not upi_match:
        upi_match = re.search(r'UPI[-/](\d{10,14})', text)
    if upi_match:
        refs["upi_reference"] = upi_match.group(1)
        refs["utr"] = upi_match.group(1)
        refs["primary_ref"] = refs["utr"]
        
    # NEFT references: e.g. NEFT-N12345678901, NEFT/N12345678901, N12345678901
    neft_match = re.search(r'NEFT[-/]?([A-Z0-9]{10,22})', text)
    if neft_match:
        refs["neft_reference"] = neft_match.group(1)
        refs["utr"] = refs["utr"] or neft_match.group(1)
        refs["primary_ref"] = refs["primary_ref"] or refs["utr"]
        
    # RTGS references: e.g. RTGS-R12345678901, RTGS/R12345678901
    rtgs_match = re.search(r'RTGS[-/]?([A-Z0-9]{10,22})', text)
    if rtgs_match:
        refs["rtgs_reference"] = rtgs_match.group(1)
        refs["utr"] = refs["utr"] or rtgs_match.group(1)
        refs["primary_ref"] = refs["primary_ref"] or refs["utr"]
        
    # IMPS references: e.g. IMPS/P2A/123456789012, IMPS-123456789012, IMPS/123456789012
    imps_match = re.search(r'IMPS/(?:P2A|P2P|RET)?/?(\d{10,14})', text)
    if not imps_match:
        imps_match = re.search(r'IMPS[-/](\d{10,14})', text)
    if imps_match:
        refs["imps_reference"] = imps_match.group(1)
        refs["utr"] = refs["utr"] or imps_match.group(1)
        refs["primary_ref"] = refs["primary_ref"] or refs["utr"]
        
    # Cheque numbers: e.g. CHQ NO : 123456, CHEQUE 123456, CHQ.123456, 123456-CLG
    chq_match = re.search(r'(?:CHQ|CHEQUE|CHQ\s*NO|CHEQUE\s*NO)[\s:.-]*(\d{5,8})', text)
    if not chq_match:
        chq_match = re.search(r'\b(\d{6})\b\s*(?:CLEARING|CLG|TRF)', text)
    if chq_match:
        refs["cheque_number"] = chq_match.group(1)
        refs["primary_ref"] = refs["primary_ref"] or chq_match.group(1)
        
    return refs

# --- Smart Categorization and Ledger Matching ---
def categorize_and_suggest_ledger(narration: str, txn_type: str, amount: float) -> tuple[str, str, str]:
    """
    Returns (category, suggested_ledger, voucher_type).
    """
    if not narration:
        return ("General", "Suspense Account", "Receipt" if txn_type == "CREDIT" else "Payment")
        
    text = narration.upper()
    is_credit = (txn_type == "CREDIT")
    voucher = "Receipt" if is_credit else "Payment"
    
    # 1. Salary & Payroll
    if any(k in text for k in ["SALARY", "PAYROLL", "SAL/"]):
        return ("Salary & Payroll", "Salary Account" if is_credit else "Salary Expense", voucher)
        
    # 2. Bank Charges & Interest
    if any(k in text for k in ["CHG", "CHARGE", "FEE", "ANNUAL FEE", "SMS CHG", "DEBIT CARD CHG", "CONSOLIDATED CHG"]):
        return ("Bank Charges", "Bank Charges Account", "Payment")
    if any(k in text for k in ["INT.PD", "INT.COLL", "INTEREST CREDITED", "INT PAID", "INTEREST EARNED"]):
        return ("Bank Interest", "Bank Interest Income", "Receipt")
        
    # 3. Taxes & Statutory
    if any(k in text for k in ["INCOME TAX", "GST", "ADVANCE TAX", "TDS", "CHALLAN", "GOVT", "EPFO", "ESIC"]):
        return ("Taxes & Statutory", "Tax Expense", "Payment")
        
    # 4. Food & Dining
    if any(k in text for k in ["SWIGGY", "ZOMATO", "RESTAURANT", "CAFE", "MCDONALD", "DOMINO", "STARBUCKS", "KFC"]):
        return ("Food & Dining", "Staff Welfare & Refreshments", "Payment")
        
    # 5. Travel & Fuel
    if any(k in text for k in ["UBER", "OLA", "INDIAN OIL", "HPCL", "BPCL", "SHELL", "MAKEMYTRIP", "IRCTC", "AIR INDIA", "INDIGO", "PETROL", "FUEL"]):
        return ("Travel & Fuel", "Travelling & Fuel Expense", "Payment")
        
    # 6. Utilities & Communications
    if any(k in text for k in ["AIRTEL", "JIO", "VODAFONE", "VI", "BESCOM", "ELECTRICITY", "WATER", "BROADBAND", "TATA PLAY", "RECHARGE"]):
        return ("Utilities", "Telephone & Utility Expenses", "Payment")
        
    # 7. Software & Cloud
    if any(k in text for k in ["AWS", "AMAZON WEB", "GOOGLE", "MICROSOFT", "OPENAI", "GITHUB", "RENDER", "ZOOM", "CANVA", "ADOBE"]):
        return ("Software & Tech", "Software & Subscription Expenses", "Payment")
        
    # 8. Investments & Mutual Funds
    if any(k in text for k in ["ZERODHA", "GROWW", "MUTUAL FUND", "SIP", "PPF", "NSDL", "CDSL", "SECURITIES"]):
        return ("Investments", "Investment Account", voucher)
        
    # 9. E-Commerce & Office Supplies
    if any(k in text for k in ["AMAZON", "FLIPKART", "MYNTRA", "ZEPTO", "BLINKIT", "INSTAMART", "BIGBASKET", "OFFICE SUPPLIES"]):
        return ("Shopping & Supplies", "Office Supplies & Purchases", "Payment")
        
    # 10. Cash Withdrawals / Deposits (Contra Vouchers)
    if any(k in text for k in ["ATM WDL", "CASH WDL", "CASH WITHDRAWAL", "SELF WITHDRAWAL"]):
        return ("Cash Withdrawal", "Cash Account", "Payment")
    if any(k in text for k in ["CASH DEP", "CASH DEPOSIT", "CDM DEPOSIT", "BY CASH"]):
        return ("Cash Deposit", "Cash Account", "Receipt")
        
    # Default fallback
    if is_credit:
        return ("Income", "Sundry Debtors / Customer Account", "Receipt")
    else:
        return ("General Expense", "Sundry Creditors / Vendor Account", "Payment")

# --- Transaction-Level Running Balance Reconciliation ---
def reconcile_statement_and_transactions(
    opening_balance: float, 
    transactions: List[StandardTransaction], 
    closing_balance: float
) -> tuple[bool, float, List[StandardTransaction]]:
    """
    1. Audits statement-level: Opening + Total Credits - Total Debits == Closing.
    2. Performs transaction-level running balance audit for each individual row.
    3. Calculates confidence score and review requirements.
    """
    total_credits = sum(tx.credit for tx in transactions if tx.credit is not None)
    total_debits = sum(tx.debit for tx in transactions if tx.debit is not None)
    
    expected_closing = opening_balance + total_credits - total_debits
    statement_discrepancy = round(abs(expected_closing - closing_balance), 2)
    is_statement_reconciled = (statement_discrepancy < 0.05)
    
    current_running_balance = opening_balance
    enriched_transactions: List[StandardTransaction] = []
    
    for idx, tx in enumerate(transactions):
        credit_amt = tx.credit or 0.0
        debit_amt = tx.debit or 0.0
        expected_row_balance = current_running_balance + credit_amt - debit_amt
        row_diff = round(abs(expected_row_balance - tx.balance), 2)
        
        # Determine Running Balance Status
        if row_diff < 0.05:
            rec_status = "PASS"
        elif row_diff < 1.0:
            rec_status = "WARNING"
        else:
            rec_status = "FAIL"
            
        # Reference extraction
        refs = extract_references_from_narration(tx.narration)
        ref_no = tx.ref_no or refs["primary_ref"]
        utr = tx.utr or refs["utr"]
        
        # Categorization & Suggestions
        txn_type = "CREDIT" if (tx.credit and tx.credit > 0) else "DEBIT"
        amount = tx.credit if txn_type == "CREDIT" else (tx.debit or 0.0)
        category, suggested_ledger, voucher_type = categorize_and_suggest_ledger(tx.narration, txn_type, amount)
        
        # Confidence Calculation (0-100)
        confidence = 100.0
        reasons = []
        
        if rec_status == "FAIL":
            confidence -= 35.0
            reasons.append(f"Running balance mismatch by ₹{row_diff:,.2f}")
        elif rec_status == "WARNING":
            confidence -= 10.0
            reasons.append("Minor rounding variance in balance")
            
        if not tx.narration or len(tx.narration.strip()) < 3:
            confidence -= 20.0
            reasons.append("Missing or very brief narration")
            
        if credit_amt == 0.0 and debit_amt == 0.0:
            confidence -= 40.0
            reasons.append("Zero value debit and credit amount")
            
        if not tx.txn_date:
            confidence -= 30.0
            reasons.append("Missing transaction date")
            
        confidence = max(0.0, min(100.0, round(confidence, 1)))
        
        if confidence >= 90.0:
            grade = "HIGH"
        elif confidence >= 70.0:
            grade = "MEDIUM"
        else:
            grade = "LOW"
            
        requires_review = (confidence < 90.0 or rec_status in ["FAIL", "WARNING"])
        
        # Update row attributes
        tx.id = tx.id or str(uuid.uuid4())
        tx.ref_no = ref_no
        tx.utr = utr
        tx.upi_reference = refs["upi_reference"]
        tx.neft_reference = refs["neft_reference"]
        tx.rtgs_reference = refs["rtgs_reference"]
        tx.imps_reference = refs["imps_reference"]
        tx.cheque_number = refs["cheque_number"]
        tx.transaction_type = txn_type
        tx.voucher_type = voucher_type
        tx.category = tx.category if tx.category != "Unknown" else category
        tx.suggested_ledger = tx.suggested_ledger or suggested_ledger
        tx.assigned_ledger = tx.assigned_ledger or tx.suggested_ledger
        tx.expected_balance = round(expected_row_balance, 2)
        tx.reconciliation_status = rec_status
        tx.reconciliation_difference = row_diff
        tx.confidence_score = confidence
        tx.confidence_grade = grade
        tx.requires_review = requires_review
        tx.review_reasons = reasons
        tx.source_row = idx + 1
        
        # Advance expected running balance for next row
        current_running_balance = tx.balance
        enriched_transactions.append(tx)
        
    # Duplicate Detection on row list
    detect_duplicate_transactions(enriched_transactions)
    
    return is_statement_reconciled, statement_discrepancy, enriched_transactions

# --- Duplicate Transaction Detector ---
def detect_duplicate_transactions(transactions: List[StandardTransaction]) -> None:
    """
    Flags duplicate transactions in-place within the transaction batch.
    """
    seen_exact = {}
    
    for tx in transactions:
        amount = tx.credit if tx.transaction_type == "CREDIT" else tx.debit
        exact_key = (str(tx.txn_date), amount, tx.transaction_type, (tx.utr or tx.ref_no or tx.narration.strip()))
        
        if exact_key in seen_exact:
            tx.is_duplicate = True
            tx.duplicate_type = "EXACT"
            tx.duplicate_reason = f"Exact match with row #{seen_exact[exact_key].source_row} (Date: {tx.txn_date}, Amount: ₹{amount:,.2f})"
            tx.requires_review = True
            if "Potential duplicate transaction" not in tx.review_reasons:
                tx.review_reasons.append("Potential duplicate transaction")
        else:
            seen_exact[exact_key] = tx

# Backward compatible helper
def reconcile_statement(opening_balance: float, transactions: List[StandardTransaction], closing_balance: float) -> bool:
    is_reconciled, _, _ = reconcile_statement_and_transactions(opening_balance, transactions, closing_balance)
    return is_reconciled
