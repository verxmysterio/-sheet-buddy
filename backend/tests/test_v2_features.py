import pytest
from datetime import date
from app.parsers.base import (
    StandardTransaction, 
    StatementMetadata, 
    reconcile_statement_and_transactions, 
    extract_references_from_narration,
    categorize_and_suggest_ledger
)
from app.services.bank_detector import AutomaticBankDetector
from app.services.document_engine import DocumentEngine
from app.services.ledger_engine import LedgerRuleEngine
from app.services.xml_generator import generate_tally_xml, validate_tally_xml

def test_reference_extractor():
    # UPI
    refs = extract_references_from_narration("UPI/CR/412345678901/PAYMENT FROM CUSTOMER")
    assert refs["upi_reference"] == "412345678901"
    assert refs["utr"] == "412345678901"
    
    # NEFT
    refs_neft = extract_references_from_narration("NEFT-N98765432101-SALARY VENDOR")
    assert refs_neft["neft_reference"] == "N98765432101"
    
    # Cheque
    refs_chq = extract_references_from_narration("CHQ NO: 450123 ISSUED TO VENDOR")
    assert refs_chq["cheque_number"] == "450123"

def test_categorization_and_suggestions():
    cat, ledger, vtype = categorize_and_suggest_ledger("SWIGGY FOOD ORDER", "DEBIT", 450.0)
    assert cat == "Food & Dining"
    assert vtype == "Payment"
    
    cat, ledger, vtype = categorize_and_suggest_ledger("SALARY TRANSFER FROM ACME CORP", "CREDIT", 75000.0)
    assert cat == "Salary & Payroll"
    assert vtype == "Receipt"

def test_transaction_level_reconciliation_pass():
    txs = [
        StandardTransaction(txn_date=date(2026, 4, 1), narration="Opening Tx 1", debit=None, credit=5000.0, balance=15000.0),
        StandardTransaction(txn_date=date(2026, 4, 2), narration="Opening Tx 2", debit=2000.0, credit=None, balance=13000.0),
    ]
    is_rec, diff, enriched = reconcile_statement_and_transactions(
        opening_balance=10000.0,
        transactions=txs,
        closing_balance=13000.0
    )
    assert is_rec is True
    assert diff == 0.0
    assert enriched[0].reconciliation_status == "PASS"
    assert enriched[1].reconciliation_status == "PASS"
    assert enriched[0].confidence_grade == "HIGH"

def test_transaction_level_reconciliation_fail():
    txs = [
        StandardTransaction(txn_date=date(2026, 4, 1), narration="Broken Row", debit=None, credit=5000.0, balance=99999.0),
    ]
    is_rec, diff, enriched = reconcile_statement_and_transactions(
        opening_balance=10000.0,
        transactions=txs,
        closing_balance=99999.0
    )
    assert enriched[0].reconciliation_status == "FAIL"
    assert enriched[0].requires_review is True
    assert len(enriched[0].review_reasons) > 0

def test_bank_detector_sbi_and_hdfc():
    sbi_text = ["STATE BANK OF INDIA SARAL INTERNET BANKING Txn Date Value Date Description Debit Credit Balance IFSC: SBIN0001234"]
    det = AutomaticBankDetector.detect_bank_from_text(sbi_text)
    assert det.bank_key == "sbi"
    assert det.confidence >= 80.0
    
    hdfc_text = ["HDFC BANK LIMITED SMARTSTATEMENT Account Statement Date Narration Chq./Ref.No. Value Dt Withdrawal Amt. Deposit Amt. Closing Balance IFSC: HDFC0000123"]
    det_hdfc = AutomaticBankDetector.detect_bank_from_text(hdfc_text)
    assert det_hdfc.bank_key == "hdfc"
    assert det_hdfc.confidence >= 80.0

def test_ledger_rules_engine():
    class MockRule:
        def __init__(self, pattern, match_type, ledger, vtype, priority=10, txn_type="ANY"):
            self.pattern = pattern
            self.match_type = match_type
            self.ledger_name = ledger
            self.voucher_type = vtype
            self.priority = priority
            self.txn_type = txn_type
            self.min_amount = None
            self.max_amount = None
            self.category = "Custom"
            self.is_active = True

    rules = [
        MockRule(pattern="AWS CLOUD", match_type="CONTAINS", ledger="AWS Hosting Expense", vtype="Payment", priority=20),
        MockRule(pattern="^GST/", match_type="REGEX", ledger="GST Input Tax", vtype="Payment", priority=10)
    ]
    
    txs = [
        StandardTransaction(txn_date=date(2026, 4, 1), narration="BILL FOR AWS CLOUD SERVER", debit=3500.0, balance=10000.0),
        StandardTransaction(txn_date=date(2026, 4, 2), narration="GST/012345/TAX PAYMENT", debit=1800.0, balance=8200.0),
    ]
    
    res = LedgerRuleEngine.apply_rules_to_transactions(txs, rules)
    assert res[0].assigned_ledger == "AWS Hosting Expense"
    assert res[1].assigned_ledger == "GST Input Tax"

def test_tally_xml_validator():
    txs = [
        StandardTransaction(txn_date=date(2026, 4, 1), narration="Payment to Supplier", debit=1000.0, credit=None, balance=9000.0),
        StandardTransaction(txn_date=date(2026, 4, 2), narration="Receipt from Client", debit=None, credit=2500.0, balance=11500.0),
    ]
    xml_str = generate_tally_xml(txs, bank_ledger_name="HDFC Current Account")
    val = validate_tally_xml(xml_str)
    assert val["is_valid"] is True
    assert val["voucher_count"] == 2
    assert val["malformed_count"] == 0


def test_tally_xml_contra_and_party_mapping():
    from app.services.csv_tally_engine import generate_multi_voucher_tally_xml
    # 1. Test bank statement XML generator
    txs = [
        StandardTransaction(txn_date=date(2026, 4, 1), narration="Payment to Supplier", debit=1000.0, credit=None, balance=9000.0),
        StandardTransaction(txn_date=date(2026, 4, 2), narration="Receipt from Client", debit=None, credit=2500.0, balance=11500.0),
        StandardTransaction(txn_date=date(2026, 4, 3), narration="Cash Withdrawal ATM", debit=5000.0, credit=None, balance=6500.0, assigned_ledger="Cash"),
    ]
    xml_str = generate_tally_xml(txs, bank_ledger_name="HDFC Current Account")
    val = validate_tally_xml(xml_str)
    assert val["is_valid"] is True
    assert val["voucher_count"] == 3
    assert 'VCHTYPE="Contra"' in xml_str
    assert "<BANKPARTYNAME>" not in xml_str
    assert "<PAYMENTFAVOURING>" not in xml_str
    assert "<PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>" in xml_str

    # 2. Test CSV engine XML generator
    vouchers = [
        {
            "voucher_type": "Payment",
            "date": "2026-04-15",
            "debit_ledger": "Office Rent Expenses",
            "credit_ledger": "State Bank of India",
            "amount": 25000.0,
            "narration": "Office Rent April",
            "ref_no": "UTR12345"
        },
        {
            "voucher_type": "Contra",
            "date": "2026-04-16",
            "debit_ledger": "Cash",
            "credit_ledger": "State Bank of India",
            "amount": 10000.0,
            "narration": "Cash withdrawal",
            "ref_no": "ATM999"
        }
    ]
    xml_out = generate_multi_voucher_tally_xml(vouchers)
    val2 = validate_tally_xml(xml_out)
    assert val2["is_valid"] is True
    assert val2["voucher_count"] == 2
    assert "<BANKPARTYNAME>" not in xml_out
    assert "<PARTYLEDGERNAME>Office Rent Expenses</PARTYLEDGERNAME>" in xml_out
