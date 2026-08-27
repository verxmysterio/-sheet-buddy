import uuid
import xml.etree.ElementTree as ET
from typing import List
from ..parsers.base import StandardTransaction

def generate_tally_xml(
    transactions: List[StandardTransaction], 
    bank_ledger_name: str,
    counter_ledger_name: str = "Suspense",
    credit_voucher_type: str = "Receipt",
    debit_voucher_type: str = "Payment"
) -> str:
    """
    Generates a clean, minimal Tally Prime compatible XML document.
    """
    envelope = ET.Element("ENVELOPE")
    
    # 1. Header
    header = ET.SubElement(envelope, "HEADER")
    tally_request = ET.SubElement(header, "TALLYREQUEST")
    tally_request.text = "Import Data"
    
    # 2. Body
    body = ET.SubElement(envelope, "BODY")
    import_data = ET.SubElement(body, "IMPORTDATA")
    
    request_desc = ET.SubElement(import_data, "REQUESTDESC")
    report_name = ET.SubElement(request_desc, "REPORTNAME")
    report_name.text = "All Masters"
    
    static_vars = ET.SubElement(request_desc, "STATICVARIABLES")
    overwrite = ET.SubElement(static_vars, "SVOverwriteImpVch")
    overwrite.text = "Yes"
    
    request_data = ET.SubElement(import_data, "REQUESTDATA")
    
    # 3. Vouchers
    for tx in transactions:
        tally_msg = ET.SubElement(request_data, "TALLYMESSAGE", {"xmlns:UDF": "TallyUDF"})
        
        vch_uuid = str(uuid.uuid4())
        is_payment = tx.debit is not None
        vtype = debit_voucher_type if is_payment else credit_voucher_type
        
        voucher = ET.SubElement(
            tally_msg,
            "VOUCHER",
            {
                "REMOTEID": vch_uuid,
                "VCHTYPE": vtype,
                "ACTION": "Create",
                "OBJVIEW": "Accounting Voucher View"
            }
        )
        
        date_str = tx.txn_date.strftime("%Y%m%d")
        
        # Voucher header fields
        vch_date = ET.SubElement(voucher, "DATE")
        vch_date.text = date_str
        
        vch_guid = ET.SubElement(voucher, "GUID")
        vch_guid.text = vch_uuid
        
        vch_typename = ET.SubElement(voucher, "VOUCHERTYPENAME")
        vch_typename.text = vtype
        
        vch_narration = ET.SubElement(voucher, "NARRATION")
        vch_narration.text = tx.narration
        
        vch_party = ET.SubElement(voucher, "PARTYLEDGERNAME")
        vch_party.text = bank_ledger_name
        
        vch_eff_date = ET.SubElement(voucher, "EFFECTIVEDATE")
        vch_eff_date.text = date_str
        
        # We need a cashflow flag for payment/receipt vouchers
        vch_cashflow = ET.SubElement(voucher, "HASCASHFLOW")
        vch_cashflow.text = "Yes"
        
        # --- LEDGER ENTRY 1: Counter Ledger ---
        suspense_entry = ET.SubElement(voucher, "ALLLEDGERENTRIES.LIST")
        susp_ledger = ET.SubElement(suspense_entry, "LEDGERNAME")
        susp_ledger.text = counter_ledger_name
        
        # Suspense is DEBITED in Payment: DeemedPositive = Yes, Amount = -amount
        # Suspense is CREDITED in Receipt: DeemedPositive = No, Amount = amount
        susp_pos = ET.SubElement(suspense_entry, "ISDEEMEDPOSITIVE")
        susp_pos.text = "Yes" if is_payment else "No"
        
        susp_amt = ET.SubElement(suspense_entry, "AMOUNT")
        val = tx.debit if is_payment else tx.credit
        if val is None:
            val = 0.00
        susp_amt.text = f"{-val:.2f}" if is_payment else f"{val:.2f}"
        
        # --- LEDGER ENTRY 2: Bank ---
        bank_entry = ET.SubElement(voucher, "ALLLEDGERENTRIES.LIST")
        bank_ledger = ET.SubElement(bank_entry, "LEDGERNAME")
        bank_ledger.text = bank_ledger_name
        
        # Bank is CREDITED in Payment: DeemedPositive = No, Amount = amount
        # Bank is DEBITED in Receipt: DeemedPositive = Yes, Amount = -amount
        bank_pos = ET.SubElement(bank_entry, "ISDEEMEDPOSITIVE")
        bank_pos.text = "No" if is_payment else "Yes"
        
        bank_amt = ET.SubElement(bank_entry, "AMOUNT")
        bank_val = tx.debit if is_payment else tx.credit
        if bank_val is None:
            bank_val = 0.00
        bank_amt.text = f"{bank_val:.2f}" if is_payment else f"{-bank_val:.2f}"
        
        # Mark party ledger as Yes for bank
        bank_party = ET.SubElement(bank_entry, "ISPARTYLEDGER")
        bank_party.text = "Yes"
        
        # Bank Allocation details (essential for bank statements)
        bank_allocs = ET.SubElement(bank_entry, "BANKALLOCATIONS.LIST")
        
        alloc_date = ET.SubElement(bank_allocs, "DATE")
        alloc_date.text = date_str
        
        # In Tally Prime, the default TRANSACTIONTYPE is "Cheque" for bank allocations
        alloc_inst_date = ET.SubElement(bank_allocs, "INSTRUMENTDATE")
        alloc_inst_date.text = date_str
        
        alloc_favour = ET.SubElement(bank_allocs, "PAYMENTFAVOURING")
        alloc_favour.text = counter_ledger_name
        
        alloc_type = ET.SubElement(bank_allocs, "TRANSACTIONTYPE")
        alloc_type.text = "Cheque"
        
        if tx.ref_no:
            alloc_num = ET.SubElement(bank_allocs, "INSTRUMENTNUMBER")
            alloc_num.text = tx.ref_no
            
        alloc_status = ET.SubElement(bank_allocs, "STATUS")
        alloc_status.text = "No"
        
        alloc_mode = ET.SubElement(bank_allocs, "PAYMENTMODE")
        alloc_mode.text = "Transacted"
        
        alloc_party = ET.SubElement(bank_allocs, "BANKPARTYNAME")
        alloc_party.text = counter_ledger_name
        
        alloc_amt = ET.SubElement(bank_allocs, "AMOUNT")
        alloc_amt.text = f"{val:.2f}" if is_payment else f"{-val:.2f}"

    # Return XML as a decoded string with standard encoding and indentation declaration
    raw_xml = ET.tostring(envelope, encoding="utf-8")
    return '<?xml version="1.0" encoding="utf-8"?>\n' + raw_xml.decode("utf-8")
