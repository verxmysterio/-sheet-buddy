import io
import re
import csv
import uuid
import xml.etree.ElementTree as ET
from datetime import datetime, date
from typing import List, Dict, Any, Tuple, Optional
from .xml_generator import validate_tally_xml

# Standard Header Definition
STANDARD_CSV_HEADERS = [
    "Date",
    "Voucher Type",
    "Voucher No",
    "Debit Ledger",
    "Credit Ledger",
    "Amount",
    "Narration",
    "Ref / Cheque No"
]

def get_blank_csv_template() -> str:
    """
    Returns a blank CSV template with standard column headers.
    """
    output = io.StringIO()
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(STANDARD_CSV_HEADERS)
    writer.writerow([
        "# DD-MM-YYYY",
        "Payment | Receipt | Contra | Journal",
        "Optional No",
        "Name of Dr Ledger",
        "Name of Cr Ledger",
        "Amount (Numbers)",
        "Remarks / Narration",
        "Optional Cheque/UTR"
    ])
    return output.getvalue()

def get_sample_csv_template() -> str:
    """
    Returns a rich sample CSV containing real-world Indian accounting transactions
    for Payment, Receipt, Contra, Journal, Sales, and Purchase entries.
    """
    output = io.StringIO()
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(STANDARD_CSV_HEADERS)
    
    sample_rows = [
        # Payment Entries (Money Out from Bank/Cash)
        ["01-04-2026", "Payment", "PAY-001", "Office Rent Expenses", "HDFC Bank Current A/c", "25000.00", "April 2026 Office Rent paid via RTGS", "UTR987654321"],
        ["02-04-2026", "Payment", "PAY-002", "Audit & Legal Fees", "State Bank of India", "15000.00", "Statutory audit fees advance payment", "CHQ-440123"],
        ["03-04-2026", "Payment", "PAY-003", "Electricity Expenses", "State Bank of India", "6450.00", "BESCOM electricity bill payment for March", "BESCOM-99881"],
        ["04-04-2026", "Payment", "PAY-004", "Staff Welfare Expenses", "Cash", "2400.00", "Office refreshments and tea expenses", "CASH-VCH-12"],
        
        # Receipt Entries (Money In to Bank/Cash)
        ["05-04-2026", "Receipt", "RCP-001", "HDFC Bank Current A/c", "ABC Global Enterprises", "75000.00", "Payment received against Invoice #INV-2026-04", "UTR112233445"],
        ["06-04-2026", "Receipt", "RCP-002", "State Bank of India", "M/s Krishna Trading Co", "42000.00", "Full & final settlement received", "IMPS88776655"],
        ["07-04-2026", "Receipt", "RCP-003", "Cash", "Consultancy Income", "18500.00", "Cash received for direct business advisory", "REC-CASH-05"],
        
        # Contra Entries (Bank to Cash / Cash to Bank / Bank to Bank)
        ["08-04-2026", "Contra", "CON-001", "Cash", "HDFC Bank Current A/c", "20000.00", "Cash withdrawn from bank for petty cash reserves", "ATM-WD-5544"],
        ["09-04-2026", "Contra", "CON-002", "State Bank of India", "Cash", "35000.00", "Surplus cash deposited into SBI Current Account", "SLIP-887766"],
        ["10-04-2026", "Contra", "CON-003", "State Bank of India", "HDFC Bank Current A/c", "50000.00", "Inter-bank fund transfer from HDFC to SBI", "IBT-443322"],
        
        # Journal Entries (Non-cash adjustments, provisions, write-offs)
        ["11-04-2026", "Journal", "JRN-001", "Depreciation Account", "Computer & Laptops", "8500.00", "Quarterly depreciation provision on office equipment", "JV-Q1-DEP"],
        ["12-04-2026", "Journal", "JRN-002", "Prepaid Insurance Expenses", "Insurance Charges", "12000.00", "Annual fire insurance premium apportioned to asset", "JV-INS-04"],
        ["13-04-2026", "Journal", "JRN-003", "Discount Allowed", "Radha Textiles Ltd", "3500.00", "Cash discount approved on prompt payment", "JV-DISC-01"],
        
        # Sales & Purchase (Optional standard entries)
        ["14-04-2026", "Sales", "SL-001", "Royal Tech Solutions", "Software Sales Account", "88000.00", "Annual software maintenance contract billed", "INV-2026-101"],
        ["15-04-2026", "Purchase", "PUR-001", "Office Stationery Purchase", "Modern Office Suppliers", "9400.00", "Office printer paper and stationery supplied", "BILL-5541"]
    ]
    
    for row in sample_rows:
        writer.writerow(row)
        
    return output.getvalue()

def decode_csv_bytes(file_bytes: bytes) -> str:
    """
    Decodes file bytes safely testing utf-8, utf-8-sig (Excel BOM), latin-1, cp1252.
    """
    for enc in ["utf-8-sig", "utf-8", "cp1252", "latin-1"]:
        try:
            return file_bytes.decode(enc)
        except UnicodeDecodeError:
            continue
    return file_bytes.decode("utf-8", errors="replace")

def detect_csv_headers_and_samples(file_bytes: bytes) -> Tuple[List[str], List[Dict[str, str]], int]:
    """
    Sniffs delimiter and returns (headers, sample_rows_dict, total_rows).
    """
    content = decode_csv_bytes(file_bytes)
    lines = [line for line in content.splitlines() if line.strip() and not line.strip().startswith("#")]
    
    if not lines:
        return [], [], 0
        
    # Sniff delimiter
    first_line = lines[0]
    delimiter = ","
    if "\t" in first_line and first_line.count("\t") > first_line.count(","):
        delimiter = "\t"
    elif ";" in first_line and first_line.count(";") > first_line.count(","):
        delimiter = ";"
        
    reader = csv.reader(io.StringIO(content), delimiter=delimiter)
    headers = []
    rows = []
    
    for row in reader:
        if not row:
            continue
        # Skip comment rows
        if row[0].strip().startswith("#"):
            continue
        if not headers:
            headers = [h.strip() for h in row]
        else:
            if any(cell.strip() for cell in row):
                row_dict = {}
                for idx, h in enumerate(headers):
                    val = row[idx].strip() if idx < len(row) else ""
                    row_dict[h] = val
                rows.append(row_dict)
                
    return headers, rows[:5], len(rows)

def parse_date_safely(date_val: str, preferred_format: str = "%d-%m-%Y") -> Optional[str]:
    """
    Attempts to parse arbitrary date string and returns formatted 'YYYY-MM-DD'.
    Handles timestamps, slashes, dashes, dots, month names, and two-digit years.
    """
    if not date_val:
        return None
    cleaned = str(date_val).strip()
    # Strip timestamp if attached: "15-04-2026 14:32:00" -> "15-04-2026"
    if " " in cleaned:
        cleaned = cleaned.split(" ")[0].strip()
    if "T" in cleaned:
        cleaned = cleaned.split("T")[0].strip()
    cleaned = cleaned.strip('"\'`')
    if not cleaned:
        return None
    
    # Try user's preferred format first
    if preferred_format:
        try:
            dt = datetime.strptime(cleaned, preferred_format)
            return dt.strftime("%Y-%m-%d")
        except ValueError:
            pass
            
    # Common accounting formats
    common_formats = [
        "%d-%m-%Y", "%d/%m/%Y", "%Y-%m-%d", "%Y/%m/%d",
        "%d.%m.%Y", "%d-%b-%Y", "%d-%B-%Y", "%d %b %Y",
        "%d %B %Y", "%m/%d/%Y", "%m-%d-%Y", "%Y%m%d", "%d%m%Y",
        "%d-%m-%y", "%d/%m/%y", "%d.%m.%y", "%d-%b-%y", "%d-%B-%y"
    ]
    for fmt in common_formats:
        try:
            dt = datetime.strptime(cleaned, fmt)
            return dt.strftime("%Y-%m-%d")
        except ValueError:
            continue
            
    # Regex fallback for DD-Mon-YYYY with case-insensitive month
    month_map = {
        "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
        "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12
    }
    m = re.match(r"^(\d{1,2})[-/\s]([A-Za-z]{3,9})[-/\s](\d{2,4})$", cleaned)
    if m:
        try:
            day = int(m.group(1))
            m_str = m.group(2)[:3].lower()
            mon = month_map.get(m_str, 1)
            yr = int(m.group(3))
            if yr < 100:
                yr += 2000
            return f"{yr:04d}-{mon:02d}-{day:02d}"
        except Exception:
            pass

    return None

def normalize_voucher_type(vtype_str: str, default: str = "Payment") -> str:
    """
    Normalizes arbitrary string to standard Tally voucher type.
    """
    if not vtype_str:
        return default
    v = vtype_str.strip().upper()
    
    if "PAY" in v:
        return "Payment"
    elif "REC" in v:
        return "Receipt"
    elif "CONTRA" in v or "CON" in v:
        return "Contra"
    elif "JOURN" in v or "JRN" in v or "JV" in v:
        return "Journal"
    elif "SALE" in v:
        return "Sales"
    elif "PURCH" in v:
        return "Purchase"
    
    # Capitalize cleanly if standard
    return vtype_str.strip().title()

def parse_amount_safely(val_str: Any) -> float:
    """
    Strips currency signs, commas, and whitespace to extract float.
    """
    if val_str is None:
        return 0.0
    if isinstance(val_str, (int, float)):
        return abs(float(val_str))
        
    s = str(val_str).strip()
    # Remove currency symbols and formatting commas
    cleaned = re.sub(r"[^\d.-]", "", s)
    try:
        return abs(float(cleaned))
    except (ValueError, TypeError):
        return 0.0

def parse_csv_with_mapping(file_bytes: bytes, mapping: Dict[str, Any]) -> Dict[str, Any]:
    """
    Parses full CSV content based on supplied mapping configuration.
    Returns preview data with categorized voucher metrics and validation status.
    """
    content = decode_csv_bytes(file_bytes)
    lines = [line for line in content.splitlines() if line.strip() and not line.strip().startswith("#")]
    
    if not lines:
        return {
            "mapping_name": mapping.get("name", "Custom Mapping"),
            "total_vouchers": 0,
            "payment_count": 0,
            "receipt_count": 0,
            "contra_count": 0,
            "journal_count": 0,
            "sales_count": 0,
            "purchase_count": 0,
            "total_amount": 0.0,
            "invalid_rows_count": 0,
            "vouchers": [],
            "headers_detected": []
        }
        
    # Sniff delimiter
    first_line = lines[0]
    delimiter = ","
    if "\t" in first_line and first_line.count("\t") > first_line.count(","):
        delimiter = "\t"
    elif ";" in first_line and first_line.count(";") > first_line.count(","):
        delimiter = ";"
        
    reader = csv.reader(io.StringIO(content), delimiter=delimiter)
    headers = []
    vouchers = []
    
    # Extract mapping fields
    date_col = (mapping.get("date_column") or "Date").strip()
    date_fmt = (mapping.get("date_format") or "%d-%m-%Y").strip()
    vtype_col = (mapping.get("voucher_type_column") or "Voucher Type").strip()
    default_vtype = mapping.get("default_voucher_type") or "Payment"
    vnum_col = (mapping.get("voucher_number_column") or "Voucher No").strip()
    dr_col = (mapping.get("debit_ledger_column") or "Debit Ledger").strip()
    default_dr = mapping.get("default_debit_ledger") or ""
    cr_col = (mapping.get("credit_ledger_column") or "Credit Ledger").strip()
    default_cr = mapping.get("default_credit_ledger") or ""
    amt_col = (mapping.get("amount_column") or "Amount").strip()
    dr_amt_col = (mapping.get("debit_amount_column") or "").strip()
    cr_amt_col = (mapping.get("credit_amount_column") or "").strip()
    narr_col = (mapping.get("narration_column") or "Narration").strip()
    default_narr = mapping.get("default_narration") or "Voucher Entry"
    ref_col = (mapping.get("ref_no_column") or "Ref / Cheque No").strip()

    # Smart case-insensitive column resolver helper
    def resolve_col_name(headers_list: List[str], target: str, aliases: List[str] = None) -> Optional[str]:
        h_map = {h.lower().strip().replace('"', '').replace("'", ""): h for h in headers_list}
        t_clean = target.lower().strip().replace('"', '').replace("'", "")
        if t_clean in h_map:
            return h_map[t_clean]
        if aliases:
            for al in aliases:
                al_clean = al.lower().strip()
                if al_clean in h_map:
                    return h_map[al_clean]
            for al in aliases:
                al_clean = al.lower().strip()
                for hk, orig in h_map.items():
                    if al_clean in hk:
                        return orig
        return None
    
    payment_count = 0
    receipt_count = 0
    contra_count = 0
    journal_count = 0
    sales_count = 0
    purchase_count = 0
    total_amount = 0.0
    invalid_rows = 0
    
    row_number = 0
    for raw_row in reader:
        if not raw_row:
            continue
        if raw_row[0].strip().startswith("#"):
            continue
        if not headers:
            headers = [h.strip() for h in raw_row]
            continue
            
        if not any(cell.strip() for cell in raw_row):
            continue
            
        row_number += 1
        row_dict = {}
        for idx, h in enumerate(headers):
            row_dict[h] = raw_row[idx].strip() if idx < len(raw_row) else ""
            
        errors = []
        
        # 1. Date (with smart auto-detection and carry-forward)
        actual_date_col = resolve_col_name(headers, date_col, ["date", "txn date", "txndate", "tran date", "transaction date", "value date", "val date", "post date", "posting date", "entry date"])
        raw_date = row_dict.get(actual_date_col or date_col, "")
        parsed_date = parse_date_safely(raw_date, date_fmt)
        if not parsed_date:
            # Carry forward previous date or default to statement date
            if vouchers and vouchers[-1].get("date"):
                parsed_date = vouchers[-1]["date"]
            else:
                parsed_date = date.today().strftime("%Y-%m-%d")
            if not raw_date:
                errors.append("Date is missing")
            else:
                errors.append(f"Invalid date format '{raw_date}'")
            
        # 2. Voucher Type
        raw_vtype = row_dict.get(vtype_col, "")
        vtype = normalize_voucher_type(raw_vtype, default_vtype)
        
        # 3. Voucher Number
        vnum = row_dict.get(vnum_col, "") or str(row_number)
        
        # 4. Debit Ledger
        debit_ledger = row_dict.get(dr_col, "") or default_dr
        if not debit_ledger:
            errors.append("Debit Ledger is missing")
            
        # 5. Credit Ledger
        credit_ledger = row_dict.get(cr_col, "") or default_cr
        if not credit_ledger:
            errors.append("Credit Ledger is missing")
            
        # Rule: cannot have identical Debit and Credit ledger
        if debit_ledger and credit_ledger and debit_ledger.strip().lower() == credit_ledger.strip().lower():
            errors.append(f"Debit and Credit ledgers cannot be identical ('{debit_ledger}')")
            
        # 6. Amount
        amt = 0.0
        if amt_col and amt_col in row_dict:
            amt = parse_amount_safely(row_dict[amt_col])
        elif dr_amt_col and dr_amt_col in row_dict and parse_amount_safely(row_dict[dr_amt_col]) > 0:
            amt = parse_amount_safely(row_dict[dr_amt_col])
        elif cr_amt_col and cr_amt_col in row_dict and parse_amount_safely(row_dict[cr_amt_col]) > 0:
            amt = parse_amount_safely(row_dict[cr_amt_col])
            
        if amt <= 0.0:
            errors.append("Amount must be greater than zero")
            
        # 7. Narration
        narr = row_dict.get(narr_col, "") or default_narr
        
        # 8. Ref / Cheque No
        ref_no = row_dict.get(ref_col, "")
        
        is_valid = (len(errors) == 0)
        if not is_valid:
            invalid_rows += 1
            
        # Metrics tally
        if vtype == "Payment":
            payment_count += 1
        elif vtype == "Receipt":
            receipt_count += 1
        elif vtype == "Contra":
            contra_count += 1
        elif vtype == "Journal":
            journal_count += 1
        elif vtype == "Sales":
            sales_count += 1
        elif vtype == "Purchase":
            purchase_count += 1
            
        total_amount += amt
        
        vouchers.append({
            "row_idx": row_number,
            "date": parsed_date,
            "voucher_type": vtype,
            "voucher_number": vnum,
            "debit_ledger": debit_ledger,
            "credit_ledger": credit_ledger,
            "amount": round(amt, 2),
            "narration": narr,
            "ref_no": ref_no,
            "is_valid": is_valid,
            "error_reasons": errors
        })
        
    return {
        "mapping_name": mapping.get("name", "Custom Mapping"),
        "total_vouchers": len(vouchers),
        "payment_count": payment_count,
        "receipt_count": receipt_count,
        "contra_count": contra_count,
        "journal_count": journal_count,
        "sales_count": sales_count,
        "purchase_count": purchase_count,
        "total_amount": round(total_amount, 2),
        "invalid_rows_count": invalid_rows,
        "vouchers": vouchers,
        "headers_detected": headers
    }

def escape_xml(text: Any) -> str:
    """
    Escapes XML special characters: &, <, >, ", '
    """
    if text is None:
        return ""
    s = str(text)
    s = s.replace("&", "&amp;")
    s = s.replace("<", "&lt;")
    s = s.replace(">", "&gt;")
    s = s.replace('"', "&quot;")
    s = s.replace("'", "&apos;")
    return s

def generate_multi_voucher_tally_xml(vouchers: List[Dict[str, Any]]) -> str:
    """
    Generates 100% compliant Tally XML for multi-type accounting vouchers:
    Payment, Receipt, Contra, Journal, Sales, and Purchase.
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
    
    for idx, vch in enumerate(vouchers):
        tally_msg = ET.SubElement(request_data, "TALLYMESSAGE", {"xmlns:UDF": "TallyUDF"})
        vch_uuid = str(uuid.uuid4())
        
        vtype = vch.get("voucher_type") or "Payment"
        debit_ledger = vch.get("debit_ledger") or "Suspense Account"
        credit_ledger = vch.get("credit_ledger") or "Suspense Account"
        amount = float(vch.get("amount") or 0.0)
        narration = vch.get("narration") or "CSV Import Transaction"
        ref_no = vch.get("ref_no") or ""
        vnum = vch.get("voucher_number") or str(idx + 1)
        
        # Date string formatting: YYYYMMDD
        raw_date = vch.get("date", "")
        parsed = parse_date_safely(raw_date)
        if parsed:
            try:
                dt = datetime.strptime(parsed, "%Y-%m-%d")
                date_str = dt.strftime("%Y%m%d")
            except Exception:
                date_str = datetime.now().strftime("%Y%m%d")
        else:
            date_str = datetime.now().strftime("%Y%m%d")
            
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
        
        v_date = ET.SubElement(voucher, "DATE")
        v_date.text = date_str
        
        v_guid = ET.SubElement(voucher, "GUID")
        v_guid.text = vch_uuid
        
        v_num = ET.SubElement(voucher, "VOUCHERNUMBER")
        v_num.text = str(vnum)
        
        v_tname = ET.SubElement(voucher, "VOUCHERTYPENAME")
        v_tname.text = vtype
        
        # Party ledger name (Primary Party in Tally)
        v_party = ET.SubElement(voucher, "PARTYLEDGERNAME")
        if vtype in ["Payment", "Contra"]:
            v_party.text = credit_ledger  # Paying Bank/Cash
        elif vtype == "Receipt":
            v_party.text = credit_ledger  # Receiving from Customer/Party
        else:
            v_party.text = debit_ledger
            
        v_narr = ET.SubElement(voucher, "NARRATION")
        v_narr.text = narration
        
        v_eff = ET.SubElement(voucher, "EFFECTIVEDATE")
        v_eff.text = date_str
        
        if vtype in ["Payment", "Receipt", "Contra"]:
            v_cashflow = ET.SubElement(voucher, "HASCASHFLOW")
            v_cashflow.text = "Yes"
            
        # --- ENTRY 1: DEBIT LEDGER (Dr Entry) ---
        # Tally Convention: ISDEEMEDPOSITIVE="Yes", Negative amount
        dr_entry = ET.SubElement(voucher, "ALLLEDGERENTRIES.LIST")
        dr_name = ET.SubElement(dr_entry, "LEDGERNAME")
        dr_name.text = debit_ledger
        
        dr_pos = ET.SubElement(dr_entry, "ISDEEMEDPOSITIVE")
        dr_pos.text = "Yes"
        
        dr_amt = ET.SubElement(dr_entry, "AMOUNT")
        dr_amt.text = f"{-amount:.2f}"
        
        # If Receipt into a Bank, attach bank allocations to Debit entry
        if vtype == "Receipt" and ref_no:
            alloc = ET.SubElement(dr_entry, "BANKALLOCATIONS.LIST")
            ad = ET.SubElement(alloc, "DATE")
            ad.text = date_str
            aid = ET.SubElement(alloc, "INSTRUMENTDATE")
            aid.text = date_str
            an = ET.SubElement(alloc, "INSTRUMENTNUMBER")
            an.text = str(ref_no)
            att = ET.SubElement(alloc, "TRANSACTIONTYPE")
            att.text = "Inter Bank Transfer"
            ap = ET.SubElement(alloc, "BANKPARTYNAME")
            ap.text = credit_ledger
            aa = ET.SubElement(alloc, "AMOUNT")
            aa.text = f"{-amount:.2f}"
            
        # --- ENTRY 2: CREDIT LEDGER (Cr Entry) ---
        # Tally Convention: ISDEEMEDPOSITIVE="No", Positive amount
        cr_entry = ET.SubElement(voucher, "ALLLEDGERENTRIES.LIST")
        cr_name = ET.SubElement(cr_entry, "LEDGERNAME")
        cr_name.text = credit_ledger
        
        cr_pos = ET.SubElement(cr_entry, "ISDEEMEDPOSITIVE")
        cr_pos.text = "No"
        
        cr_amt = ET.SubElement(cr_entry, "AMOUNT")
        cr_amt.text = f"{amount:.2f}"
        
        # If Payment or Contra from a Bank, attach bank allocations to Credit entry
        if vtype in ["Payment", "Contra"] and ref_no:
            alloc = ET.SubElement(cr_entry, "BANKALLOCATIONS.LIST")
            ad = ET.SubElement(alloc, "DATE")
            ad.text = date_str
            aid = ET.SubElement(alloc, "INSTRUMENTDATE")
            aid.text = date_str
            an = ET.SubElement(alloc, "INSTRUMENTNUMBER")
            an.text = str(ref_no)
            att = ET.SubElement(alloc, "TRANSACTIONTYPE")
            att.text = "Inter Bank Transfer"
            ap = ET.SubElement(alloc, "BANKPARTYNAME")
            ap.text = debit_ledger
            aa = ET.SubElement(alloc, "AMOUNT")
            aa.text = f"{amount:.2f}"
            
    raw_xml = ET.tostring(envelope, encoding="utf-8")
    return '<?xml version="1.0" encoding="utf-8"?>\n' + raw_xml.decode("utf-8")
