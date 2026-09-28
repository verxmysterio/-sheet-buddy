# Sheet Buddy (Balance Sheet Buddy) — Master AI Context & Project Documentation

> **Context Document Version**: 2.0 (2026 Edition)  
> **Target Audience**: AI Agents, LLMs, Technical Architects, Full-Stack Developers  
> **Core Purpose**: A complete, self-contained reference on the architecture, workflows, data models, parser engine, API specifications, and business rules of Sheet Buddy.

---

## Table of Contents
1. [Executive Summary & Purpose](#1-executive-summary--purpose)
2. [Technology Stack & Architecture](#2-technology-stack--architecture)
3. [Core Workflow & Processing Pipeline](#3-core-workflow--processing-pipeline)
4. [Database Schema & Data Models](#4-database-schema--data-models)
5. [REST API Specification](#5-rest-api-specification)
6. [Bank Parser Engine & Reconciliation Logic](#6-bank-parser-engine--reconciliation-logic)
7. [Tally XML & Excel Generation Specifications](#7-tally-xml--excel-generation-specifications)
8. [Wallet, Billing & Promo System](#8-wallet-billing--promo-system)
9. [Frontend Design System & Component Architecture](#9-frontend-design-system--component-architecture)
10. [Directory Structure & Code Manifest](#10-directory-structure--code-manifest)
11. [Security, Privacy & RBAC Principles](#11-security-privacy--rbac-principles)
12. [Environment Variables & Deployment Guide](#12-environment-variables--deployment-guide)
13. [Guidelines for AI Agents Modifying This Codebase](#13-guidelines-for-ai-agents-modifying-this-codebase)

---

## 1. Executive Summary & Purpose

**Sheet Buddy** (formerly *Balance Sheet Buddy*) is a production-grade SaaS and automated accounting tool designed specifically for Indian Chartered Accountants (CAs), tax consultants, accounting firms, and SMEs.

### Core Problem
Indian banks (SBI, HDFC, ICICI, Axis, BOB, PNB, Kotak, etc.) issue account statements in locked, multi-page, non-standardized PDF formats. Manually typing hundreds of bank entries into Tally accounting software takes hours, leads to human entry errors, and requires tedious manual reconciliation.

### Sheet Buddy Solution
1. **Intelligent PDF Ingestion**: Ingests multi-page bank statement PDFs using spatial coordinate and tabular text extraction.
2. **Mathematical Reconciliation Audit**: Performs automatic balance verification ($Opening\ Balance + Credits - Debits = Closing\ Balance$) before voucher generation.
3. **Live Transaction & Narration Editor**: Allows accountants to review parsed transactions, customize transaction narrations, and configure Tally bank ledger names on the fly.
4. **Instant Tally XML & Excel Generation**: Produces 100% Tally Prime & Tally.ERP 9 compliant XML vouchers (`Receipt` and `Payment` vouchers with correct `<ALLLEDGERENTRIES.LIST>` nodes) and clean Excel sheets.
5. **Zero-Retention Privacy**: Bank statement PDFs are parsed entirely in-memory and discarded immediately; raw financial documents are never stored on disk.
6. **Wallet & Credit Monetization**: Pay-as-you-go credit system (base pricing of 25 paise per page) with UPI QR code checkout, WhatsApp verification, and single-use lifetime promo codes.

---

## 2. Technology Stack & Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                 REACT 18 + VITE FRONTEND                    │
│      Neo-Brutalist UI • Tailwind CSS • Standalone SPA       │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTPS / JSON REST API
┌──────────────────────────────▼──────────────────────────────┐
│                    FASTAPI BACKEND                          │
│   Auth (JWT) • Rate Limiting • CORS • Async Handlers        │
├──────────────────────────────┬──────────────────────────────┤
│       PARSER ENGINE          │      TALLY XML ENGINE        │
│ pdfplumber / Spatial OCR     │ Jinja2 Tally Prime Templates │
├──────────────────────────────┼──────────────────────────────┤
│       WALLET & BILLING       │     ADMINISTRATION & RBAC    │
│  UPI Flow / Promo Engine     │ User Control / Bank Configs  │
└──────────────────────────────┬──────────────────────────────┘
                               │ SQLAlchemy ORM
┌──────────────────────────────▼──────────────────────────────┐
│                    DATABASE STORAGE                         │
│ SQLite (Dev) / PostgreSQL (Prod Render) • Zero-Doc Retention│
└─────────────────────────────────────────────────────────────┘
```

### Backend Components
- **Language**: Python 3.10+
- **Framework**: FastAPI (High-performance asynchronous Python web framework)
- **Database / ORM**: SQLAlchemy 2.0 with Alembic / SQLite for local development, PostgreSQL on Render production.
- **PDF Extraction**: `pdfplumber` (bounding box & spatial character layout extraction), `PyPDF2` (metadata and page counting).
- **XML Templating**: `jinja2` (strict schema-compliant Tally XML generation).
- **Spreadsheet Generation**: `openpyxl` (XLSX export).
- **Authentication**: `python-jose` (JWT tokens with 60-min standard and 365-day "Remember Me" expiry), `passlib` with `bcrypt`.
- **Notifications**: Resend REST API and Gmail SMTP for transactional alerts and password resets.

### Frontend Components
- **Framework**: React 18 (Single Page Application architecture with React Hooks).
- **Build Tool**: Vite 8.x (Lightning-fast bundling, HMR).
- **Styling**: Tailwind CSS configured in Neo-Brutalist theme (solid `#000000` 2px/4px borders, hard drop shadows `shadow-[4px_4px_0px_rgba(0,0,0,1)]`, zero border-radii, sharp contrasts).
- **Brand Palette**:
  - Primary Yellow: `#FFD629` / `#FFD615`
  - Solid Black: `#000000`
  - Background Neutral: `#f4f2ed`
  - Success Green: `#3affaa` / `#25D366`
  - Alert Red: `#ff5757`
  - Cyan Accent: `#3fecff`

---

## 3. Core Workflow & Processing Pipeline

```mermaid
sequenceDiagram
    autonumber
    actor User as Accountant / User
    participant FE as React Frontend
    participant API as FastAPI Backend
    participant PE as Parser Engine (pdfplumber)
    participant DB as Database (SQLAlchemy)

    User->>FE: Upload Bank PDF + Select Bank
    FE->>API: POST /api/convert/upload-preview (multipart/form-data)
    API->>API: Calculate SHA-256 Hash of PDF
    API->>DB: Check for duplicate conversions
    API->>PE: Parse text layout & spatial coordinates
    PE->>API: Extract Transactions, Opening & Closing Balances
    API->>API: Run Reconciliation Audit Formula
    API-->>FE: Return JSON Preview (Stats, Reconciled Flag, Transactions)
    User->>FE: Edit Narrations & Enter Tally Bank Ledger
    User->>FE: Click "Generate Tally XML"
    FE->>API: POST /api/convert/execute (transactions, ledger_name, file_hash)
    API->>DB: Verify & Deduct User Page Credits
    API->>API: Render Jinja2 Tally XML Envelope
    API->>DB: Store Conversion Record & Cache XML
    API-->>FE: Stream Tally XML File Attachment
    FE-->>User: Browser downloads .xml ready for Tally Prime Import
```

### Detailed Pipeline Steps:
1. **Preview & Verification Stage**:
   - The user selects a bank format (e.g. State Bank of India, HDFC Bank, ICICI Bank, Axis Bank, Bank of Baroda, Punjab National Bank, Kotak Mahindra, or Generic Rule-Based / Simulator).
   - The PDF is parsed in memory. No file is saved to permanent storage.
   - The server computes total pages, total transaction count, opening balance, debit total, credit total, and closing balance.
   - An audit test verifies: $|(Opening + Credits - Debits) - Closing| < 0.05$.
   - The preview payload is returned to the frontend.
2. **Interactive Narration & Ledger Customization**:
   - In the frontend preview workspace, the user can edit individual narrations in a table.
   - The user types their Tally Bank Ledger name (e.g., `HDFC Current A/c 50200012345`).
   - Alternatively, the user can click **Excel Export** for a free spreadsheet copy.
3. **Execution & XML Download**:
   - The user clicks **Generate Tally XML**.
   - The backend deducts $N$ credits ($N = pages\_count$) from the user's wallet.
   - If user is an admin or has a waiver, credit deduction is bypassed.
   - If credits are insufficient, an error code `INSUFFICIENT_CREDITS` is returned.
   - The cached XML is recorded in the `conversions` table so the user can re-download it anytime for free from their **History Archive**.

---

## 4. Database Schema & Data Models

### Entity Relationship Diagram

```mermaid
erDiagram
    USERS ||--o{ CONVERSIONS : creates
    USERS ||--o{ PAYMENT_TICKETS : submits
    USERS ||--o{ SUPPORT_QUERIES : opens
    USERS ||--o{ PROMO_CODE_REDEMPTIONS : redeems
    PROMO_CODES ||--o{ PROMO_CODE_REDEMPTIONS : tracked_in

    USERS {
        int id PK
        string email UK
        string hashed_password
        int page_credits
        boolean is_admin
        boolean is_active
        datetime created_at
        datetime updated_at
    }

    CONVERSIONS {
        int id PK
        int user_id FK
        string bank_name
        string statement_period
        string account_number
        int pages_count
        int transactions_count
        string file_hash
        boolean is_reconciled
        float opening_balance
        float closing_balance
        text cached_xml
        datetime created_at
    }

    PAYMENT_TICKETS {
        int id PK
        int user_id FK
        float amount_in_inr
        int pages_purchased
        string status "PENDING | APPROVED | REJECTED"
        string description
        string proof_filename
        datetime created_at
        datetime updated_at
    }

    SUPPORT_QUERIES {
        int id PK
        int user_id FK
        string user_email
        string subject
        text description
        string whatsapp_number
        string status "OPEN | IN_PROGRESS | RESOLVED"
        datetime created_at
        datetime updated_at
    }

    PROMO_CODES {
        int id PK
        string code UK
        int page_credits
        int max_uses
        int times_used
        datetime expires_at
        boolean is_active
        datetime created_at
    }

    PROMO_CODE_REDEMPTIONS {
        int id PK
        int user_id FK
        int promo_code_id FK
        datetime redeemed_at
    }

    BANK_CONFIGS {
        int id PK
        string bank_key UK
        string name
        string patterns_csv
        string parser_type "NATIVE | RULE_BASED | SIMULATOR"
        text config_json
        boolean is_active
        datetime created_at
    }
```

---

## 5. REST API Specification

All protected endpoints require the HTTP header:  
`Authorization: Bearer <JWT_ACCESS_TOKEN>`

### Authentication Endpoints (`/api/auth`)
| Method | Endpoint | Request Body | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/login` | `{ email, password, remember: bool }` | Authenticates user; returns JWT token (60m or 365d) and user profile. |
| `POST` | `/api/auth/register` | `{ email, password }` | Registers user (only active if open registration enabled; default is admin-provisioned). |
| `GET` | `/api/auth/me` | None | Returns currently authenticated user object and live credit balance. |
| `POST` | `/api/auth/change-password`| `{ current_password, new_password }` | Allows user to update their login credentials. |

### Statement Conversion Endpoints (`/api/convert`)
| Method | Endpoint | Request Body | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/convert/upload-preview` | `multipart/form-data`: `file`, `bank_name` | Parses PDF in-memory, returns summary stats, audit results, and transaction list. |
| `POST` | `/api/convert/execute` | `{ bank_name, tally_ledger_name, transactions, pages_count, file_hash }` | Deducts credits, generates official Tally XML envelope, stores cache, returns XML file. |
| `POST` | `/api/convert/export-excel` | `{ bank_name, transactions }` | Generates formatted Excel workbook (`.xlsx`) of parsed statement. |
| `GET` | `/api/convert/history` | Query: `skip`, `limit`, `search` | Returns user's past conversions with pagination and search. |
| `GET` | `/api/convert/download/{id}` | Path: `id` | Re-downloads cached XML for a previous conversion free of credit charge. |

### Wallet & Payments Endpoints (`/api/wallet`)
| Method | Endpoint | Request Body | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/wallet/plans` | None | Returns available credit voucher pricing packages. |
| `POST` | `/api/wallet/checkout/whatsapp` | `{ plan_name, pages, amount }` | Registers pending payment ticket for WhatsApp UPI confirmation. |
| `POST` | `/api/wallet/redeem-promo` | `{ promo_code }` | Validates and applies promo code credits (one-time per account). |
| `GET` | `/api/wallet/history` | None | Returns ledger log of credit adjustments, purchases, and deductions. |

### Support Endpoints (`/api/support`)
| Method | Endpoint | Request Body | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/support/ticket` | `{ subject, description, whatsapp_number }` | Creates user support inquiry for admin dashboard review. |

### Administrative Endpoints (`/api/admin` — Requires `is_admin=True`)
| Method | Endpoint | Request Body | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/admin/overview` | None | Global system stats (total users, conversions, credits issued, pending queries). |
| `GET` | `/api/admin/users` | None | Lists all user profiles, wallet balances, and conversion metrics. |
| `POST` | `/api/admin/users` | `{ email, password, page_credits, is_admin }` | Provisions new client account directly. |
| `POST` | `/api/admin/users/{id}/credits` | `{ adjustment: int }` | Manually credits or debits user wallet balance. |
| `POST` | `/api/admin/users/{id}/toggle-admin` | None | Grants or revokes administrative role. |
| `GET` | `/api/admin/promo-codes` | None | Lists all active promo codes with usage counters and expiry dates. |
| `POST` | `/api/admin/promo-codes` | `{ code, page_credits, max_uses, days_valid }` | Creates new redeemable promo code. |
| `DELETE`| `/api/admin/promo-codes/{id}` | None | Deactivates or removes promo code. |
| `POST` | `/api/admin/payments/{id}/approve` | None | Approves UPI payment ticket and automatically adds credits to user wallet. |
| `POST` | `/api/admin/payments/{id}/reject` | None | Rejects payment ticket. |
| `POST` | `/api/admin/queries/{id}/resolve` | None | Marks user support query as resolved. |
| `GET` | `/api/admin/bank-configs` | None | Lists all native, rule-based, and simulated bank configurations. |
| `POST` | `/api/admin/bank-configs` | `{ bank_key, name, patterns_csv, parser_type, config_json }` | Creates or updates bank parsing configuration. |

---

## 6. Bank Parser Engine & Reconciliation Logic

### Base Parser Architecture (`backend/app/parsers/base.py`)
Every bank parser inherits from `BaseBankParser` and implements the abstract method:
```python
def parse(self, pdf_stream: io.BytesIO) -> ParsedStatementResult:
    """
    Extracts text/coordinates, organizes lines chronologically,
    calculates opening/closing balances, and runs reconciliation audit.
    """
```

### Supported Bank Parsers
1. **State Bank of India (SBI)** (`backend/app/parsers/sbi.py`):
   - Uses spatial word coordinate clustering to prevent multi-line narration overlap.
   - Handles multi-column layouts with variable debit/credit positions and INR format values.
2. **HDFC Bank** (`backend/app/parsers/hdfc.py`):
   - Scans tabular boundaries with regex patterns matching date tokens (`DD/MM/YY` or `DD/MM/YYYY`).
3. **ICICI Bank** (`backend/app/parsers/icici.py`):
   - Handles multi-line transaction remarks, cheque number extraction, and UPI/NEFT/RTGS transaction IDs.
4. **Axis Bank** (`backend/app/parsers/axis.py`):
   - Standardized 7-column table layout with credit/debit balances.
5. **Bank of Baroda (BOB)** (`backend/app/parsers/bob.py`):
   - Handles alphanumeric date formats (`DD-Mon-YYYY`) and running balance verification.
6. **Punjab National Bank (PNB)** (`backend/app/parsers/pnb.py`):
   - Standardized government bank tabular layout.
7. **Kotak Mahindra Bank** (`backend/app/parsers/kotak.py`):
   - CR/DR symbol identification and transaction grouping.
8. **Rule-Based Engine** (`backend/app/parsers/rule_based.py`):
   - Dynamic parser configured via JSON specifying column indices (`col_date`, `col_narration`, `col_debit`, `col_credit`, `col_balance`) and date formats.
9. **Simulator Engine** (`backend/app/parsers/simulator.py`):
   - Used for demoing and testing statement conversions with any mock PDF.

### Mathematical Reconciliation Audit Formula
A parsed statement is flagged as `reconciled = True` if and only if:
$$\left|\left(\text{Opening Balance} + \sum \text{Credits} - \sum \text{Debits}\right) - \text{Closing Balance}\right| \le 0.05$$
If this check fails, the frontend displays a high-visibility warning with the calculated discrepancy so the user can inspect the entries before exporting to Tally.

---

## 7. Tally XML & Excel Generation Specifications

### Tally XML Schema Requirements
Tally Prime / ERP 9 requires exact XML formatting inside an `<ENVELOPE>` container:

```xml
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <DATA>
      <TALLYMESSAGE xmlns:UDF="TallyUDF">
        <VOUCHER VCHTYPE="Receipt" ACTION="Create" OBJVIEW="Accounting Voucher View">
          <DATE>20260415</DATE>
          <VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME>
          <VOUCHERNUMBER>1</VOUCHERNUMBER>
          <PARTYLEDGERNAME>Suspense Account</PARTYLEDGERNAME>
          <NARRATION>UPI/CR/12345678/Customer Payment</NARRATION>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>HDFC Bank Current A/c</LEDGERNAME>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
            <AMOUNT>-5000.00</AMOUNT>
          </ALLLEDGERENTRIES.LIST>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>Suspense Account</LEDGERNAME>
            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
            <AMOUNT>5000.00</AMOUNT>
          </ALLLEDGERENTRIES.LIST>
        </VOUCHER>
      </TALLYMESSAGE>
    </DATA>
  </BODY>
</ENVELOPE>
```

#### Tally Accounting Rules Enforced by Jinja2 Template (`backend/app/templates/tally_voucher.xml`):
- **Receipt Vouchers (Credit Txns / Money In)**:
  - `VCHTYPE = "Receipt"`
  - Bank Ledger has `<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>` and negative amount string (`-5000.00`).
  - Counter ledger (`Suspense Account`) has `<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>` and positive amount (`5000.00`).
- **Payment Vouchers (Debit Txns / Money Out)**:
  - `VCHTYPE = "Payment"`
  - Counter ledger (`Suspense Account`) has `<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>` and negative amount (`-2500.00`).
  - Bank Ledger has `<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>` and positive amount (`2500.00`).
- **Dates**: Formatted as `YYYYMMDD` without dashes or slashes.
- **XML Character Escaping**: All special XML characters (`&`, `<`, `>`, `"`, `'`) in narrations and ledger names are properly sanitized.

---

## 8. Wallet, Billing & Promo System

### Unit Economics & Pricing Model
- **Base Rate**: ₹0.25 per page processed.
- **Starter Pack**: 100 Page Credits = ₹25.00
- **Standard Pack**: 600 Page Credits (500 + 100 Bonus) = ₹125.00 (₹0.21/page)
- **Business Pack**: 1250 Page Credits (1000 + 250 Bonus) = ₹250.00 (₹0.20/page)

### UPI Payment Flow
1. User chooses a pack in the **Buy Credits** tab.
2. An on-screen modal renders the official UPI QR Code (`frontend/public/QR-CODE.jpeg`) and instructions.
3. User scans with any UPI App (GPay, PhonePe, Paytm, BHIM) and pays the exact amount.
4. User clicks **"Send Screenshot on WhatsApp"** which generates a pre-formatted link to WhatsApp (`+919204915729`) with their user ID, email, plan name, and ticket ID.
5. Administrator reviews payment screenshot in the **Admin Console** and clicks **"Approve"** to credit the user's wallet automatically.

### Promo Code Engine
- Promo codes allow claiming free credits (e.g. `SHEETBUDDY50` for 50 free pages).
- **Single-Use Lifetime Constraint**: Tracked via `promo_code_redemptions` table; users cannot redeem the same promo code multiple times.

---

## 9. Frontend Design System & Component Architecture

### Neo-Brutalist Visual Identity
The user interface follows strict Neo-Brutalist UI principles:
- **High Contrast Borders**: `border-2 border-black` or `border-4 border-black`.
- **Solid Box Shadows**: `shadow-[2px_2px_0px_rgba(0,0,0,1)]`, `shadow-[4px_4px_0px_rgba(0,0,0,1)]`, `shadow-[8px_8px_0px_rgba(0,0,0,1)]`.
- **Micro-interactions**: Active buttons translate down-right (`active:translate-x-[1px] active:translate-y-[1px]`) to mimic mechanical button presses.
- **Sharp Corners**: `rounded-none` everywhere (cards, inputs, badges, buttons).
- **Typography**: Heavy, bold, uppercase tracking (`font-black`, `uppercase`, `tracking-wider`).

### Key Views in `frontend/src/App.jsx`
1. **Auth View**: Login screen with `symbol_mark.svg`, Remember Me checkbox, feature capability strip (`feature_icons.svg`), and contact footer.
2. **Navigation Header**: Top sticky bar with brand logo, credit badge, responsive mobile hamburger drawer, and quick tab switcher.
3. **Import Transaction Tab (`convert`)**:
   - Bank selector and drag-and-drop PDF dropzone.
   - Summary statistics cards (Transactions, Opening Balance, Closing Balance, Reconciled Status).
   - Live editable table for transaction dates, amounts, and narrations.
   - Bank ledger name input with Tally XML and Excel download triggers.
4. **History Archive Tab (`history`)**: Searchable, paginated archive of past statement conversions with free XML re-download buttons.
5. **Buy Credits Tab (`wallet`)**: Pack selection cards, lifetime promo code redemption box, and historical wallet activity log.
6. **Support Tab (`support`)**: WhatsApp direct chat shortcut, email link, and support ticket creation form.
7. **Profile Security Tab (`settings`)**: Password update form and account details.
8. **Admin Console Tab (`admin`)**:
   - System overview KPI grid (users, conversions, revenue, queries).
   - Promo code generator & active codes directory.
   - User account creation and credit adjustment table.
   - Global conversion audit log & cached XML downloads.
   - Pending payment ticket approval/rejection queue.
   - User support ticket resolution queue.
   - Custom Bank Config editor.
9. **Global Footer**: Brand signature lockup with direct WhatsApp and Email contact icons and creator redirection link.

---

## 10. Directory Structure & Code Manifest

```
BALANCE SHEET BUDDY/
├── backend/
│   ├── app/
│   │   ├── main.py                     # FastAPI application entrypoint, CORS & route registrations
│   │   ├── config.py                   # App configuration, DB URI, JWT secret, SMTP settings
│   │   ├── database.py                 # SQLAlchemy engine, declarative base, sessionmaker
│   │   ├── models/
│   │   │   └── models.py               # Database entity models (User, Conversion, PaymentTicket, etc.)
│   │   ├── schemas/
│   │   │   └── schemas.py              # Pydantic request/response validation schemas
│   │   ├── routes/
│   │   │   ├── auth.py                 # Login, registration, token refresh, password update
│   │   │   ├── convert.py              # PDF preview, Tally XML generation, Excel export, history
│   │   │   ├── wallet.py               # Pricing plans, WhatsApp checkout ticket, promo code redemption
│   │   │   ├── support.py              # Support ticket submission and listing
│   │   │   └── admin.py                # Admin overview, user management, payments, bank configs
│   │   ├── parsers/
│   │   │   ├── base.py                 # Abstract BaseBankParser & common extraction utilities
│   │   │   ├── sbi.py                  # State Bank of India coordinate-based parser
│   │   │   ├── hdfc.py                 # HDFC Bank parser
│   │   │   ├── icici.py                # ICICI Bank parser
│   │   │   ├── axis.py                 # Axis Bank parser
│   │   │   ├── bob.py                  # Bank of Baroda parser
│   │   │   ├── pnb.py                  # Punjab National Bank parser
│   │   │   ├── kotak.py                # Kotak Mahindra Bank parser
│   │   │   ├── rule_based.py           # Dynamic column-mapped rule-based parser
│   │   │   └── simulator.py            # Simulated mock statement parser for testing
│   │   ├── services/
│   │   │   ├── tally_xml.py            # Jinja2 XML rendering service
│   │   │   ├── excel_export.py         # OpenPyXL spreadsheet generation service
│   │   │   ├── email_service.py        # Resend REST API & SMTP email delivery
│   │   │   └── auth_service.py         # Password hashing, JWT token creation & validation
│   │   └── templates/
│   │       └── tally_voucher.xml       # Master Jinja2 Tally Prime XML envelope template
│   ├── tests/
│   │   ├── test_parsers.py             # Unit tests for bank PDF extraction accuracy
│   │   └── test_saas.py                # Integration tests for auth, wallet, and conversions
│   └── requirements.txt                # Python dependencies manifest
│
├── frontend/
│   ├── public/                         # Static brand assets, favicons, logos, and QR codes
│   │   ├── symbol_mark.svg             # Official square emblem mark
│   │   ├── logo_horizontal.svg         # Horizontal brand lockup
│   │   ├── logo_stacked.svg            # Stacked logo
│   │   ├── app_icon_yellow.svg         # Yellow neo-brutalist badge
│   │   ├── feature_icons.svg           # 5-step process capability banner
│   │   ├── favicon.svg                 # SVG browser favicon
│   │   ├── QR-CODE.jpeg                # Official UPI payment QR code
│   │   └── social_square.svg           # Support / social icon
│   ├── src/
│   │   ├── assets/                     # Packaged SVG and PNG components
│   │   ├── App.jsx                     # Core application orchestrator & view components
│   │   ├── App.css                     # Custom animations and brutalist styles
│   │   ├── index.css                   # Tailwind CSS base and utility directives
│   │   └── main.jsx                    # React 18 DOM root rendering
│   ├── index.html                      # HTML root template with brand metadata & Play CDN
│   ├── package.json                    # Node dependencies & Vite build scripts
│   └── vite.config.js                  # Vite configuration & dev proxy settings
│
├── .gitignore                          # Ignores .db, .env, __pycache__, scratch/, *.pdf, *.xml
├── README.md                           # Master documentation
├── USER_MANUAL.md                      # End-user operational guide
├── PROJECT_CONTEXT_FOR_AI.md           # This AI master reference document
└── README.txt                          # Brand kit specifications & color palette reference
```

---

## 11. Security, Privacy & RBAC Principles

1. **In-Memory Statement Processing (Zero Retention)**:
   - When a user uploads a statement PDF, it is processed via `io.BytesIO(await file.read())`.
   - The file is never written to disk or third-party storage.
   - Memory buffers are freed immediately upon conversion completion.
2. **Database Protection**:
   - Raw SQLite files (`*.db`) and sensitive `.env` files are excluded from Git via `.gitignore`.
3. **Password & Token Security**:
   - Passwords hashed using `bcrypt` with salt rounds.
   - JWT tokens signed with a cryptographically secure `SECRET_KEY`.
   - Admin routes explicitly verify `current_user.is_admin == True`.
4. **Commercial Safeguards**:
   - Public open registration is disabled by default so unauthorized users cannot provision accounts.
   - Conversion endpoints enforce credit checks, preventing unauthorized use.

---

## 12. Environment Variables & Deployment Guide

### Environment Variables (`backend/.env`)
```bash
# Security
SECRET_KEY="your-super-secret-jwt-signing-key"
ALGORITHM="HS256"
ACCESS_TOKEN_EXPIRE_MINUTES="60"
REMEMBER_ME_EXPIRE_DAYS="365"

# Database Connection (SQLite default; use Postgres on Render)
DATABASE_URL="sqlite:///./balance_sheet_buddy.db"
# Example PostgreSQL URL:
# DATABASE_URL="postgresql://user:pass@host:5432/sheetbuddy_db"

# Admin Initial Provisioning
ADMIN_EMAIL="sheetbuddyorg@gmail.com"
ADMIN_PASSWORD="YourStrongAdminPassword123!"

# Email Service (Resend or SMTP)
RESEND_API_KEY="re_1234567890"
EMAIL_FROM="Sheet Buddy <notifications@sheetbuddy.com>"
SMTP_HOST="smtp.gmail.com"
SMTP_PORT="587"
SMTP_USER="sheetbuddyorg@gmail.com"
SMTP_PASSWORD="your-app-password"
```

### Running Locally

#### Backend:
```bash
cd backend
python -m venv venv
# Windows:
venv\Scripts\activate
# Linux/macOS:
source venv/bin/activate

pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

#### Frontend:
```bash
cd frontend
npm install
npm run dev
```

### Production Build & Deployment (Render.com)
1. **Frontend Build**:
   ```bash
   cd frontend
   npm run build
   # Outputs optimized static bundle to frontend/dist/
   ```
2. **Backend Service**:
   - Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
   - Set environment variables (`DATABASE_URL`, `SECRET_KEY`, `ADMIN_EMAIL`, etc.) in Render Dashboard.

---

## 13. Guidelines for AI Agents Modifying This Codebase

When writing code or adding features to **Sheet Buddy**, follow these mandatory rules:

1. **Preserve Neo-Brutalist Styling**:
   - Always maintain `border-2 border-black` / `border-4 border-black`, `shadow-[4px_4px_0px_rgba(0,0,0,1)]`, `rounded-none`, and high-contrast yellow/black palette. Never introduce rounded pastel modern corporate cards.
2. **Never Store PDFs to Disk**:
   - All parser operations must receive file streams (`io.BytesIO` or `bytes`) and process in-memory.
3. **Maintain Tally XML Compatibility**:
   - Tally XML is sensitive to tag names, capitalization, negative sign placement on Debit/Credit lines, and date format (`YYYYMMDD`). Test XML exports against standard Tally schemas.
4. **Preserve Mathematical Reconciliation Integrity**:
   - Any new bank parser MUST extract and return `opening_balance` and `closing_balance` and verify against the transaction sum.
5. **No Broken Links**:
   - All contact anchors must point to WhatsApp (`https://wa.me/919204915729`) and email (`mailto:sheetbuddyorg@gmail.com`).
6. **Documentation Preservation**:
   - Keep comments, docstrings, and schema validation error handlers intact when making edits.
