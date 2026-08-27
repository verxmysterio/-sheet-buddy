import os
import xml.etree.ElementTree as ET
from app.parsers import get_parser, reconcile_statement
from app.services.xml_generator import generate_tally_xml
from app.services.excel_exporter import export_transactions_to_excel

PDF_PATH = r"c:\Users\aakas\OneDrive\Desktop\credentials\01.pdf"
XML_PATH = r"c:\Users\aakas\OneDrive\Desktop\credentials\01.xml"

def test_sbi_parser():
    # Verify PDF file exists
    assert os.path.exists(PDF_PATH), f"PDF file not found at {PDF_PATH}"
    
    parser = get_parser("State Bank of India")
    metadata, transactions = parser.parse(PDF_PATH)
    
    # 1. Metadata check
    assert metadata.bank_name == "State Bank of India"
    assert metadata.account_name == "S S EDUCATIONAL WELFARE TRUST"
    assert metadata.account_number == "00000031059039847"
    assert metadata.branch == "DIGHWA DUBOULI"
    assert metadata.statement_period == "1 Apr 2025 to 10 Apr 2025"
    assert metadata.opening_balance == 226014.38
    assert metadata.pages_count == 15
    assert metadata.transactions_count == 227
    assert len(transactions) == 227
    
    # 2. Transaction reconciliation check
    assert reconcile_statement(metadata.opening_balance, transactions, metadata.closing_balance) is True
    
    # Check that closing balance matches the final transaction balance
    assert transactions[-1].balance == 741847.30
    assert metadata.closing_balance == 741847.30
    
    # 3. Credits & Debits breakdown
    debits = [tx for tx in transactions if tx.debit is not None]
    credits = [tx for tx in transactions if tx.credit is not None]
    
    assert len(debits) == 6
    assert len(credits) == 221
    
    # Ensure no transaction is both debit and credit
    for tx in transactions:
        assert (tx.debit is None) != (tx.credit is None)

def test_xml_generation():
    parser = get_parser("SBI")
    metadata, transactions = parser.parse(PDF_PATH)
    
    xml_str = generate_tally_xml(transactions, "State Bank of India")
    
    # Verify it is valid XML
    root = ET.fromstring(xml_str)
    assert root.tag == "ENVELOPE"
    
    # Check that there are 227 TALLYMESSAGE elements
    vouchers = root.findall(".//VOUCHER")
    assert len(vouchers) == 227
    
    # Check voucher types count
    payments = [v for v in vouchers if v.get("VCHTYPE") == "Payment"]
    receipts = [v for v in vouchers if v.get("VCHTYPE") == "Receipt"]
    
    assert len(payments) == 6
    assert len(receipts) == 221

def test_excel_export():
    parser = get_parser("SBI")
    _, transactions = parser.parse(PDF_PATH)
    
    excel_stream = export_transactions_to_excel(transactions)
    assert excel_stream is not None
    assert excel_stream.getvalue() != b""
