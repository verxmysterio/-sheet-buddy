# SHEET BUDDY V2 — ARCHITECTURAL OVERVIEW & SPECIFICATION

**Sheet Buddy (v2 Master Upgrade)** is an automated, accountant-grade bank statement conversion and reconciliation SaaS platform engineered specifically for Indian accounting workflows (Tally Prime, Tally.ERP 9, Zoho, Busy, and Excel).

---

## 1. System Pipeline Architecture

The pipeline processes financial statements completely in-memory with mathematical verification at every stage:

```text
  [ Upload Statement PDF / Stream ]
                 │
                 ▼
  [ 1. In-Memory Document Engine ]
        ├─ Detect text density, encrypted flags, page dimensions
        └─ Classify: Native PDF, Scanned Image PDF, or Hybrid
                 │
                 ▼
  [ 2. Multi-Signal Bank Detector ]
        ├─ High-confidence IFSC code regex detection (40% weight)
        ├─ Bank brand identity & address keyword matcher (35% weight)
        └─ Column header signature analysis (25% weight)
                 │
                 ▼
  [ 3. Deterministic Coordinate & Text Parsers ]
        ├─ SBI, HDFC, ICICI, Axis, Bank of Baroda, PNB, Kotak
        ├─ Rule-Based Column Index Parser (Custom / Generic)
        └─ In-Memory OCR Fallback (Tesseract / EasyOCR pipeline)
                 │
                 ▼
  [ 4. ParsedTransaction & Reference Extraction Layer ]
        ├─ Clean narration normalization
        ├─ UPI, NEFT, RTGS, IMPS, Cheque, and POS reference extractors
        └─ Automated category detection (Vendor, Salary, Utilities, Tax)
                 │
                 ▼
  [ 5. Mathematical Running Balance & Audit Engine ]
        ├─ Opening Balance + Credits - Debits = Closing Balance audit
        ├─ Row-level balance step discontinuity analysis
        ├─ Extraction confidence scoring (0–100) & grade (High, Med, Low)
        └─ Duplicate row detection (Date + Amount + Narration fingerprint)
                 │
                 ▼
  [ 6. Smart Ledger Suggestion Engine (ledger_rules) ]
        ├─ User-defined priority rules (Exact, Contains, StartsWith, EndsWith, Regex)
        └─ Default counter-ledger fallback (e.g., Suspense Account)
                 │
                 ▼
  [ 7. Review Queue & Diagnostic Resolver ]
        ├─ Filter views: All, Ready, Needs Review, Duplicates, Debits, Credits
        └─ Stepper modal for walking through unreviewed/flagged transactions
                 │
                 ▼
  [ 8. Multi-Format Exporters & XML Validation ]
        ├─ Tally XML Generator (Payment / Receipt / Contra vouchers)
        ├─ Strict Tally Prime 3.0+ XML Schema Validator
        └─ Excel Reconciliation Multi-sheet Workbook (Executive Summary + Detailed Ledger)
```

---

## 2. Core Modules & Engine Specifications

### 2.1 In-Memory Document Engine (`backend/app/services/document_engine.py`)
- **Zero Disk Footprint**: Consumes raw `bytes` via `io.BytesIO(content)` without persisting temporary files to disk.
- **Classification**: Analyzes char density per square point. Classifies files as `NATIVE_PDF`, `SCANNED_IMAGE_PDF`, or `HYBRID_PDF`.

### 2.2 Multi-Signal Automatic Bank Detector (`backend/app/services/bank_detector.py`)
- Resolves statement format automatically with confidence scores ($0.0 - 100.0\%$).
- Evaluates:
  1. **IFSC Signatures** (e.g. `SBIN\d{7}`, `HDFC\d{7}`, `ICIC\d{7}`, `UTIB\d{7}`, `BARB0\w{6}`, `PUNB0\w{6}`, `KKBK\d{7}`).
  2. **Brand & Branch Keywords** (e.g. "State Bank of India", "HDFC Bank Ltd", "Axis Bank Ltd").
  3. **Table Column Header Patterns** (e.g. "Txn Date", "Narration / Description", "Withdrawal (Dr)", "Deposit (Cr)", "Running Balance").

### 2.3 Bank Parser Implementations (`backend/app/parsers/`)
- **SBI Parser (`sbi.py`)**: Preserves spatial bounding-box geometry with header coordinate slicing and multi-line narration merging.
- **HDFC Parser (`hdfc.py`)**: Handles tabular layouts, transaction descriptions, cheque numbers, and closing balance checks.
- **ICICI Parser (`icici.py`)**: Parses ICICI statement formats, value dates, cheque numbers, and debit/credit columns.
- **Axis Parser (`axis.py`)**: Handles date formatting (`%d-%m-%Y`), reference IDs, and multi-page tables.
- **Bank of Baroda (`bob.py`) & PNB (`pnb.py`)**: Robust tabular parsers with balance continuity verification.
- **Kotak (`kotak.py`)**: Parses Kotak Mahindra Bank statement tables with value dates and transaction references.
- **Rule-Based Generic Parser (`rule_based.py`)**: Configurable column-index parser supporting arbitrary bank statement layouts via user/admin mapping.

### 2.4 Accounting & Ledger Rule Engine (`backend/app/services/ledger_engine.py`)
- Evaluates user-defined rules stored in `ledger_rules` table.
- Supports match strategies: `EXACT`, `CONTAINS`, `STARTS_WITH`, `ENDS_WITH`, `REGEX`.
- Automatically maps matched narrations to target Tally counter-ledgers, voucher types (`Payment`, `Receipt`, `Contra`, `Journal`), and financial categories.

### 2.5 Tally XML Generator & Validator (`backend/app/services/xml_generator.py`)
- Produces valid Tally XML 1.0 documents (`ENVELOPE > BODY > DATA > TALLYMESSAGE > VOUCHER`).
- Automatically creates proper double-entry accounting splits:
  - Bank Debit (Outflow) $\rightarrow$ Debit Counter Ledger, Credit Bank Ledger.
  - Bank Credit (Inflow) $\rightarrow$ Debit Bank Ledger, Credit Counter Ledger.
- Integrated validator (`validate_tally_xml`) verifies XML syntax, root envelope tags, voucher elements, and date formatting (`YYYYMMDD`).

### 2.6 Excel Reconciliation Exporter (`backend/app/services/excel_exporter.py`)
- Multi-sheet OpenPyXL workbook:
  - **Reconciliation Summary Sheet**: Executive overview with opening balance, total debits, total credits, closing balance, audit status, and variance.
  - **Detailed Transactions Sheet**: Structured columns with dates, narrations, references, debits, credits, balances, categories, assigned ledgers, and confidence grades.

---

## 3. Database Schema & Hardening (`backend/app/models/models.py`)

- **Double-Entry Wallet Balances**: `WalletTransaction` records explicit `balance_before` and `balance_after` snapshots with transaction references (`CONVERSION_ID`, `PAYMENT_GATEWAY_TXN`, `PROMO_CODE`, `ADMIN_ADJUSTMENT`).
- **Organizations & Multi-Tenancy**: `organizations`, `organization_members`, and `clients` tables allow CA firms and accountants to segregate client statements.
- **Audit Logs**: `audit_logs` table records user and admin actions with IP address and action metadata.
- **Refresh Tokens**: `refresh_tokens` table enables secure token rotation with family revocation against replay attacks.
