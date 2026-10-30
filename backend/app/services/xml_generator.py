import uuid
import xml.etree.ElementTree as ET
from typing import List, Dict, Any, Tuple
from ..parsers.base import StandardTransaction

def generate_tally_xml(
    transactions: List[StandardTransaction], 
    bank_ledger_name: str,
    counter_ledger_name: str = "Suspense Account",
    credit_voucher_type: str = "Receipt",
    debit_voucher_type: str = "Payment"
) -> str:
    """
    Generates a 100% Tally Prime and Tally.ERP 9 compliant XML envelope with individualized
    assigned ledgers and voucher types per transaction.
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
    for idx, tx in enumerate(transactions):
        tally_msg = ET.SubElement(request_data, "TALLYMESSAGE", {"xmlns:UDF": "TallyUDF"})
        
        vch_uuid = str(uuid.uuid4())
        is_payment = (tx.debit is not None and tx.debit > 0)
        val = tx.debit if is_payment else (tx.credit or 0.0)
        
        # Counter party ledger resolution
        if counter_ledger_name and counter_ledger_name not in ["Suspense", "Suspense Account"]:
            counter_party = counter_ledger_name
        else:
            counter_party = tx.assigned_ledger or tx.suggested_ledger or counter_ledger_name
            
        # Voucher type determination:
        # 1. Automatically classify as 'Contra' if counter party is Cash / Cash-in-hand / Petty Cash
        # 2. Respect explicit 'Contra' or 'Journal' override
        # 3. Otherwise default to Payment (Debit) or Receipt (Credit)
        explicit_vtype = getattr(tx, "voucher_type", None)
        if counter_party and counter_party.strip().lower() in ["cash", "cash-in-hand", "cash in hand", "petty cash"]:
            vtype = "Contra"
        elif explicit_vtype == "Contra":
            vtype = "Contra"
        elif explicit_vtype == "Journal":
            vtype = "Journal"
        elif is_payment:
            vtype = explicit_vtype if explicit_vtype == "Payment" else debit_voucher_type
        else:
            vtype = explicit_vtype if explicit_vtype == "Receipt" else credit_voucher_type
            
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
        
        vch_num = ET.SubElement(voucher, "VOUCHERNUMBER")
        vch_num.text = str(idx + 1)
        
        vch_typename = ET.SubElement(voucher, "VOUCHERTYPENAME")
        vch_typename.text = vtype
        
        vch_narration = ET.SubElement(voucher, "NARRATION")
        vch_narration.text = tx.narration or "Bank Transaction"
        
        # In Tally Single-Entry and Accounting Views:
        # PARTYLEDGERNAME represents the Counter-Party ledger displayed in Particulars
        vch_party = ET.SubElement(voucher, "PARTYLEDGERNAME")
        vch_party.text = counter_party
        
        vch_view = ET.SubElement(voucher, "PERSISTEDVIEW")
        vch_view.text = "Accounting Voucher View"
        
        vch_eff_date = ET.SubElement(voucher, "EFFECTIVEDATE")
        vch_eff_date.text = date_str
        
        vch_cashflow = ET.SubElement(voucher, "HASCASHFLOW")
        vch_cashflow.text = "Yes"
        
        # --- LEDGER ENTRY 1: Counter Ledger (Expense / Party / Cash in Particulars) ---
        suspense_entry = ET.SubElement(voucher, "ALLLEDGERENTRIES.LIST")
        susp_ledger = ET.SubElement(suspense_entry, "LEDGERNAME")
        susp_ledger.text = counter_party
        
        susp_pos = ET.SubElement(suspense_entry, "ISDEEMEDPOSITIVE")
        susp_pos.text = "Yes" if is_payment else "No"
        
        susp_amt = ET.SubElement(suspense_entry, "AMOUNT")
        susp_amt.text = f"{-val:.2f}" if is_payment else f"{val:.2f}"
        
        susp_party = ET.SubElement(suspense_entry, "ISPARTYLEDGER")
        susp_party.text = "Yes"
        
        # --- LEDGER ENTRY 2: Bank (Account Field in Single-Entry Mode) ---
        bank_entry = ET.SubElement(voucher, "ALLLEDGERENTRIES.LIST")
        bank_ledger = ET.SubElement(bank_entry, "LEDGERNAME")
        bank_ledger.text = bank_ledger_name
        
        bank_pos = ET.SubElement(bank_entry, "ISDEEMEDPOSITIVE")
        bank_pos.text = "No" if is_payment else "Yes"
        
        bank_amt = ET.SubElement(bank_entry, "AMOUNT")
        bank_amt.text = f"{val:.2f}" if is_payment else f"{-val:.2f}"
        
        bank_party = ET.SubElement(bank_entry, "ISPARTYLEDGER")
        bank_party.text = "No"
        
        # Bank Allocation details (BRS tracking)
        # NOTE: Do NOT include BANKPARTYNAME or PAYMENTFAVOURING tags here.
        # Hardcoding BANKPARTYNAME causes Tally Prime to throw "INCORRECT LEDGER SELECTED DURING BANK ALLOCATION"
        # when a user later alters the voucher (e.g. changing Payment to Contra, or switching party to Cash).
        # Omitting them allows Tally to dynamically inherit the active voucher ledger with full user flexibility.
        bank_allocs = ET.SubElement(bank_entry, "BANKALLOCATIONS.LIST")
        
        alloc_date = ET.SubElement(bank_allocs, "DATE")
        alloc_date.text = date_str
        
        alloc_inst_date = ET.SubElement(bank_allocs, "INSTRUMENTDATE")
        alloc_inst_date.text = date_str
        
        alloc_type = ET.SubElement(bank_allocs, "TRANSACTIONTYPE")
        alloc_type.text = "Cheque" if (tx.cheque_number or not tx.utr) else "Inter Bank Transfer"
        
        ref_val = tx.ref_no or tx.utr or tx.cheque_number
        if ref_val:
            alloc_num = ET.SubElement(bank_allocs, "INSTRUMENTNUMBER")
            alloc_num.text = str(ref_val)
            
        alloc_status = ET.SubElement(bank_allocs, "STATUS")
        alloc_status.text = "No"
        
        alloc_mode = ET.SubElement(bank_allocs, "PAYMENTMODE")
        alloc_mode.text = "Transacted"
        
        alloc_amt = ET.SubElement(bank_allocs, "AMOUNT")
        alloc_amt.text = f"{val:.2f}" if is_payment else f"{-val:.2f}"

    raw_xml = ET.tostring(envelope, encoding="utf-8")
    return '<?xml version="1.0" encoding="utf-8"?>\n' + raw_xml.decode("utf-8")

def validate_tally_xml(xml_string: str) -> Dict[str, Any]:
    """
    Performs comprehensive pre-download schema and accounting validation on generated Tally XML.
    """
    errors = []
    voucher_count = 0
    malformed_count = 0
    
    try:
        root = ET.fromstring(xml_string)
        if root.tag != "ENVELOPE":
            errors.append("Root element is not <ENVELOPE>")
            
        vouchers = root.findall(".//VOUCHER")
        voucher_count = len(vouchers)
        
        for idx, vch in enumerate(vouchers):
            vtype = vch.get("VCHTYPE")
            if not vtype:
                errors.append(f"Voucher #{idx+1} missing VCHTYPE attribute")
                malformed_count += 1
                
            entries = vch.findall("ALLLEDGERENTRIES.LIST")
            if len(entries) < 2:
                errors.append(f"Voucher #{idx+1} has fewer than 2 ledger entries")
                malformed_count += 1
                
            amounts = []
            for entry in entries:
                amt_node = entry.find("AMOUNT")
                if amt_node is not None and amt_node.text:
                    try:
                        amounts.append(float(amt_node.text))
                    except ValueError:
                        errors.append(f"Voucher #{idx+1} contains non-numeric amount '{amt_node.text}'")
                        malformed_count += 1
            if amounts and abs(sum(amounts)) > 0.01:
                errors.append(f"Voucher #{idx+1} ledger entries sum ({sum(amounts)}) is not balanced")
                malformed_count += 1
                
    except ET.ParseError as pe:
        errors.append(f"XML Parse Syntax Error: {pe}")
        return {
            "is_valid": False,
            "voucher_count": 0,
            "malformed_count": 1,
            "errors": errors
        }
        
    return {
        "is_valid": (len(errors) == 0),
        "voucher_count": voucher_count,
        "malformed_count": malformed_count,
        "errors": errors
    }
