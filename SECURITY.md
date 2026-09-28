# SHEET BUDDY — SECURITY POLICY & SPECIFICATION

Sheet Buddy is designed with bank-grade security standards to protect financial records, user credentials, and operational integrity.

---

## 1. Zero PDF Disk Persistence Guarantee

- **Pure In-Memory Processing**: Bank statement PDFs uploaded to Sheet Buddy are processed entirely in-memory using `io.BytesIO` streams.
- **No Disk Writes**: Uploaded statement files are never written to disk or stored in long-term storage buckets.
- **Immediate GC Deallocation**: Once parsing completes, Python memory handles are dereferenced and cleaned up.

---

## 2. Authentication & Credential Hardening

- **Password Hashing**: Passwords are cryptographically salted and hashed using `bcrypt` / `passlib` (`CryptContext(schemes=["bcrypt"], deprecated="auto")`). Plaintext passwords are never logged or stored.
- **JWT Tokens & Timezone Awareness**: All JWT access tokens are signed using `HS256` with strict UTC timestamps (`datetime.now(timezone.utc)`).
- **Refresh Token Rotation**: Refresh tokens are single-use. When a refresh token is used, it is revoked and replaced with a new token. If a previously used token is presented, the token family is revoked to mitigate token replay attacks.
- **OTP Verification**: Multi-step registration and password resets require 6-digit cryptographic OTPs with time-based expiry windows (10 minutes).

---

## 3. Role-Based Access Control (RBAC)

- **User Isolation**: Standard users have strict data isolation; they can only view and modify their own conversions, ledger rules, clients, and wallet history.
- **Admin Boundaries**: Administrative endpoints (`/api/admin/*`) require explicit verification of `current_user.is_admin == True`.
- **Wallet Protection**: Wallet credit deductions and balances are strictly enforced server-side. Users cannot initiate conversions or exports exceeding their available balance.

---

## 4. Input Sanitization & XML Injection Defense

- **Tally XML Sanitization**: All user-provided fields (narrations, ledger names, voucher types, reference numbers) are stripped of XML control characters and escaped (`&`, `<`, `>`, `"`, `'`) before template embedding to eliminate XML injection vectors.
- **PDF Sanitization**: Uploaded files must match magic byte signatures (`%PDF`) and pass PyPDF parser validation to protect against malicious payload injection.

---

## 5. Audit Logging & Traceability

- **System Actions**: Sensitive operations (user logins, failed attempts, rule updates, credit adjustments, payment approvals) are recorded in the `audit_logs` table with timestamp, user ID, action name, and IP address.
- **Double-Entry Ledger Integrity**: Every wallet deduction stores `balance_before` and `balance_after` to guarantee auditability and prevent credit discrepancies.

---

## 6. Reporting Security Vulnerabilities

To report a security vulnerability or bug, please contact:
- **Email**: `sheetbuddyorg@gmail.com`
- **WhatsApp**: `+91 9204915729`
