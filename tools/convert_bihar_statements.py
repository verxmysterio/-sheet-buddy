"""
Batch SBI Statement to Tally Prime XML Converter
Specialized for Bihar Trust Statements (S S EDUCATIONAL WELFARE TRUST)
Supports single statement conversion or batch processing of all 42 PDFs.
"""

import os
import glob
import re
import sys
from datetime import datetime

# Add project root to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backend.app.parsers.sbi import SBIParser
from backend.app.services.xml_generator import generate_tally_xml, validate_tally_xml

DEFAULT_INPUT_DIR = r"C:\Users\aakas\OneDrive\Desktop\BOOK KEEPING 2026-27\BIHAR\bank statement"
DEFAULT_OUTPUT_DIR = os.path.join(DEFAULT_INPUT_DIR, "tally_xml")

def batch_convert(
    input_dir: str = DEFAULT_INPUT_DIR,
    output_dir: str = DEFAULT_OUTPUT_DIR,
    bank_ledger_name: str = "State Bank of India",
    counter_ledger_name: str = "Suspense Account"
):
    if not os.path.exists(input_dir):
        print(f"[ERROR] Directory not found: {input_dir}")
        return

    os.makedirs(output_dir, exist_ok=True)
    pdf_files = glob.glob(os.path.join(input_dir, "*.pdf"))
    
    if not pdf_files:
        print(f"[ERROR] No PDF files found in {input_dir}")
        return

    # Sort files numerically if named like 1.pdf, 2.pdf...
    def sort_key(f):
        m = re.search(r'(\d+)\.pdf$', os.path.basename(f), re.IGNORECASE)
        return int(m.group(1)) if m else 999999

    pdf_files = sorted(pdf_files, key=sort_key)
    print("=" * 80)
    print(f"BALANCE SHEET BUDDY — SBI BATCH TALLY PRIME CONVERTER")
    print(f"Input Folder  : {input_dir}")
    print(f"Output Folder : {output_dir}")
    print(f"Bank Ledger   : {bank_ledger_name}")
    print(f"Counter Ledger: {counter_ledger_name}")
    print(f"Total Files   : {len(pdf_files)}")
    print("=" * 80)

    parser = SBIParser()
    total_tx_all = 0
    all_combined_txs = []
    results = []

    for idx, pdf_path in enumerate(pdf_files, 1):
        filename = os.path.basename(pdf_path)
        base_name = os.path.splitext(filename)[0]
        
        try:
            metadata, txs = parser.parse(pdf_path)
            total_tx_all += len(txs)
            all_combined_txs.extend(txs)

            # Generate XML for individual statement
            xml_content = generate_tally_xml(
                transactions=txs,
                bank_ledger_name=bank_ledger_name,
                counter_ledger_name=counter_ledger_name
            )

            val_res = validate_tally_xml(xml_content)
            xml_filename = f"Tally_Import_SBI_{base_name}.xml"
            xml_path = os.path.join(output_dir, xml_filename)

            with open(xml_path, "w", encoding="utf-8") as f:
                f.write(xml_content)

            status_str = "RECONCILED [OK]" if metadata.is_reconciled else f"MISMATCH (diff: {metadata.reconciliation_discrepancy})"
            results.append({
                "file": filename,
                "pages": metadata.pages_count,
                "txs": len(txs),
                "op_bal": metadata.opening_balance,
                "cl_bal": metadata.closing_balance,
                "status": status_str,
                "xml": xml_filename
            })

            print(f"[{idx:02d}/{len(pdf_files):02d}] {filename:<10} | {metadata.pages_count} pgs | {len(txs):>4} txns | Op: Rs.{metadata.opening_balance:>12,.2f} | Cl: Rs.{metadata.closing_balance:>12,.2f} | {status_str}")

        except Exception as e:
            print(f"[{idx:02d}/{len(pdf_files):02d}] {filename:<10} | FAILED: {e}")

    # Generate Consolidated Combined XML for all transactions
    combined_xml_path = os.path.join(output_dir, "Tally_Import_SBI_ALL_CONSOLIDATED.xml")
    if all_combined_txs:
        combined_xml = generate_tally_xml(
            transactions=all_combined_txs,
            bank_ledger_name=bank_ledger_name,
            counter_ledger_name=counter_ledger_name
        )
        with open(combined_xml_path, "w", encoding="utf-8") as f:
            f.write(combined_xml)

    print("=" * 80)
    print(f"BATCH CONVERSION COMPLETE!")
    print(f"Total Statements Processed : {len(results)}")
    print(f"Total Transactions Converted: {total_tx_all}")
    print(f"Individual XML Files Saved  : {output_dir}")
    print(f"Master Consolidated XML     : {combined_xml_path}")
    print("=" * 80)

if __name__ == "__main__":
    b_ledger = sys.argv[1] if len(sys.argv) > 1 else "State Bank of India"
    batch_convert(bank_ledger_name=b_ledger)
