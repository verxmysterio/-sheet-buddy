# Sheet Buddy - A Complete Tally Supporting Tool

Sheet Buddy is a high-performance SaaS tool designed to bridge the gap between bank statement PDF reports and Tally Prime. By parsing coordinates from bank statement PDFs and performing coordinate-level table extraction, Sheet Buddy translates bank statements into compliant Tally Vouchers (Receipt and Payment) in standard Tally XML format, allowing accounting teams to import thousands of transactions in seconds.

---

## 📸 Snapshot Previews

### 1. Persistent Login Screen
Secure, authenticated administrative console access featuring **"Remember Me"** token persistence and our simplified login interface.
![Login Page](docs/images/login_page_snapshot.jpg)

### 2. Main Dashboard & Statement Parser
Drag-and-drop PDF statement parsing uploader with support for multiple banking formats.
![Main Dashboard](docs/images/dashboard_main_snapshot.jpg)

### 3. Interactive Reconciliation Workspace
Real-time transaction validator displaying opening/closing balance matching status, transaction details, and inline editable narration text boxes.
![Reconciliation Workspace](docs/images/reconciliation_editor_snapshot.jpg)

---

## 🌟 Why Use Sheet Buddy?

- **Save Time & Labor**: Eliminate manual ledger matching. Instead of spending hours typing vouchers in Tally Prime, upload a statement and get an importable XML in seconds.
- **Accurate Calculations**: Built-in mathematical validation ensures that `Opening Balance + Credits - Debits == Closing Balance`. The tool alerts you immediately if any transaction is missing or miscalculated.
- **Tally Prime Compatibility**: Generated XML files conform fully to Tally XML formats, integrating seamlessly into Tally Prime ledger books.
- **Highly Secure**: User authentication, private session cookies, and local database storage ensure transaction data is protected and kept secure.

---

## ⚡ Core Features

- **Advanced PDF Extraction**: Layout parser extracts date, narration, reference numbers, debit, and credit from formatted PDF statements.
- **Smart Remember Me Persistence**: Keep active workspaces logged in for **365 days** on request, avoiding unexpected logout times during accounting tasks.
- **Interactive Reconciliation Editor**: Edit narration strings in real-time on-screen before generating your XML import file.
- **Credit Wallet System**: Deducts page credits only for processed statements. Administrative consoles can top-up or manage credits instantly.
- **Unified Contact Footer**: Direct CTA link buttons redirecting to WhatsApp and Email channels for instant customer support, demo booking, and custom pricing plans.
