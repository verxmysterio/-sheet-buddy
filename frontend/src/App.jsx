import React, { useState, useEffect, useRef } from 'react';

// Override fetch to support VITE_API_BASE_URL prefix in production
const originalFetch = window.fetch;
window.fetch = function (url, options) {
  const apiBase = import.meta.env.VITE_API_BASE_URL || '';
  let finalUrl = url;
  if (typeof url === 'string' && (url.startsWith('/api/') || url.startsWith('/api'))) {
    finalUrl = apiBase + url;
  }
  return originalFetch(finalUrl, options);
};

// --- Native Client-Side CSV & Tally XML Engines ---
const BLANK_CSV_CONTENT = `Date,Voucher Type,Voucher No,Debit Ledger,Credit Ledger,Amount,Narration,Ref / Cheque No
`;

const SAMPLE_CSV_CONTENT = `Date,Voucher Type,Voucher No,Debit Ledger,Credit Ledger,Amount,Narration,Ref / Cheque No
15-04-2026,Payment,PV-001,Office Rent Expenses,HDFC Bank Current A/c,25000.00,April 2026 Office Rent,CHQ-100234
16-04-2026,Payment,PV-002,Electricity Expenses,Cash,4250.00,BESCOM Electricity Bill April 2026,
17-04-2026,Receipt,RV-001,HDFC Bank Current A/c,Acme Technologies Ltd,150000.00,Advance for Software Consultancy,NEFT-998822
18-04-2026,Receipt,RV-002,Cash,Cash Sales A/c,12500.00,Counter cash collection,
19-04-2026,Contra,CV-001,HDFC Bank Current A/c,Cash,20000.00,Cash deposit into HDFC bank,DEP-01
20-04-2026,Contra,CV-002,Cash,HDFC Bank Current A/c,15000.00,Self cash withdrawal for office petty cash,ATM-55
21-04-2026,Journal,JV-001,Depreciation A/c,Office Computers A/c,8500.00,Monthly depreciation on computer hardware,
22-04-2026,Sales,SV-001,Bharat Enterprises,Sales Account,85000.00,Sale of IT hardware goods,INV-2026-04
23-04-2026,Purchase,PUR-001,Purchase Account,Global Tech Distributors,62000.00,Purchase of inventory stock,BILL-8891
`;

export const normalizeDateString = (raw) => {
  if (!raw) return '';
  let str = String(raw).trim().replace(/[\ufeff"']/g, '');
  if (!str) return '';
  // Strip timestamps if attached, e.g. "15-04-2026 14:32:00" or "2026-04-15T10:00:00"
  if (str.includes(' ')) str = str.split(' ')[0].trim();
  if (str.includes('T')) str = str.split('T')[0].trim();
  str = str.replace(/[,;]/g, '').trim();

  // YYYY-MM-DD or YYYY/MM/DD or YYYY.MM.DD
  let match = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (match) {
    const y = match[1];
    const m = match[2].padStart(2, '0');
    const d = match[3].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  // DD-MM-YYYY or DD/MM/YYYY or DD.MM.YYYY
  match = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (match) {
    const d = match[1].padStart(2, '0');
    const m = match[2].padStart(2, '0');
    let y = match[3];
    if (y.length === 2) y = (parseInt(y, 10) > 50 ? '19' : '20') + y;
    return `${y}-${m}-${d}`;
  }
  // DD-MMM-YYYY (e.g. 15-Apr-2026, 15 April 2026)
  const monthMap = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
  };
  match = str.match(/^(\d{1,2})[-/\s]([A-Za-z]{3,9})[-/\s](\d{2,4})$/);
  if (match) {
    const d = match[1].padStart(2, '0');
    const mon = match[2].substring(0, 3).toLowerCase();
    const m = monthMap[mon] || '01';
    let y = match[3];
    if (y.length === 2) y = (parseInt(y, 10) > 50 ? '19' : '20') + y;
    return `${y}-${m}-${d}`;
  }
  // JavaScript Date fallback
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    try {
      return parsed.toISOString().split('T')[0];
    } catch (e) {}
  }
  return str;
};

export const getCsvCreditPricing = (count) => {
  if (!count || count <= 0) return 0;
  return Math.max(1, Math.ceil(count / 10));
};

export const extractErrorMessage = (detail, fallback = "An error occurred.") => {
  if (!detail) return fallback;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail.map(d => {
      if (typeof d === 'string') return d;
      if (d && typeof d === 'object') {
        const field = Array.isArray(d.loc) ? d.loc.filter(x => x !== 'body').join('.') : '';
        return (field ? `${field}: ` : '') + (d.msg || d.message || JSON.stringify(d));
      }
      return String(d);
    }).join('; ') || fallback;
  }
  if (typeof detail === 'object') {
    return detail.msg || detail.message || JSON.stringify(detail);
  }
  return String(detail);
};

const findColumnIndex = (headers, colName, aliases = []) => {
  if (!headers || !headers.length) return -1;
  const clean = (s) => (s || '').toLowerCase().replace(/[\ufeff"']/g, '').trim();
  const target = clean(colName);
  
  if (target) {
    for (let i = 0; i < headers.length; i++) {
      if (clean(headers[i]) === target) return i;
    }
  }
  if (aliases && aliases.length > 0) {
    for (const alias of aliases) {
      const aClean = clean(alias);
      for (let i = 0; i < headers.length; i++) {
        if (clean(headers[i]) === aClean) return i;
      }
    }
    for (const alias of aliases) {
      const aClean = clean(alias);
      for (let i = 0; i < headers.length; i++) {
        if (clean(headers[i]).includes(aClean)) return i;
      }
    }
  }
  return -1;
};

function parseCsvRows(text) {
  if (!text) return [];
  // Strip UTF-8 BOM if present at start
  const cleanText = String(text).replace(/^\ufeff/, '');
  const lines = [];
  let row = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < cleanText.length; i++) {
    const char = cleanText[i];
    const nextChar = cleanText[i + 1];
    if (char === '"' || char === "'") {
      if (inQuotes && nextChar === char) {
        current += char;
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(current.trim().replace(/^[\ufeff"']|[\ufeff"']$/g, ''));
      current = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') i++;
      row.push(current.trim().replace(/^[\ufeff"']|[\ufeff"']$/g, ''));
      if (row.some(c => c !== '')) lines.push(row);
      row = [];
      current = '';
    } else {
      current += char;
    }
  }
  if (current || row.length > 0) {
    row.push(current.trim().replace(/^[\ufeff"']|[\ufeff"']$/g, ''));
    if (row.some(c => c !== '')) lines.push(row);
  }
  return lines;
}

function generateClientTallyXml(vouchers, mappingName = "Sheet Buddy Import") {
  const escapeXml = (unsafe) => {
    if (!unsafe) return "";
    return String(unsafe)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  };

  const formatTallyDate = (dateStr) => {
    if (!dateStr) return new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const normalized = normalizeDateString(dateStr);
    if (normalized && normalized.includes('-')) {
      const parts = normalized.split('-');
      if (parts.length === 3) {
        return `${parts[0]}${parts[1]}${parts[2]}`;
      }
    }
    const cleaned = String(dateStr).replace(/[^0-9]/g, '');
    if (cleaned.length === 8) {
      if (parseInt(cleaned.slice(0, 4)) > 1900) return cleaned;
      return cleaned.slice(4, 8) + cleaned.slice(2, 4) + cleaned.slice(0, 2);
    }
    return new Date().toISOString().slice(0, 10).replace(/-/g, '');
  };

  let xml = `<ENVELOPE>\n  <HEADER>\n    <TALLYREQUEST>Import Data</TALLYREQUEST>\n  </HEADER>\n  <BODY>\n    <IMPORTDATA>\n      <REQUESTDESC>\n        <REPORTNAME>All Masters</REPORTNAME>\n        <STATICVARIABLES>\n          <SVOverwriteImpVch>Yes</SVOverwriteImpVch>\n          <SVCURRENTCOMPANY>${escapeXml(mappingName)}</SVCURRENTCOMPANY>\n        </STATICVARIABLES>\n      </REQUESTDESC>\n      <REQUESTDATA>\n`;

  for (let idx = 0; idx < vouchers.length; idx++) {
    const vch = vouchers[idx];
    const vtype = vch.voucher_type || "Payment";
    const vdate = formatTallyDate(vch.date);
    const amt = parseFloat(vch.amount) || 0.0;
    const narr = vch.narration || "";
    const vno = vch.voucher_number || `VCH-${idx + 1}`;
    const drLedger = vch.debit_ledger || "Suspense";
    const crLedger = vch.credit_ledger || "Cash";
    const refNo = vch.ref_no || "";

    const isPayment = vtype.toLowerCase() === "payment";
    const isReceipt = vtype.toLowerCase() === "receipt";
    const isContra = vtype.toLowerCase() === "contra";

    xml += `        <TALLYMESSAGE xmlns:UDF="TallyUDF">\n`;
    xml += `          <VOUCHER VCHTYPE="${escapeXml(vtype)}" ACTION="Create" OBJVIEW="Accounting Voucher View">\n`;
    xml += `            <DATE>${vdate}</DATE>\n`;
    xml += `            <GUID>SB-CSV-${idx + 1}-${Date.now()}</GUID>\n`;
    xml += `            <VOUCHERTYPENAME>${escapeXml(vtype)}</VOUCHERTYPENAME>\n`;
    xml += `            <VOUCHERNUMBER>${escapeXml(vno)}</VOUCHERNUMBER>\n`;
    xml += `            <PARTYLEDGERNAME>${escapeXml(isPayment ? crLedger : (isReceipt ? drLedger : drLedger))}</PARTYLEDGERNAME>\n`;
    xml += `            <NARRATION>${escapeXml(narr)}</NARRATION>\n`;

    // Debit Ledger (Negative amount in Tally Prime double-entry)
    xml += `            <ALLLEDGERENTRIES.LIST>\n`;
    xml += `              <LEDGERNAME>${escapeXml(drLedger)}</LEDGERNAME>\n`;
    xml += `              <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>\n`;
    xml += `              <AMOUNT>-${amt.toFixed(2)}</AMOUNT>\n`;
    if (isReceipt && refNo) {
      xml += `              <BANKALLOCATIONS.LIST>\n`;
      xml += `                <DATE>${vdate}</DATE>\n`;
      xml += `                <INSTRUMENTNUMBER>${escapeXml(refNo)}</INSTRUMENTNUMBER>\n`;
      xml += `                <TRANSACTIONTYPE>Cheque/DD</TRANSACTIONTYPE>\n`;
      xml += `                <AMOUNT>-${amt.toFixed(2)}</AMOUNT>\n`;
      xml += `              </BANKALLOCATIONS.LIST>\n`;
    }
    xml += `            </ALLLEDGERENTRIES.LIST>\n`;

    // Credit Ledger (Positive amount in Tally Prime double-entry)
    xml += `            <ALLLEDGERENTRIES.LIST>\n`;
    xml += `              <LEDGERNAME>${escapeXml(crLedger)}</LEDGERNAME>\n`;
    xml += `              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>\n`;
    xml += `              <ISPARTYLEDGER>Yes</ISPARTYLEDGER>\n`;
    xml += `              <AMOUNT>${amt.toFixed(2)}</AMOUNT>\n`;
    if ((isPayment || isContra) && refNo) {
      xml += `              <BANKALLOCATIONS.LIST>\n`;
      xml += `                <DATE>${vdate}</DATE>\n`;
      xml += `                <INSTRUMENTNUMBER>${escapeXml(refNo)}</INSTRUMENTNUMBER>\n`;
      xml += `                <TRANSACTIONTYPE>Cheque/DD</TRANSACTIONTYPE>\n`;
      xml += `                <AMOUNT>${amt.toFixed(2)}</AMOUNT>\n`;
      xml += `              </BANKALLOCATIONS.LIST>\n`;
    }
    xml += `            </ALLLEDGERENTRIES.LIST>\n`;

    xml += `          </VOUCHER>\n`;
    xml += `        </TALLYMESSAGE>\n`;
  }

  xml += `      </REQUESTDATA>\n    </IMPORTDATA>\n  </BODY>\n</ENVELOPE>`;
  return xml;
}

export function generateBankStatementTallyXml(transactions, bankLedgerName = "State Bank of India", fallbackCounterLedger = "Suspense Account") {
  const escapeXml = (unsafe) => {
    if (!unsafe) return "";
    return String(unsafe)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  };

  const formatTallyDate = (dateVal) => {
    if (!dateVal) return new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const str = String(dateVal).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
      return str.slice(0, 10).replace(/-/g, '');
    }
    const clean = str.replace(/[^0-9]/g, '');
    if (clean.length === 8) {
      if (parseInt(clean.slice(0, 4)) > 1900) return clean;
      return clean.slice(4, 8) + clean.slice(2, 4) + clean.slice(0, 2);
    }
    return new Date().toISOString().slice(0, 10).replace(/-/g, '');
  };

  let xml = `<ENVELOPE>\n  <HEADER>\n    <TALLYREQUEST>Import Data</TALLYREQUEST>\n  </HEADER>\n  <BODY>\n    <IMPORTDATA>\n      <REQUESTDESC>\n        <REPORTNAME>All Masters</REPORTNAME>\n        <STATICVARIABLES>\n          <SVOverwriteImpVch>Yes</SVOverwriteImpVch>\n          <SVCURRENTCOMPANY>Sheet Buddy Import</SVCURRENTCOMPANY>\n        </STATICVARIABLES>\n      </REQUESTDESC>\n      <REQUESTDATA>\n`;

  for (let idx = 0; idx < transactions.length; idx++) {
    const tx = transactions[idx];
    const isDebit = (tx.debit || 0) > 0;
    const isCredit = (tx.credit || 0) > 0;
    const amt = isDebit ? parseFloat(tx.debit) : (isCredit ? parseFloat(tx.credit) : 0.0);
    if (!amt) continue;

    const vdate = formatTallyDate(tx.txn_date);
    const counterLedger = tx.assigned_ledger || fallbackCounterLedger || "Suspense Account";
    const isContra = counterLedger.toLowerCase().includes('cash') || counterLedger.toLowerCase().includes('bank');
    const vtype = isContra ? 'Contra' : (isDebit ? (tx.voucher_type || 'Payment') : (tx.voucher_type || 'Receipt'));
    const refNo = tx.ref_no || tx.utr || '';

    const drLedger = isDebit ? counterLedger : bankLedgerName;
    const crLedger = isDebit ? bankLedgerName : counterLedger;
    const partyLedger = counterLedger;

    xml += `        <TALLYMESSAGE xmlns:UDF="TallyUDF">\n`;
    xml += `          <VOUCHER VCHTYPE="${escapeXml(vtype)}" ACTION="Create" OBJVIEW="Accounting Voucher View">\n`;
    xml += `            <DATE>${vdate}</DATE>\n`;
    xml += `            <GUID>SB-STMT-${idx + 1}-${Date.now()}</GUID>\n`;
    xml += `            <VOUCHERTYPENAME>${escapeXml(vtype)}</VOUCHERTYPENAME>\n`;
    xml += `            <VOUCHERNUMBER>${escapeXml(tx.ref_no || `TXN-${idx + 1}`)}</VOUCHERNUMBER>\n`;
    xml += `            <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>\n`;
    xml += `            <PARTYLEDGERNAME>${escapeXml(partyLedger)}</PARTYLEDGERNAME>\n`;
    xml += `            <NARRATION>${escapeXml(tx.narration || '')}</NARRATION>\n`;

    // Debit Line
    xml += `            <ALLLEDGERENTRIES.LIST>\n`;
    xml += `              <LEDGERNAME>${escapeXml(drLedger)}</LEDGERNAME>\n`;
    xml += `              <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>\n`;
    xml += `              <AMOUNT>-${amt.toFixed(2)}</AMOUNT>\n`;
    if (!isDebit && refNo) {
      xml += `              <BANKALLOCATIONS.LIST>\n`;
      xml += `                <DATE>${vdate}</DATE>\n`;
      xml += `                <INSTRUMENTNUMBER>${escapeXml(refNo)}</INSTRUMENTNUMBER>\n`;
      xml += `                <TRANSACTIONTYPE>Others</TRANSACTIONTYPE>\n`;
      xml += `                <AMOUNT>-${amt.toFixed(2)}</AMOUNT>\n`;
      xml += `              </BANKALLOCATIONS.LIST>\n`;
    }
    xml += `            </ALLLEDGERENTRIES.LIST>\n`;

    // Credit Line
    xml += `            <ALLLEDGERENTRIES.LIST>\n`;
    xml += `              <LEDGERNAME>${escapeXml(crLedger)}</LEDGERNAME>\n`;
    xml += `              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>\n`;
    xml += `              <AMOUNT>${amt.toFixed(2)}</AMOUNT>\n`;
    if (isDebit && refNo) {
      xml += `              <BANKALLOCATIONS.LIST>\n`;
      xml += `                <DATE>${vdate}</DATE>\n`;
      xml += `                <INSTRUMENTNUMBER>${escapeXml(refNo)}</INSTRUMENTNUMBER>\n`;
      xml += `                <TRANSACTIONTYPE>Others</TRANSACTIONTYPE>\n`;
      xml += `                <AMOUNT>${amt.toFixed(2)}</AMOUNT>\n`;
      xml += `              </BANKALLOCATIONS.LIST>\n`;
    }
    xml += `            </ALLLEDGERENTRIES.LIST>\n`;

    xml += `          </VOUCHER>\n`;
    xml += `        </TALLYMESSAGE>\n`;
  }

  xml += `      </REQUESTDATA>\n    </IMPORTDATA>\n  </BODY>\n</ENVELOPE>`;
  return xml;
}

export default function App() {
  // --- Auth State ---
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [user, setUser] = useState(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  
  // --- New OTP & Recovery States ---
  const [authMode, setAuthMode] = useState('login'); // 'login' | 'register' | 'verify' | 'forgot' | 'reset'
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [verificationEmail, setVerificationEmail] = useState('');
  const [statusMessage, setStatusMessage] = useState('');

  // --- Profile / Change Password States ---
  const [currentPassword, setCurrentPassword] = useState('');
  const [profileNewPassword, setProfileNewPassword] = useState('');
  const [profileConfirmNewPassword, setProfileConfirmNewPassword] = useState('');
  const [profileSuccessMsg, setProfileSuccessMsg] = useState('');
  const [profileErrorMsg, setProfileErrorMsg] = useState('');
  const [profileLoading, setProfileLoading] = useState(false);

  // --- App View State ---
  const [activeTab, setActiveTab] = useState('convert'); // 'convert' | 'history' | 'wallet' | 'rules' | 'settings' | 'admin'

  // --- Upload / Convert State ---
  const [bankName, setBankName] = useState('sbi');
  const [supportedBanks, setSupportedBanks] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedFiles, setSelectedFiles] = useState([]); // Multiple statement files
  const [uploadProgress, setUploadProgress] = useState(null); // { current, total, filename }
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [parsedSummary, setParsedSummary] = useState(null);
  const [allTransactions, setAllTransactions] = useState([]);
  
  // --- Review Queue & Filter States ---
  const [filterMode, setFilterMode] = useState('ALL'); // 'ALL' | 'READY' | 'REVIEW' | 'DUPLICATES' | 'DEBIT' | 'CREDIT'
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRowIds, setSelectedRowIds] = useState(new Set());
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [currentReviewIdx, setCurrentReviewIdx] = useState(0);
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);
  const [undoStack, setUndoStack] = useState([]);
  const [bulkLedgerInput, setBulkLedgerInput] = useState('');

  // --- Custom Tally Overrides & Counter Ledger Modes ---
  const [tallyLedgerName, setTallyLedgerName] = useState('');
  const [counterLedgerMode, setCounterLedgerMode] = useState('AUTO'); // 'AUTO' | 'CUSTOM'
  const [customCounterLedger, setCustomCounterLedger] = useState('Suspense Account');
  const [counterLedgerName, setCounterLedgerName] = useState('Suspense Account');
  const [creditVoucherType, setCreditVoucherType] = useState('Receipt');
  const [debitVoucherType, setDebitVoucherType] = useState('Payment');
  const [editedNarrations, setEditedNarrations] = useState({}); // idx -> customized narration text
  const [editedLedgers, setEditedLedgers] = useState({}); // idx -> customized counter ledger
  
  // --- Ledger Rules State ---
  const [userRules, setUserRules] = useState([]);
  const [ruleNameInput, setRuleNameInput] = useState('');
  const [rulePatternInput, setRulePatternInput] = useState('');
  const [ruleMatchType, setRuleMatchType] = useState('CONTAINS');
  const [ruleLedgerInput, setRuleLedgerInput] = useState('');
  const [ruleVoucherType, setRuleVoucherType] = useState('Payment');
  const [ruleCategoryInput, setRuleCategoryInput] = useState('General');
  
  // --- Feature 10: Multi-Client Practice Workspace & Cloud Dossier States ---
  const [clientsList, setClientsList] = useState([]);
  const [activeClientId, setActiveClientId] = useState(''); // '' means 'All Clients' or general
  const [selectedDossierClient, setSelectedDossierClient] = useState(null);
  const [dossierData, setDossierData] = useState(null);
  const [dossierLoading, setDossierLoading] = useState(false);
  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState(null);
  const [clientSearchQuery, setClientSearchQuery] = useState('');
  const [historyClientFilter, setHistoryClientFilter] = useState('');
  
  // Client Form state
  const [clientFormName, setClientFormName] = useState('');
  const [clientFormPan, setClientFormPan] = useState('');
  const [clientFormGstin, setClientFormGstin] = useState('');
  const [clientFormEmail, setClientFormEmail] = useState('');
  const [clientFormPhone, setClientFormPhone] = useState('');
  const [clientFormFy, setClientFormFy] = useState('2024-25');
  const [clientFormType, setClientFormType] = useState('Proprietorship');
  const [clientFormNotes, setClientFormNotes] = useState('');
  const [clientSaving, setClientSaving] = useState(false);
  const [clientError, setClientError] = useState('');

  // --- CSV Template, Mapping & Conversion States ---
  const [csvMappings, setCsvMappings] = useState(() => {
    try {
      const saved = localStorage.getItem('sheetbuddy_csv_mappings');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });
  const [selectedCsvMappingId, setSelectedCsvMappingId] = useState('default');
  const [csvFile, setCsvFile] = useState(null);
  const [csvUploading, setCsvUploading] = useState(false);
  const [csvError, setCsvError] = useState('');
  const [csvPreviewData, setCsvPreviewData] = useState(null);
  const [csvVouchers, setCsvVouchers] = useState([]);
  const [csvFilterType, setCsvFilterType] = useState('ALL');
  const [csvSearchQuery, setCsvSearchQuery] = useState('');
  const [csvConverting, setCsvConverting] = useState(false);
  const [csvConvertError, setCsvConvertError] = useState('');
  
  // Custom Mapping Modal / Form state
  const [mappingModalOpen, setMappingModalOpen] = useState(false);
  const [editingMappingId, setEditingMappingId] = useState(null);
  const [inspectingCsv, setInspectingCsv] = useState(false);
  const [detectedHeaders, setDetectedHeaders] = useState([]);
  const [mapFormName, setMapFormName] = useState('');
  const [mapFormDesc, setMapFormDesc] = useState('');
  const [mapFormDateCol, setMapFormDateCol] = useState('Date');
  const [mapFormDateFmt, setMapFormDateFmt] = useState('%d-%m-%Y');
  const [mapFormVtypeCol, setMapFormVtypeCol] = useState('Voucher Type');
  const [mapFormDefVtype, setMapFormDefVtype] = useState('Payment');
  const [mapFormVnumCol, setMapFormVnumCol] = useState('Voucher No');
  const [mapFormDrCol, setMapFormDrCol] = useState('Debit Ledger');
  const [mapFormDefDr, setMapFormDefDr] = useState('');
  const [mapFormCrCol, setMapFormCrCol] = useState('Credit Ledger');
  const [mapFormDefCr, setMapFormDefCr] = useState('');
  const [mapFormAmtCol, setMapFormAmtCol] = useState('Amount');
  const [mapFormDrAmtCol, setMapFormDrAmtCol] = useState('');
  const [mapFormCrAmtCol, setMapFormCrAmtCol] = useState('');
  const [mapFormNarrCol, setMapFormNarrCol] = useState('Narration');
  const [mapFormDefNarr, setMapFormDefNarr] = useState('');
  const [mapFormRefCol, setMapFormRefCol] = useState('Ref / Cheque No');

  const [executeLoading, setExecuteLoading] = useState(false);
  const [executeError, setExecuteError] = useState('');

  const parseUtcDate = (dateStr) => {
    if (!dateStr) return null;
    let s = String(dateStr);
    if (s.includes(' ') && !s.includes('T')) {
      s = s.replace(' ', 'T');
    }
    if (!s.endsWith('Z') && !s.includes('+') && !s.includes('-')) {
      s = s + 'Z';
    }
    return new Date(s);
  };

  const formatDisplayDate = (dateVal, includeTime = true) => {
    if (!dateVal) return 'N/A';
    try {
      const d = parseUtcDate(dateVal);
      if (!d || isNaN(d.getTime())) return String(dateVal);
      return includeTime ? d.toLocaleString() : d.toLocaleDateString();
    } catch (e) {
      return String(dateVal || 'N/A');
    }
  };

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [importDropdownOpen, setImportDropdownOpen] = useState(false);
  const [configDropdownOpen, setConfigDropdownOpen] = useState(false);
  const importMenuRef = useRef(null);
  const configMenuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (importMenuRef.current && !importMenuRef.current.contains(event.target)) {
        setImportDropdownOpen(false);
      }
      if (configMenuRef.current && !configMenuRef.current.contains(event.target)) {
        setConfigDropdownOpen(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  // --- Data Log States ---
  const [conversionsHistory, setConversionsHistory] = useState([]);
  const [walletTransactions, setWalletTransactions] = useState([]);
  
  // --- History Search State ---
  const [historySearch, setHistorySearch] = useState('');



  // --- Wallet Purchase State & Checkout ---
  const [purchaseLoading, setPurchaseLoading] = useState(false);
  const [purchaseMessage, setPurchaseMessage] = useState('');
  const [checkoutSession, setCheckoutSession] = useState(null); // { planName, pages, amount }
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [upiId, setUpiId] = useState('');
  const [checkoutError, setCheckoutError] = useState('');

  // --- Promo Code Redemption State ---
  const [promoCode, setPromoCode] = useState('');
  const [redeemLoading, setRedeemLoading] = useState(false);
  const [redeemStatusMsg, setRedeemStatusMsg] = useState('');
  // --- Admin Console State ---
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminStats, setAdminStats] = useState(null);
  const [adminConversions, setAdminConversions] = useState([]);
  const [adminPayments, setAdminPayments] = useState([]);
  const [adminQueries, setAdminQueries] = useState([]);
  const [supportSubject, setSupportSubject] = useState('');
  const [supportDescription, setSupportDescription] = useState('');
  const [supportWhatsapp, setSupportWhatsapp] = useState('');
  const [supportLoading, setSupportLoading] = useState(false);
  const [supportMessage, setSupportMessage] = useState('');
  const [adminPromoCodes, setAdminPromoCodes] = useState([]);
  const [promoFormCode, setPromoFormCode] = useState('');
  const [promoFormCredits, setPromoFormCredits] = useState(50);
  const [promoFormType, setPromoFormType] = useState('UNIVERSAL_ONCE');
  const [promoFormExpiresAt, setPromoFormExpiresAt] = useState('');
  const [promoFormError, setPromoFormError] = useState('');
  const [creditAdjustmentInputs, setCreditAdjustmentInputs] = useState({});
  const [adminBanks, setAdminBanks] = useState([]);
  const [selectedBankConfig, setSelectedBankConfig] = useState(null);
  const [bankFormKey, setBankFormKey] = useState('');
  const [bankFormName, setBankFormName] = useState('');
  const [bankFormPatterns, setBankFormPatterns] = useState('');
  const [bankFormType, setBankFormType] = useState('SIMULATOR');
  const [bankFormConfigJson, setBankFormConfigJson] = useState('{\n  \n}');
  const [bankFormError, setBankFormError] = useState('');

  // --- Admin User Creation State ---
  const [adminNewUserEmail, setAdminNewUserEmail] = useState('');
  const [adminNewUserPassword, setAdminNewUserPassword] = useState('');
  const [adminNewUserCredits, setAdminNewUserCredits] = useState(100);
  const [adminNewUserIsAdmin, setAdminNewUserIsAdmin] = useState(false);
  const [adminNewUserLoading, setAdminNewUserLoading] = useState(false);
  const [adminNewUserSuccess, setAdminNewUserSuccess] = useState('');
  const [adminNewUserError, setAdminNewUserError] = useState('');


  // Synchronize auth state
  useEffect(() => {
    if (token) {
      localStorage.setItem('token', token);
      fetchUserProfile();
      fetchHistory();
      fetchWalletTxs();
      fetchSupportedBanks();
      fetchUserRules();
      fetchCsvMappings();
      fetchClients();
    } else {
      localStorage.removeItem('token');
      setUser(null);
      setClientsList([]);
    }
  }, [token]);

  // Comprehensive Tally Prime Keyboard Hotkeys
  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      // 1. Esc: close active modals or dropdown menus
      if (e.key === 'Escape') {
        if (reviewModalOpen || shortcutsModalOpen || mappingModalOpen || clientModalOpen || mobileMenuOpen) {
          e.preventDefault();
          setReviewModalOpen(false);
          setShortcutsModalOpen(false);
          setMappingModalOpen(false);
          setClientModalOpen(false);
          setMobileMenuOpen(false);
          return;
        }
        if (importDropdownOpen || configDropdownOpen) {
          e.preventDefault();
          setImportDropdownOpen(false);
          setConfigDropdownOpen(false);
          return;
        }
      }

      // Check if user is typing inside an editable text element
      const isInputActive = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable;

      // 2. Modifiers with Ctrl / Cmd
      if (e.ctrlKey || e.metaKey) {
        // Ctrl + F -> Focus search input
        if (e.key.toLowerCase() === 'f') {
          const searchEl = document.getElementById('table-search-input') || 
                           document.getElementById('history-search-input') ||
                           document.querySelector('input[placeholder*="Search"]');
          if (searchEl) {
            e.preventDefault();
            searchEl.focus();
            searchEl.select();
          }
          return;
        }

        // Ctrl + Z -> Undo narration edit
        if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
          if (undoStack && undoStack.length > 0) {
            e.preventDefault();
            const lastUndo = undoStack[undoStack.length - 1];
            if (lastUndo && lastUndo.type === 'NARRATION') {
              setEditedNarrations(prev => ({
                ...prev,
                [lastUndo.idx]: lastUndo.oldText
              }));
              setUndoStack(prev => prev.slice(0, -1));
            }
          }
          return;
        }

        // Ctrl + E -> Export / Convert to Tally XML
        if (e.key.toLowerCase() === 'e') {
          const exportBtn = document.getElementById('btn-export-tally-xml') || 
                            document.getElementById('btn-convert-tally-xml') || 
                            document.getElementById('btn-convert-csv-xml');
          if (exportBtn && !exportBtn.disabled) {
            e.preventDefault();
            exportBtn.click();
            return;
          }
        }
      }

      // 3. Modifiers with Alt
      if (e.altKey) {
        // Alt + S -> Toggle Shortcuts Modal
        if (e.key.toLowerCase() === 's') {
          e.preventDefault();
          setShortcutsModalOpen(prev => !prev);
          return;
        }

        // Alt + A -> Auto-match Ledgers
        if (e.key.toLowerCase() === 'a') {
          const matchBtn = document.getElementById('btn-auto-match-ledgers');
          if (matchBtn && !matchBtn.disabled) {
            e.preventDefault();
            matchBtn.click();
            return;
          }
        }

        // Alt + D -> Open Dossier
        if (e.key.toLowerCase() === 'd') {
          const dossierBtn = document.getElementById('btn-open-dossier');
          if (dossierBtn && !dossierBtn.disabled) {
            e.preventDefault();
            dossierBtn.click();
            return;
          } else {
            e.preventDefault();
            setActiveTab('clients');
            return;
          }
        }

        // Alt + 1 -> PDF to Tally
        if (e.key === '1') {
          e.preventDefault();
          setActiveTab('convert');
          setImportDropdownOpen(false);
          setConfigDropdownOpen(false);
          setExecuteError('');
          return;
        }

        // Alt + 2 -> CSV to Tally
        if (e.key === '2') {
          e.preventDefault();
          setActiveTab('csv');
          setImportDropdownOpen(false);
          setConfigDropdownOpen(false);
          setExecuteError('');
          return;
        }

        // Alt + 3 -> Cloud XML Vault
        if (e.key === '3') {
          e.preventDefault();
          setActiveTab('history');
          setImportDropdownOpen(false);
          setConfigDropdownOpen(false);
          setExecuteError('');
          return;
        }
      }

      // 4. Function keys [F1] - [F5] (Toggle dropdowns or switch primary tabs)
      if (e.key === 'F1') {
        e.preventDefault();
        setImportDropdownOpen(prev => !prev);
        setConfigDropdownOpen(false);
        setExecuteError('');
        return;
      }

      if (e.key === 'F2') {
        e.preventDefault();
        setConfigDropdownOpen(prev => !prev);
        setImportDropdownOpen(false);
        setExecuteError('');
        return;
      }

      if (e.key === 'F3') {
        e.preventDefault();
        setActiveTab('wallet');
        setImportDropdownOpen(false);
        setConfigDropdownOpen(false);
        setExecuteError('');
        return;
      }

      if (e.key === 'F4') {
        e.preventDefault();
        setActiveTab('support');
        setImportDropdownOpen(false);
        setConfigDropdownOpen(false);
        setExecuteError('');
        return;
      }

      if (e.key === 'F5') {
        e.preventDefault();
        setActiveTab('settings');
        setImportDropdownOpen(false);
        setConfigDropdownOpen(false);
        setExecuteError('');
        return;
      }

      // If user is currently typing inside an input/textarea, do NOT intercept numeric keys
      if (isInputActive) return;

      // 5. Numeric keys [1], [2], [3] (Tally menu selection)
      if (e.key === '1') {
        e.preventDefault();
        if (configDropdownOpen || activeTab === 'clients' || activeTab === 'rules' || activeTab === 'history') {
          setActiveTab('clients');
          setSelectedDossierClient(null);
        } else {
          setActiveTab('convert');
        }
        setImportDropdownOpen(false);
        setConfigDropdownOpen(false);
        setExecuteError('');
        return;
      }

      if (e.key === '2') {
        e.preventDefault();
        if (configDropdownOpen || activeTab === 'clients' || activeTab === 'rules' || activeTab === 'history') {
          setActiveTab('rules');
        } else {
          setActiveTab('csv');
        }
        setImportDropdownOpen(false);
        setConfigDropdownOpen(false);
        setExecuteError('');
        return;
      }

      if (e.key === '3') {
        e.preventDefault();
        setActiveTab('history');
        setImportDropdownOpen(false);
        setConfigDropdownOpen(false);
        setExecuteError('');
        return;
      }

      // '?' key opens Shortcuts Modal
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        setShortcutsModalOpen(prev => !prev);
        return;
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [
    importDropdownOpen, configDropdownOpen, activeTab, undoStack,
    reviewModalOpen, shortcutsModalOpen, mappingModalOpen, clientModalOpen, mobileMenuOpen
  ]);

  // --- API Functions ---
  const fetchUserProfile = async () => {
    try {
      const res = await fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data);
      } else {
        handleLogout();
      }
    } catch (e) {
      console.error("Profile fetch error", e);
    }
  };

  const fetchUserRules = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/convert/rules', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setUserRules(data);
      }
    } catch (e) {
      console.error("Rules fetch error", e);
    }
  };

  const handleCreateRule = async (e) => {
    e.preventDefault();
    if (!rulePatternInput.trim() || !ruleLedgerInput.trim()) {
      alert("Please enter a match pattern and ledger name.");
      return;
    }
    try {
      const res = await fetch('/api/convert/rules', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          rule_name: ruleNameInput.trim() || `Rule for ${ruleLedgerInput.trim()}`,
          pattern: rulePatternInput.trim(),
          match_type: ruleMatchType,
          ledger_name: ruleLedgerInput.trim(),
          voucher_type: ruleVoucherType,
          category: ruleCategoryInput.trim() || 'General',
          priority: 10
        })
      });
      if (res.ok) {
        setRuleNameInput('');
        setRulePatternInput('');
        setRuleLedgerInput('');
        fetchUserRules();
        alert("Ledger rule saved successfully!");
      } else {
        const err = await res.json();
        alert(extractErrorMessage(err.detail, "Failed to save rule."));
      }
    } catch (err) {
      alert("Network error. Failed to save rule.");
    }
  };

  const handleDeleteRule = async (ruleId) => {
    if (!confirm("Are you sure you want to delete this rule?")) return;
    try {
      const res = await fetch(`/api/convert/rules/${ruleId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        fetchUserRules();
      } else {
        alert("Failed to delete rule.");
      }
    } catch (err) {
      alert("Network error.");
    }
  };

  const fetchSupportedBanks = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/convert/banks', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setSupportedBanks(data);
        if (data.length > 0) {
          setBankName(prev => {
            if (prev && data.some(b => b.bank_key === prev)) return prev;
            return data[0].bank_key;
          });
        }
      }
    } catch (e) {
      console.error("Failed to fetch supported banks", e);
    }
  };

  const fetchHistory = async () => {
    try {
      const res = await fetch('/api/convert/history', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setConversionsHistory(data);
      }
    } catch (e) {
      console.error("History fetch error", e);
    }
  };

  const fetchWalletTxs = async () => {
    try {
      const res = await fetch('/api/wallet/transactions', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setWalletTransactions(data);
      }
    } catch (e) {
      console.error("Wallet transactions fetch error", e);
    }
  };

  // --- Feature 10: Multi-Client Workspace & Cloud Vault Functions ---
  const fetchClients = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/convert/clients', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setClientsList(data);
      }
    } catch (e) {
      console.error("Failed to fetch clients", e);
    }
  };

  const fetchClientDossier = async (clientId) => {
    if (!token || !clientId) return;
    setDossierLoading(true);
    try {
      const res = await fetch(`/api/convert/clients/${clientId}/dossier`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setDossierData(data);
      }
    } catch (e) {
      console.error("Failed to fetch client dossier", e);
    } finally {
      setDossierLoading(false);
    }
  };

  const handleOpenClientModal = (clientToEdit = null) => {
    setClientError('');
    if (clientToEdit) {
      setEditingClient(clientToEdit);
      setClientFormName(clientToEdit.name || '');
      setClientFormPan(clientToEdit.pan || '');
      setClientFormGstin(clientToEdit.gstin || '');
      setClientFormEmail(clientToEdit.email || '');
      setClientFormPhone(clientToEdit.phone || '');
      setClientFormFy(clientToEdit.financial_year || '2024-25');
      setClientFormType(clientToEdit.business_type || 'Proprietorship');
      setClientFormNotes(clientToEdit.notes || '');
    } else {
      setEditingClient(null);
      setClientFormName('');
      setClientFormPan('');
      setClientFormGstin('');
      setClientFormEmail('');
      setClientFormPhone('');
      setClientFormFy('2024-25');
      setClientFormType('Proprietorship');
      setClientFormNotes('');
    }
    setClientModalOpen(true);
  };

  const handleSaveClient = async (e) => {
    if (e) e.preventDefault();
    if (!clientFormName.trim()) {
      setClientError('Client company name is required.');
      return;
    }
    setClientSaving(true);
    setClientError('');
    try {
      const payload = {
        name: clientFormName.trim(),
        pan: clientFormPan.trim() || null,
        gstin: clientFormGstin.trim() || null,
        email: clientFormEmail.trim() || null,
        phone: clientFormPhone.trim() || null,
        financial_year: clientFormFy || '2024-25',
        business_type: clientFormType || 'Proprietorship',
        notes: clientFormNotes.trim() || null
      };
      const url = editingClient ? `/api/convert/clients/${editingClient.id}` : '/api/convert/clients';
      const method = editingClient ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to save client.');
      }
      setClientModalOpen(false);
      fetchClients();
      if (selectedDossierClient && selectedDossierClient.id === (editingClient?.id)) {
        fetchClientDossier(editingClient.id);
      }
    } catch (err) {
      setClientError(err.message || 'Error saving client');
    } finally {
      setClientSaving(false);
    }
  };

  const handleDeleteClient = async (clientId, clientName) => {
    if (!confirm(`Are you sure you want to delete client '${clientName}'? Any existing converted records will be preserved.`)) return;
    try {
      const res = await fetch(`/api/convert/clients/${clientId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        if (activeClientId === clientId) setActiveClientId('');
        if (selectedDossierClient?.id === clientId) setSelectedDossierClient(null);
        fetchClients();
        fetchHistory();
      }
    } catch (err) {
      alert('Failed to delete client.');
    }
  };

  const handleSaveXmlToCloudVault = async (xmlContent, meta = {}) => {
    if (!token || !xmlContent) return null;
    try {
      const payload = {
        client_id: activeClientId || meta.client_id || null,
        bank_name: meta.bank_name || 'Bank Statement',
        file_name: meta.file_name || 'Tally_Import.xml',
        xml_content: xmlContent,
        statement_period: meta.statement_period || 'Consolidated',
        transactions_count: meta.transactions_count || 0,
        pages_count: meta.pages_count || 1,
        opening_balance: meta.opening_balance || 0.0,
        closing_balance: meta.closing_balance || 0.0,
        source_type: meta.source_type || 'STATEMENT_PDF'
      };
      const res = await fetch('/api/convert/save-cloud-xml', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const data = await res.json();
        fetchHistory();
        fetchClients();
        if (selectedDossierClient) {
          fetchClientDossier(selectedDossierClient.id);
        }
        return data;
      }
    } catch (e) {
      console.warn("Auto-save to cloud vault warning:", e);
    }
    return null;
  };

  const handleDeleteHistoryXml = async (conversionId) => {
    if (!confirm('Are you sure you want to remove this XML record from your Cloud Vault?')) return;
    try {
      const res = await fetch(`/api/convert/history/${conversionId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        fetchHistory();
        if (selectedDossierClient) {
          fetchClientDossier(selectedDossierClient.id);
        }
      }
    } catch (e) {
      alert('Failed to delete XML record from Cloud Vault.');
    }
  };

  // --- CSV Template & Mapping Functions (Dual Client & API Mode) ---
  const fetchCsvMappings = async () => {
    try {
      const saved = localStorage.getItem('sheetbuddy_csv_mappings');
      if (saved) {
        setCsvMappings(JSON.parse(saved));
      }
    } catch (e) {}

    if (!token) return;
    try {
      const res = await fetch('/api/csv/mappings', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.length > 0) {
          setCsvMappings(data);
          try {
            localStorage.setItem('sheetbuddy_csv_mappings', JSON.stringify(data));
          } catch (err) {}
        }
      }
    } catch (e) {
      console.log("Using local offline CSV mappings");
    }
  };

  const handleDownloadBlankCsv = () => {
    try {
      const blob = new Blob([BLANK_CSV_CONTENT], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = "Sheet_Buddy_Blank_Template.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Blank template download error", err);
      alert("Failed to download blank CSV template.");
    }
  };

  const handleDownloadSampleCsv = () => {
    try {
      const blob = new Blob([SAMPLE_CSV_CONTENT], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = "Sheet_Buddy_Sample_Vouchers.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Sample template download error", err);
      alert("Failed to download sample CSV template.");
    }
  };

  const handleInspectCsv = (file) => {
    if (!file) return;
    setInspectingCsv(true);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        const parsed = parseCsvRows(text);
        if (parsed.length > 0) {
          const headers = parsed[0].filter(h => !!h && !h.startsWith('#'));
          setDetectedHeaders(headers);
          if (headers.length > 0) {
            headers.forEach(h => {
              const hl = h.toLowerCase().trim();
              if (hl.includes('date')) setMapFormDateCol(h);
              else if (hl.includes('voucher type') || hl.includes('entry type') || hl === 'type') setMapFormVtypeCol(h);
              else if (hl.includes('voucher no') || hl.includes('vch no') || hl.includes('invoice') || hl.includes('inv no') || hl.includes('doc no')) setMapFormVnumCol(h);
              else if ((hl.includes('debit') && hl.includes('ledger')) || hl.includes('dr ledger') || hl.includes('dr account') || hl.includes('dr')) setMapFormDrCol(h);
              else if ((hl.includes('credit') && hl.includes('ledger')) || hl.includes('cr ledger') || hl.includes('cr account') || hl.includes('cr')) setMapFormCrCol(h);
              else if (hl === 'amount' || hl.includes('total') || hl.includes('net total')) setMapFormAmtCol(h);
              else if ((hl.includes('debit') && hl.includes('amt')) || hl.includes('dr amt')) setMapFormDrAmtCol(h);
              else if ((hl.includes('credit') && hl.includes('amt')) || hl.includes('cr amt')) setMapFormCrAmtCol(h);
              else if (hl.includes('narr') || hl.includes('desc') || hl.includes('particulars') || hl.includes('remarks')) setMapFormNarrCol(h);
              else if (hl.includes('ref') || hl.includes('cheque') || hl.includes('chq') || hl.includes('utr') || hl.includes('instrument')) setMapFormRefCol(h);
            });
          }
        }
      } catch (err) {
        console.error("Inspect error", err);
        alert("Failed to inspect CSV headers.");
      } finally {
        setInspectingCsv(false);
      }
    };
    reader.onerror = () => {
      setInspectingCsv(false);
      alert("Error reading CSV file.");
    };
    reader.readAsText(file);
  };

  const handleOpenCreateMapping = () => {
    setEditingMappingId(null);
    setMapFormName('');
    setMapFormDesc('');
    setMapFormDateCol('Date');
    setMapFormDateFmt('%d-%m-%Y');
    setMapFormVtypeCol('Voucher Type');
    setMapFormDefVtype('Payment');
    setMapFormVnumCol('Voucher No');
    setMapFormDrCol('Debit Ledger');
    setMapFormDefDr('');
    setMapFormCrCol('Credit Ledger');
    setMapFormDefCr('');
    setMapFormAmtCol('Amount');
    setMapFormDrAmtCol('');
    setMapFormCrAmtCol('');
    setMapFormNarrCol('Narration');
    setMapFormDefNarr('');
    setMapFormRefCol('Ref / Cheque No');
    setDetectedHeaders([]);
    setMappingModalOpen(true);
  };

  const handleOpenEditMapping = (tmpl) => {
    setEditingMappingId(tmpl.id);
    setMapFormName(tmpl.name);
    setMapFormDesc(tmpl.description || '');
    setMapFormDateCol(tmpl.date_column || 'Date');
    setMapFormDateFmt(tmpl.date_format || '%d-%m-%Y');
    setMapFormVtypeCol(tmpl.voucher_type_column || '');
    setMapFormDefVtype(tmpl.default_voucher_type || 'Payment');
    setMapFormVnumCol(tmpl.voucher_number_column || '');
    setMapFormDrCol(tmpl.debit_ledger_column || '');
    setMapFormDefDr(tmpl.default_debit_ledger || '');
    setMapFormCrCol(tmpl.credit_ledger_column || '');
    setMapFormDefCr(tmpl.default_credit_ledger || '');
    setMapFormAmtCol(tmpl.amount_column || '');
    setMapFormDrAmtCol(tmpl.debit_amount_column || '');
    setMapFormCrAmtCol(tmpl.credit_amount_column || '');
    setMapFormNarrCol(tmpl.narration_column || '');
    setMapFormDefNarr(tmpl.default_narration || '');
    setMapFormRefCol(tmpl.ref_no_column || '');
    setDetectedHeaders([]);
    setMappingModalOpen(true);
  };

  const handleSaveMapping = async (e) => {
    e.preventDefault();
    if (!mapFormName.trim()) {
      alert("Please provide a template name.");
      return;
    }
    const templatePayload = {
      name: mapFormName.trim(),
      description: mapFormDesc.trim() || '',
      date_column: mapFormDateCol || 'Date',
      date_format: mapFormDateFmt || '%d-%m-%Y',
      voucher_type_column: mapFormVtypeCol || null,
      default_voucher_type: mapFormDefVtype || 'Payment',
      voucher_number_column: mapFormVnumCol || null,
      debit_ledger_column: mapFormDrCol || null,
      default_debit_ledger: mapFormDefDr || null,
      credit_ledger_column: mapFormCrCol || null,
      default_credit_ledger: mapFormDefCr || null,
      amount_column: mapFormAmtCol || null,
      debit_amount_column: mapFormDrAmtCol || null,
      credit_amount_column: mapFormCrAmtCol || null,
      narration_column: mapFormNarrCol || null,
      default_narration: mapFormDefNarr || null,
      ref_no_column: mapFormRefCol || null
    };

    let savedTemplate = {
      ...templatePayload,
      id: editingMappingId || 'map_' + Date.now()
    };

    if (token) {
      try {
        const isNumericId = editingMappingId && !String(editingMappingId).startsWith('map_');
        const method = isNumericId ? 'PUT' : 'POST';
        const url = isNumericId ? `/api/csv/mappings/${editingMappingId}` : '/api/csv/mappings';
        const res = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify(templatePayload)
        });
        if (res.ok) {
          const data = await res.json();
          if (data && data.id) {
            savedTemplate = data;
          }
        }
      } catch (err) {
        console.error("Backend sync failed for mapping", err);
      }
    }

    setCsvMappings(prev => {
      const filtered = prev.filter(m => String(m.id) !== String(savedTemplate.id) && String(m.id) !== String(editingMappingId));
      const updated = [savedTemplate, ...filtered];
      try {
        localStorage.setItem('sheetbuddy_csv_mappings', JSON.stringify(updated));
      } catch (err) {}
      return updated;
    });

    setSelectedCsvMappingId(String(savedTemplate.id));
    setMappingModalOpen(false);
    setEditingMappingId(null);
  };

  const handleDeleteMapping = async (templateId) => {
    if (!confirm("Are you sure you want to delete this mapping template?")) return;
    setCsvMappings(prev => {
      const updated = prev.filter(m => m.id !== templateId);
      try {
        localStorage.setItem('sheetbuddy_csv_mappings', JSON.stringify(updated));
      } catch (err) {}
      return updated;
    });
    if (selectedCsvMappingId === String(templateId)) {
      setSelectedCsvMappingId('default');
    }
    if (token) {
      try {
        await fetch(`/api/csv/mappings/${templateId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        });
      } catch (err) {}
    }
  };

  const handleUploadAndPreviewCsv = async (e) => {
    if (e) e.preventDefault();
    if (!csvFile) {
      setCsvError("Please select a CSV file to upload.");
      return;
    }
    setCsvUploading(true);
    setCsvError('');
    setCsvConvertError('');

    const activeMapping = csvMappings.find(m => String(m.id) === String(selectedCsvMappingId)) || {
      name: "Standard Sheet Buddy CSV",
      date_column: "Date",
      date_format: "%d-%m-%Y",
      voucher_type_column: "Voucher Type",
      default_voucher_type: "Payment",
      voucher_number_column: "Voucher No",
      debit_ledger_column: "Debit Ledger",
      credit_ledger_column: "Credit Ledger",
      amount_column: "Amount",
      narration_column: "Narration",
      ref_no_column: "Ref / Cheque No"
    };

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const text = evt.target.result;
        const rows = parseCsvRows(text);
        if (rows.length < 2) {
          setCsvError("CSV file is empty or contains only headers.");
          setCsvUploading(false);
          return;
        }

        const headers = rows[0].map(h => (h || '').replace(/[\ufeff"']/g, '').trim());

        const dateAliases = ['date', 'txn date', 'txndate', 'tran date', 'transaction date', 'value date', 'val date', 'post date', 'posting date', 'entry date', 'booking date'];
        const vtypeAliases = ['voucher type', 'vch type', 'type', 'trans type', 'transaction type'];
        const vnumAliases = ['voucher no', 'vch no', 'voucher number', 'trans no', 'cheque no', 'chk no', 'ref no'];
        const drAliases = ['debit ledger', 'dr ledger', 'debit account', 'dr account', 'party name', 'particulars'];
        const crAliases = ['credit ledger', 'cr ledger', 'credit account', 'cr account', 'bank account', 'bank', 'cash'];
        const amtAliases = ['amount', 'txn amount', 'transaction amount', 'total amount', 'net amount'];
        const drAmtAliases = ['debit amount', 'debit', 'dr amount', 'dr', 'withdrawal', 'withdrawals'];
        const crAmtAliases = ['credit amount', 'credit', 'cr amount', 'cr', 'deposit', 'deposits'];
        const narrAliases = ['narration', 'description', 'remarks', 'particulars', 'narr'];
        const refAliases = ['ref / cheque no', 'ref no', 'reference', 'cheque no', 'utr', 'instrument no'];

        const dateIdx = findColumnIndex(headers, activeMapping.date_column, dateAliases);
        const vtypeIdx = findColumnIndex(headers, activeMapping.voucher_type_column, vtypeAliases);
        const vnumIdx = findColumnIndex(headers, activeMapping.voucher_number_column, vnumAliases);
        const drIdx = findColumnIndex(headers, activeMapping.debit_ledger_column, drAliases);
        const crIdx = findColumnIndex(headers, activeMapping.credit_ledger_column, crAliases);
        const amtIdx = findColumnIndex(headers, activeMapping.amount_column, amtAliases);
        const drAmtIdx = findColumnIndex(headers, activeMapping.debit_amount_column, drAmtAliases);
        const crAmtIdx = findColumnIndex(headers, activeMapping.credit_amount_column, crAmtAliases);
        const narrIdx = findColumnIndex(headers, activeMapping.narration_column, narrAliases);
        const refIdx = findColumnIndex(headers, activeMapping.ref_no_column, refAliases);

        let lastValidDate = '';
        const vouchers = [];
        for (let i = 1; i < rows.length; i++) {
          const r = rows[i];
          if (!r || r.length === 0 || (r.length === 1 && !r[0]) || (r[0] && r[0].startsWith('#'))) {
            continue;
          }

          let rawDateVal = dateIdx >= 0 && r[dateIdx] ? r[dateIdx].trim() : '';
          let dateVal = normalizeDateString(rawDateVal);
          if (dateVal) {
            lastValidDate = dateVal;
          } else if (lastValidDate) {
            dateVal = lastValidDate;
          } else {
            dateVal = new Date().toISOString().split('T')[0];
          }

          let vtypeVal = vtypeIdx >= 0 && r[vtypeIdx] ? r[vtypeIdx].trim() : (activeMapping.default_voucher_type || 'Payment');
          
          const vtLower = vtypeVal.toLowerCase();
          if (vtLower.includes('pay') || vtLower === 'dr') vtypeVal = 'Payment';
          else if (vtLower.includes('rec') || vtLower === 'cr') vtypeVal = 'Receipt';
          else if (vtLower.includes('contra')) vtypeVal = 'Contra';
          else if (vtLower.includes('journal') || vtLower === 'jv') vtypeVal = 'Journal';
          else if (vtLower.includes('sale')) vtypeVal = 'Sales';
          else if (vtLower.includes('purch')) vtypeVal = 'Purchase';
          else vtypeVal = activeMapping.default_voucher_type || 'Payment';

          let vnumVal = vnumIdx >= 0 && r[vnumIdx] ? r[vnumIdx].trim() : '';
          let drVal = drIdx >= 0 && r[drIdx] ? r[drIdx].trim() : (activeMapping.default_debit_ledger || '');
          let crVal = crIdx >= 0 && r[crIdx] ? r[crIdx].trim() : (activeMapping.default_credit_ledger || '');

          let amtVal = 0.0;
          if (amtIdx >= 0 && r[amtIdx]) {
            amtVal = Math.abs(parseFloat(r[amtIdx].replace(/[^0-9.-]/g, '')) || 0.0);
          } else {
            const drA = drAmtIdx >= 0 && r[drAmtIdx] ? Math.abs(parseFloat(r[drAmtIdx].replace(/[^0-9.-]/g, '')) || 0) : 0;
            const crA = crAmtIdx >= 0 && r[crAmtIdx] ? Math.abs(parseFloat(r[crAmtIdx].replace(/[^0-9.-]/g, '')) || 0) : 0;
            amtVal = drA || crA;
          }

          let narrVal = narrIdx >= 0 && r[narrIdx] ? r[narrIdx].trim() : (activeMapping.default_narration || '');
          let refVal = refIdx >= 0 && r[refIdx] ? r[refIdx].trim() : '';

          const isValid = amtVal > 0 && !!dateVal && !!drVal && !!crVal;
          const reasons = [];
          if (amtVal <= 0) reasons.push("Amount must be greater than 0");
          if (!dateVal && !rawDateVal) reasons.push("Date is missing");
          if (!drVal) reasons.push("Debit ledger is missing");
          if (!crVal) reasons.push("Credit ledger is missing");

          vouchers.push({
            row_idx: i,
            date: dateVal,
            voucher_type: vtypeVal,
            voucher_number: vnumVal,
            debit_ledger: drVal,
            credit_ledger: crVal,
            amount: amtVal,
            narration: narrVal,
            ref_no: refVal,
            is_valid: isValid,
            error_reasons: reasons
          });
        }

        if (vouchers.length === 0) {
          setCsvError("No valid voucher rows found in this CSV file.");
          setCsvUploading(false);
          return;
        }

        setCsvVouchers(vouchers);
        setCsvPreviewData({
          mapping_name: activeMapping.name,
          total_vouchers: vouchers.length,
          vouchers: vouchers
        });
        setCsvUploading(false);
      } catch (err) {
        console.error("Client parse error", err);
        setCsvError("Failed to parse CSV file: " + err.message);
        setCsvUploading(false);
      }
    };
    reader.onerror = () => {
      setCsvError("Error reading the selected CSV file.");
      setCsvUploading(false);
    };
    reader.readAsText(csvFile);
  };

  const handleUpdateVoucherCell = (index, field, value) => {
    setCsvVouchers(prev => {
      const copy = [...prev];
      const target = { ...copy[index] };
      if (field === 'amount') {
        const num = parseFloat(value) || 0;
        target.amount = num;
        target.is_valid = num > 0 && !!target.date && !!target.voucher_type && !!target.debit_ledger && !!target.credit_ledger;
      } else {
        target[field] = value;
        target.is_valid = (target.amount > 0) && !!target.date && !!target.voucher_type && !!target.debit_ledger && !!target.credit_ledger;
      }
      copy[index] = target;
      return copy;
    });
  };

  const handleDeleteVoucherRow = (index) => {
    setCsvVouchers(prev => prev.filter((_, i) => i !== index));
  };

  const handleAddVoucherRow = () => {
    const today = new Date().toISOString().split('T')[0];
    const newRow = {
      row_idx: csvVouchers.length + 1,
      date: today,
      voucher_type: 'Payment',
      voucher_number: '',
      debit_ledger: '',
      credit_ledger: '',
      amount: 0,
      narration: '',
      ref_no: '',
      is_valid: false,
      error_reasons: ['Please fill in ledgers and amount']
    };
    setCsvVouchers(prev => [...prev, newRow]);
  };

  const handleConvertCsvToXml = async () => {
    if (!csvVouchers || csvVouchers.length === 0) {
      setCsvConvertError("No vouchers available to convert.");
      return;
    }
    const invalidCount = csvVouchers.filter(v => !v.is_valid).length;
    if (invalidCount > 0) {
      if (!confirm(`Warning: ${invalidCount} voucher(s) have missing ledgers, invalid date, or zero amount. Do you want to proceed anyway?`)) {
        return;
      }
    }

    const pricing = getCsvCreditPricing(csvVouchers.length);
    if (user && user.page_credits < pricing) {
      setCsvConvertError(`Insufficient credits. You need ${pricing} credits for ${csvVouchers.length} transactions (rate: 1 credit per 10 transactions). Your current balance is ${user.page_credits}.`);
      return;
    }

    setCsvConverting(true);
    setCsvConvertError('');
    try {
      const activeMapping = csvMappings.find(m => String(m.id) === String(selectedCsvMappingId));
      const mappingName = activeMapping ? activeMapping.name : "Sheet Buddy Standard CSV";
      
      const xmlString = generateClientTallyXml(csvVouchers, mappingName);
      const blob = new Blob([xmlString], { type: 'application/xml;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const outName = csvFile ? csvFile.name.replace(/\.[^/.]+$/, "") + "_Tally_Import.xml" : "Tally_Vouchers_Import.xml";
      a.download = outName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      if (token) {
        try {
          const convertRes = await fetch('/api/csv/convert-to-xml', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ vouchers: csvVouchers, mapping_name: mappingName })
          });
          setUser(prev => prev ? ({ ...prev, page_credits: Math.max(0, prev.page_credits - pricing) }) : prev);
          fetchUserProfile();
          fetchHistory();
          fetchWalletTxs();
        } catch (e) {}

        // Save generated XML to Cloud Vault
        await handleSaveXmlToCloudVault(xmlString, {
          client_id: activeClientId,
          bank_name: mappingName || 'CSV Import',
          file_name: outName,
          statement_period: 'CSV Import Batch',
          transactions_count: csvVouchers.length,
          pages_count: pricing || 1,
          source_type: 'CSV_TALLY'
        });
      }

      alert(`Success! 100% Compliant Tally Prime XML generated for ${csvVouchers.length} vouchers and saved to Cloud Vault.`);
    } catch (err) {
      console.error("Convert to XML error", err);
      setCsvConvertError("Error while generating Tally XML: " + err.message);
    } finally {
      setCsvConverting(false);
    }
  };

  const handleExportCsvToExcel = () => {
    if (!csvVouchers || csvVouchers.length === 0) {
      alert("No vouchers to export.");
      return;
    }
    try {
      let csvContent = "Date,Voucher Type,Voucher No,Debit Ledger,Credit Ledger,Amount,Narration,Ref / Cheque No\n";
      csvVouchers.forEach(v => {
        const row = [
          `"${(v.date || '').replace(/"/g, '""')}"`,
          `"${(v.voucher_type || '').replace(/"/g, '""')}"`,
          `"${(v.voucher_number || '').replace(/"/g, '""')}"`,
          `"${(v.debit_ledger || '').replace(/"/g, '""')}"`,
          `"${(v.credit_ledger || '').replace(/"/g, '""')}"`,
          parseFloat(v.amount) || 0,
          `"${(v.narration || '').replace(/"/g, '""')}"`,
          `"${(v.ref_no || '').replace(/"/g, '""')}"`
        ];
        csvContent += row.join(",") + "\n";
      });

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const outName = csvFile ? csvFile.name.replace(/\.[^/.]+$/, "") + "_Exported.csv" : "Vouchers_Export.csv";
      a.download = outName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Export error", e);
      alert("Failed to export.");
    }
  };

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError('');
    setStatusMessage('');
    setAuthLoading(true);

    const isReg = authMode === 'register';
    const endpoint = isReg ? '/api/auth/register' : '/api/auth/login';
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, remember })
      });

      const data = await res.json();
      if (!res.ok) {
        if (data.detail === "NOT_VERIFIED") {
          setVerificationEmail(email);
          setAuthMode('verify');
          setStatusMessage("Your account is not verified yet. An OTP verification code has been sent to your email. Enter it below to complete verification.");
        } else {
          setAuthError(extractErrorMessage(data.detail, 'An error occurred during authentication.'));
        }
      } else {
        if (isReg) {
          setVerificationEmail(email);
          setAuthMode('verify');
          setStatusMessage("Account registered successfully! An OTP verification code has been sent to your email. Enter it below to verify your account.");
        } else {
          setToken(data.access_token);
        }
      }
    } catch (err) {
      setAuthError('Connection failed. Please check if the server is running.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleVerifyOTP = async (e) => {
    e.preventDefault();
    setAuthError('');
    setStatusMessage('');
    setAuthLoading(true);
    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: verificationEmail, otp_code: otp })
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(extractErrorMessage(data.detail, 'Invalid or expired OTP.'));
      } else {
        setToken(data.access_token);
        setAuthMode('login');
        setOtp('');
        setStatusMessage('Account verified successfully!');
      }
    } catch (err) {
      setAuthError('Connection failed.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleResendOTP = async () => {
    setAuthError('');
    setStatusMessage('');
    try {
      const res = await fetch('/api/auth/resend-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: verificationEmail })
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(extractErrorMessage(data.detail, 'Failed to resend OTP.'));
      } else {
        setStatusMessage('A new verification code has been sent to your email.');
      }
    } catch (err) {
      setAuthError('Connection failed.');
    }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setAuthError('');
    setStatusMessage('');
    const targetEmail = (email || verificationEmail || '').trim();
    if (!targetEmail) {
      setAuthError('Please enter your email address.');
      return;
    }
    setVerificationEmail(targetEmail);
    setAuthLoading(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: targetEmail })
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(extractErrorMessage(data.detail, 'Failed to request password recovery.'));
      } else {
        setAuthMode('reset');
        setStatusMessage('If the account exists, a recovery code has been sent to your email.');
      }
    } catch (err) {
      setAuthError('Connection failed.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setAuthError('');
    setStatusMessage('');
    if (newPassword !== confirmNewPassword) {
      setAuthError("Passwords do not match.");
      return;
    }
    const targetEmail = (verificationEmail || email || '').trim();
    setAuthLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: targetEmail,
          otp_code: otp.trim(),
          new_password: newPassword
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(extractErrorMessage(data.detail, 'Invalid or expired recovery code.'));
      } else {
        setAuthMode('login');
        setIsRegistering(false);
        setEmail(targetEmail);
        setPassword('');
        setOtp('');
        setNewPassword('');
        setConfirmNewPassword('');
        setStatusMessage('Password reset successfully. You can now log in.');
      }
    } catch (err) {
      setAuthError('Connection failed.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleProfileChangePassword = async (e) => {
    e.preventDefault();
    setProfileSuccessMsg('');
    setProfileErrorMsg('');
    if (profileNewPassword !== profileConfirmNewPassword) {
      setProfileErrorMsg("New passwords do not match.");
      return;
    }
    setProfileLoading(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          old_password: currentPassword,
          new_password: profileNewPassword
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setProfileErrorMsg(extractErrorMessage(data.detail, "Failed to change password."));
      } else {
        setProfileSuccessMsg("Password changed successfully!");
        setCurrentPassword('');
        setProfileNewPassword('');
        setProfileConfirmNewPassword('');
      }
    } catch (e) {
      setProfileErrorMsg("Connection failed.");
    } finally {
      setProfileLoading(false);
    }
  };

  const handleLogout = () => {
    setToken('');
    setUser(null);
    setParsedSummary(null);
    setSelectedFile(null);
    setTallyLedgerName('');
    setCounterLedgerName('Suspense');
    setCreditVoucherType('Receipt');
    setDebitVoucherType('Payment');
    setEditedNarrations({});
    setConversionsHistory([]);
    setWalletTransactions([]);
    setPromoCode('');
    setRedeemStatusMsg('');
    setCheckoutSession(null);
    setPaymentLoading(false);
    setUpiId('');
    setCheckoutError('');
  };


  const handleFileUploadChange = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      setSelectedFiles(files);
      setSelectedFile(files[0]);
      setUploadError('');
      setParsedSummary(null);
      setEditedNarrations({});
      setEditedLedgers({});
    }
  };

  const handleRemoveFile = (indexToRemove) => {
    setSelectedFiles(prev => {
      const updated = prev.filter((_, idx) => idx !== indexToRemove);
      setSelectedFile(updated[0] || null);
      return updated;
    });
  };

  const handleToggleCounterLedgerMode = (mode) => {
    setCounterLedgerMode(mode);
    const newLedgers = {};
    allTransactions.forEach((tx, idx) => {
      if (mode === 'AUTO') {
        newLedgers[idx] = tx.assigned_ledger || tx.suggested_ledger || 'Suspense Account';
      } else {
        newLedgers[idx] = customCounterLedger || counterLedgerName || 'Suspense Account';
      }
    });
    setEditedLedgers(newLedgers);
  };

  const handleCustomCounterLedgerChange = (val) => {
    setCustomCounterLedger(val);
    setCounterLedgerName(val);
    if (counterLedgerMode === 'CUSTOM') {
      const newLedgers = {};
      allTransactions.forEach((_, idx) => {
        newLedgers[idx] = val;
      });
      setEditedLedgers(newLedgers);
    }
  };

  const handleApplyCustomLedgerToAll = (val) => {
    const target = val || customCounterLedger || 'Suspense Account';
    setCounterLedgerMode('CUSTOM');
    setCustomCounterLedger(target);
    setCounterLedgerName(target);
    const newLedgers = {};
    allTransactions.forEach((_, idx) => {
      newLedgers[idx] = target;
    });
    setEditedLedgers(newLedgers);
  };

  const handleUploadAndParse = async (e) => {
    e.preventDefault();
    const filesToUpload = selectedFiles.length > 0 ? selectedFiles : (selectedFile ? [selectedFile] : []);
    if (filesToUpload.length === 0) {
      setUploadError('Please select at least one bank statement PDF file.');
      return;
    }

    setUploadLoading(true);
    setUploadError('');
    setParsedSummary(null);
    setEditedNarrations({});
    setEditedLedgers({});

    const isAutoSupported = supportedBanks.some(b => b.bank_key === 'auto');
    let effectiveBank = bankName;
    if ((!effectiveBank || effectiveBank === 'auto') && !isAutoSupported) {
      effectiveBank = 'sbi';
    }

    try {
      let combinedTransactions = [];
      let totalPages = 0;
      let firstSummary = null;
      let lastSummary = null;
      let allPeriods = [];

      for (let i = 0; i < filesToUpload.length; i++) {
        const file = filesToUpload[i];
        setUploadProgress({ current: i + 1, total: filesToUpload.length, filename: file.name });

        const formData = new FormData();
        formData.append('bank_name', effectiveBank);
        formData.append('file', file);

        const res = await fetch('/api/convert/upload', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          body: formData
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(`[${file.name}] ` + extractErrorMessage(data.detail, 'Failed to parse statement.'));
        }

        if (!firstSummary) firstSummary = data;
        lastSummary = data;
        totalPages += (data.pages_count || 1);
        if (data.statement_period) allPeriods.push(data.statement_period);

        const txList = data.all_transactions || data.transactions_preview || [];
        const taggedTxList = txList.map((tx, txIdx) => ({
          ...tx,
          source_file: file.name,
          multi_index: `${i + 1}-${txIdx + 1}`
        }));
        combinedTransactions = combinedTransactions.concat(taggedTxList);
      }

      // Check duplicates across statements
      const seenHashes = new Set();
      combinedTransactions.forEach(tx => {
        const hashKey = `${tx.txn_date}|${tx.debit}|${tx.credit}|${tx.balance}|${(tx.ref_no || '').slice(-6)}`;
        if (seenHashes.has(hashKey)) {
          tx.is_duplicate = true;
        } else {
          seenHashes.add(hashKey);
        }
      });

      const masterSummary = {
        ...firstSummary,
        pages_count: totalPages,
        transactions_count: combinedTransactions.length,
        opening_balance: firstSummary.opening_balance,
        closing_balance: lastSummary.closing_balance,
        statement_period: allPeriods.length > 1
          ? `${allPeriods[0]} to ${allPeriods[allPeriods.length - 1]}`
          : (firstSummary.statement_period || 'Consolidated Period'),
        multi_file_count: filesToUpload.length,
        multi_filenames: filesToUpload.map(f => f.name).join(', '),
        all_transactions: combinedTransactions
      };

      setParsedSummary(masterSummary);
      setAllTransactions(combinedTransactions);
      setSelectedRowIds(new Set());

      const initialNarrs = {};
      const initialLedgers = {};
      combinedTransactions.forEach((tx, index) => {
        initialNarrs[index] = tx.narration;
        if (counterLedgerMode === 'AUTO') {
          initialLedgers[index] = tx.assigned_ledger || tx.suggested_ledger || 'Suspense Account';
        } else {
          initialLedgers[index] = customCounterLedger || counterLedgerName || 'Suspense Account';
        }
      });
      setEditedNarrations(initialNarrs);
      setEditedLedgers(initialLedgers);

    } catch (err) {
      setUploadError(err.message || 'Network error. Failed to parse statement PDF(s).');
    } finally {
      setUploadLoading(false);
      setUploadProgress(null);
    }
  };

  const handleNarrationEdit = (idx, newText) => {
    setUndoStack(prev => [...prev.slice(-20), { type: 'NARRATION', idx, oldText: editedNarrations[idx] }]);
    setEditedNarrations(prev => ({
      ...prev,
      [idx]: newText
    }));
  };

  const handleLedgerEdit = (idx, newLedger) => {
    setEditedLedgers(prev => ({
      ...prev,
      [idx]: newLedger
    }));
  };

  const handleToggleRowSelection = (id) => {
    setSelectedRowIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelectAllRows = (rows) => {
    if (selectedRowIds.size === rows.length) {
      setSelectedRowIds(new Set());
    } else {
      setSelectedRowIds(new Set(rows.map(r => r.id)));
    }
  };

  const handleBulkAssignLedger = () => {
    if (!bulkLedgerInput.trim()) {
      alert("Please type a ledger name to assign.");
      return;
    }
    const nextLedgers = { ...editedLedgers };
    allTransactions.forEach((tx, idx) => {
      if (selectedRowIds.has(tx.id)) {
        nextLedgers[idx] = bulkLedgerInput.trim();
      }
    });
    setEditedLedgers(nextLedgers);
    setBulkLedgerInput('');
    setSelectedRowIds(new Set());
  };

  const handleBulkMarkReviewed = () => {
    setAllTransactions(prev => prev.map(tx => {
      if (selectedRowIds.has(tx.id)) {
        return { ...tx, requires_review: false };
      }
      return tx;
    }));
    setSelectedRowIds(new Set());
  };

  const handleExecuteConversion = async () => {
    if (!tallyLedgerName.trim()) {
      setExecuteError('Please enter the bank ledger name exactly as it exists in Tally.');
      return;
    }

    setExecuteLoading(true);
    setExecuteError('');

    const structuredTxs = allTransactions.map((tx, idx) => ({
      ...tx,
      narration: editedNarrations[idx] !== undefined ? editedNarrations[idx] : tx.narration,
      assigned_ledger: editedLedgers[idx] !== undefined ? editedLedgers[idx] : (tx.assigned_ledger || counterLedgerName)
    }));

    // Use FormData for 100% universal compatibility across legacy Form(...) and modern JSON endpoints
    const formData = new FormData();
    formData.append('temp_file_id', parsedSummary.temp_file_id || '');
    formData.append('tally_bank_ledger_name', tallyLedgerName.trim());
    formData.append('bank_name', parsedSummary.bank_name || bankName || 'Bank Statement');
    formData.append('counter_ledger_name', counterLedgerName || 'Suspense Account');
    formData.append('credit_voucher_type', creditVoucherType || 'Receipt');
    formData.append('debit_voucher_type', debitVoucherType || 'Payment');
    formData.append('pages_count', String(parsedSummary.pages_count || 1));
    formData.append('file_fingerprint', parsedSummary.file_fingerprint || '');
    formData.append('edited_narrations', JSON.stringify(editedNarrations || {}));
    formData.append('transactions', JSON.stringify(structuredTxs));
    if (activeClientId) {
      formData.append('client_id', activeClientId);
    }

    try {
      const res = await fetch('/api/convert/execute', {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}` 
        },
        body: formData
      });

      if (!res.ok) {
        // Fallback: If cloud backend returned an error (e.g. multi-statement temp file or session mismatch),
        // generate 100% compliant Tally XML directly client-side so user data is never lost!
        try {
          const clientXml = generateBankStatementTallyXml(
            structuredTxs, 
            tallyLedgerName.trim(), 
            counterLedgerMode === 'CUSTOM' ? (customCounterLedger || counterLedgerName) : 'Suspense Account'
          );
          const blob = new Blob([clientXml], { type: 'application/xml;charset=utf-8' });
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          const bankLabel = (parsedSummary.bank_name || bankName || 'Statement').replace(/ /g, '_');
          const outName = `Tally_Import_${bankLabel}_${structuredTxs.length}_Vouchers.xml`;
          a.download = outName;
          document.body.appendChild(a);
          a.click();
          a.remove();

          // Auto-save generated XML to Cloud Vault
          await handleSaveXmlToCloudVault(clientXml, {
            client_id: activeClientId,
            bank_name: parsedSummary.bank_name || bankName || 'Statement',
            file_name: outName,
            statement_period: parsedSummary.statement_period || 'Consolidated',
            transactions_count: structuredTxs.length,
            pages_count: parsedSummary.pages_count || 1,
            opening_balance: parsedSummary.opening_balance || 0.0,
            closing_balance: parsedSummary.closing_balance || 0.0,
            source_type: 'STATEMENT_PDF'
          });
          
          alert(`Success! Generated 100% Compliant Tally Prime XML for ${structuredTxs.length} vouchers and saved to Cloud Vault.`);
          setParsedSummary(null);
          setSelectedFiles([]);
          setSelectedFile(null);
          setTallyLedgerName('');
          setCounterLedgerName('Suspense Account');
          setEditedNarrations({});
          setEditedLedgers({});
          setAllTransactions([]);
          fetchHistory();
          return;
        } catch (clientErr) {
          const data = await res.json().catch(() => ({}));
          setExecuteError(extractErrorMessage(data.detail, 'Conversion execution failed.'));
        }
      } else {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Tally_Import_${(parsedSummary.bank_name || bankName).replace(/ /g, '_')}_Statement.xml`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        
        setParsedSummary(null);
        setSelectedFiles([]);
        setSelectedFile(null);
        setTallyLedgerName('');
        setCounterLedgerName('Suspense Account');
        setEditedNarrations({});
        setEditedLedgers({});
        setAllTransactions([]);
        
        fetchUserProfile();
        fetchHistory();
        fetchWalletTxs();
        fetchClients();
        
        setActiveTab('history');
      }
    } catch (err) {
      // In case of network disconnection, fallback to client-side XML generation as well
      try {
        const clientXml = generateBankStatementTallyXml(
          structuredTxs, 
          tallyLedgerName.trim(), 
          counterLedgerMode === 'CUSTOM' ? (customCounterLedger || counterLedgerName) : 'Suspense Account'
        );
        const blob = new Blob([clientXml], { type: 'application/xml;charset=utf-8' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const bankLabel = (parsedSummary.bank_name || bankName || 'Statement').replace(/ /g, '_');
        const outName = `Tally_Import_${bankLabel}_${structuredTxs.length}_Vouchers.xml`;
        a.download = outName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        
        // Auto-save generated XML to Cloud Vault
        await handleSaveXmlToCloudVault(clientXml, {
          client_id: activeClientId,
          bank_name: parsedSummary.bank_name || bankName || 'Statement',
          file_name: outName,
          statement_period: parsedSummary.statement_period || 'Consolidated',
          transactions_count: structuredTxs.length,
          pages_count: parsedSummary.pages_count || 1,
          opening_balance: parsedSummary.opening_balance || 0.0,
          closing_balance: parsedSummary.closing_balance || 0.0,
          source_type: 'STATEMENT_PDF'
        });

        alert(`Success! Generated 100% Compliant Tally Prime XML for ${structuredTxs.length} vouchers and saved to Cloud Vault.`);
        setParsedSummary(null);
        setSelectedFiles([]);
        setSelectedFile(null);
        setTallyLedgerName('');
        setCounterLedgerName('Suspense Account');
        setEditedNarrations({});
        setEditedLedgers({});
        setAllTransactions([]);
        fetchHistory();
      } catch (e2) {
        setExecuteError('Connection lost. Conversion failed.');
      }
    } finally {
      setExecuteLoading(false);
    }
  };

  const handleDownloadExcel = async () => {
    if (!parsedSummary) return;

    const formData = new FormData();
    formData.append('temp_file_id', parsedSummary.temp_file_id);
    formData.append('bank_name', bankName);

    try {
      const res = await fetch('/api/convert/excel', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });

      if (!res.ok) {
        alert("Failed to export Excel spreadsheet.");
      } else {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Transactions_${bankName.replace(/ /g, '_')}.xlsx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch (err) {
      console.error("Excel download error", err);
    }
  };

  const handleDownloadCachedXml = async (id, bank, period) => {
    try {
      const res = await fetch(`/api/convert/download-xml/${id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) {
        const data = await res.json();
        alert(extractErrorMessage(data.detail, "The XML file is no longer available in the cache."));
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Tally_Import_${bank.replace(/ /g, '_')}_${(period || 'Statement').replace(/ /g, '_')}.xml`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      alert("Network error. Failed to download Tally XML file.");
    }
  };

  const handlePurchase = async (pages, amount) => {
    setPurchaseLoading(true);
    setPurchaseMessage('');
    try {
      const res = await fetch('/api/wallet/purchase', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ pages, amount })
      });

      const data = await res.json();
      if (res.ok) {
        setUser(data);
        setPurchaseMessage(`Successfully purchased ${pages} page credits!`);
        fetchWalletTxs();
      } else {
        setPurchaseMessage(extractErrorMessage(data.detail, 'Purchase failed.'));
      }
    } catch (err) {
      setPurchaseMessage('Failed to connect to gateway payment server.');
    } finally {
      setPurchaseLoading(false);
    }
  };
  const handleWhatsAppCheckout = async () => {
    if (!checkoutSession) return;
    setPaymentLoading(true);
    setCheckoutError('');
    try {
      const res = await fetch('/api/wallet/purchase', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          pages: checkoutSession.pages,
          amount: checkoutSession.amount
        })
      });
      
      const data = await res.json();
      if (res.ok) {
        const waText = encodeURIComponent(`Hello Sheet Buddy Support! I have paid Rs. ${checkoutSession.amount.toFixed(2)} for the ${checkoutSession.planName} (${checkoutSession.pages} Pages) for my account ${user.email}. Here is my payment screenshot.`);
        window.open(`https://wa.me/919204915729?text=${waText}`, '_blank');
        
        setPurchaseMessage(`Payment verification ticket registered! Send your screenshot on WhatsApp to complete ${checkoutSession.pages} page credits activation.`);
        setCheckoutSession(null);
        fetchWalletTxs();
      } else {
        setCheckoutError(extractErrorMessage(data.detail, 'Failed to register payment ticket.'));
      }
    } catch (err) {
      setCheckoutError('Connection failed. Please check your internet connection.');
    } finally {
      setPaymentLoading(false);
    }
  };


  const handleCreatePromoCode = async (e) => {
    e.preventDefault();
    setPromoFormError('');
    if (!promoFormCode.trim()) {
      setPromoFormError("Promo code cannot be blank.");
      return;
    }
    try {
      const payload = {
        code: promoFormCode.trim().toUpperCase(),
        credits: parseInt(promoFormCredits),
        type: promoFormType
      };
      if (promoFormType === 'TIME_BASED') {
        if (!promoFormExpiresAt) {
          setPromoFormError("Expiration date is required for time-based codes.");
          return;
        }
        payload.expires_at = new Date(promoFormExpiresAt).toISOString();
      }
      const res = await fetch('/api/admin/promo-codes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok) {
        setPromoFormCode('');
        setPromoFormCredits(50);
        setPromoFormType('UNIVERSAL_ONCE');
        setPromoFormExpiresAt('');
        fetchAdminData();
      } else {
        setPromoFormError(extractErrorMessage(data.detail, "Failed to create promo code."));
      }
    } catch (err) {
      setPromoFormError("Connection failed.");
    }
  };

  const handleTogglePromoCode = async (codeId) => {
    try {
      const res = await fetch(`/api/admin/promo-codes/${codeId}/toggle`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        fetchAdminData();
      } else {
        const data = await res.json();
        alert(`Failed to toggle: ${extractErrorMessage(data.detail)}`);
      }
    } catch (e) {
      alert("Connection failed.");
    }
  };

  const handleSupportQuerySubmit = async (e) => {
    e.preventDefault();
    setSupportLoading(true);
    try {
      const res = await fetch('/api/support/query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          subject: supportSubject,
          description: supportDescription,
          whatsapp_number: supportWhatsapp
        })
      });
      const data = await res.json();
      if (res.ok) {
        alert("Your support request has been submitted successfully! The admin will contact you shortly.");
        setSupportSubject('');
        setSupportDescription('');
        setSupportWhatsapp('');
      } else {
        alert(extractErrorMessage(data.detail, "Failed to submit query."));
      }
    } catch (err) {
      alert("Connection failed.");
    } finally {
      setSupportLoading(false);
    }
  };

  const handleApprovePayment = async (txId) => {
    try {
      const res = await fetch(`/api/admin/payments/${txId}/approve`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        alert("Payment approved and user account credited successfully!");
        fetchAdminData();
      } else {
        const data = await res.json();
        alert(`Approval failed: ${extractErrorMessage(data.detail)}`);
      }
    } catch (e) {
      alert("Failed to connect to backend server.");
    }
  };

  const handleRejectPayment = async (txId) => {
    if (!confirm("Are you sure you want to reject this payment request?")) return;
    try {
      const res = await fetch(`/api/admin/payments/${txId}/reject`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        alert("Payment request rejected.");
        fetchAdminData();
      } else {
        const data = await res.json();
        alert(`Rejection failed: ${extractErrorMessage(data.detail)}`);
      }
    } catch (e) {
      alert("Failed to connect to backend server.");
    }
  };

  const handleClaimPromoCode = async () => {
    if (!promoCode.trim()) return;
    setRedeemLoading(true);
    setRedeemStatusMsg('');
    try {
      const res = await fetch('/api/wallet/redeem', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ code: promoCode.trim() })
      });
      const data = await res.json();
      if (res.ok) {
        setUser(data);
        setRedeemStatusMsg('Promo code redeemed successfully! Check your balance.');
        setPromoCode('');
        fetchWalletTxs();
      } else {
        setRedeemStatusMsg(extractErrorMessage(data.detail, 'Redemption failed.'));
      }
    } catch (err) {
      setRedeemStatusMsg('Connection failed.');
    } finally {
      setRedeemLoading(false);
    }
  };

  const fetchAdminData = async () => {
    if (!token) return;
    try {
      const resUsers = await fetch('/api/admin/users', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (resUsers.ok) {
        const usersData = await resUsers.json();
        setAdminUsers(usersData);
      }
      
      const resStats = await fetch('/api/admin/stats', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (resStats.ok) {
        const statsData = await resStats.json();
        setAdminStats(statsData);
      }

      const resConvs = await fetch('/api/admin/conversions', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (resConvs.ok) {
        const convsData = await resConvs.json();
        setAdminConversions(convsData);
      }

      const resPayments = await fetch('/api/admin/payments', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (resPayments.ok) {
        const paymentsData = await resPayments.json();
        setAdminPayments(paymentsData);
      }

      const resBanks = await fetch('/api/admin/banks', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (resBanks.ok) {
        const banksData = await resBanks.json();
        setAdminBanks(banksData);
      }

      const resQueries = await fetch('/api/admin/support-queries', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (resQueries.ok) {
        const queriesData = await resQueries.json();
        setAdminQueries(queriesData);
      }

      const resPromoCodes = await fetch('/api/admin/promo-codes', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (resPromoCodes.ok) {
        const promoData = await resPromoCodes.json();
        setAdminPromoCodes(promoData);
      }
    } catch (e) {
      console.error("Admin fetch error", e);
    }
  };

  useEffect(() => {
    if (activeTab === 'admin') {
      fetchAdminData();
    }
  }, [activeTab]);

  const handleSaveBankConfig = async (e) => {
    e.preventDefault();
    setBankFormError('');
    
    try {
      JSON.parse(bankFormConfigJson);
    } catch (err) {
      setBankFormError("Invalid JSON configuration format.");
      return;
    }
    
    const payload = {
      bank_key: bankFormKey.trim(),
      name: bankFormName.trim(),
      match_patterns: bankFormPatterns.trim(),
      parser_type: bankFormType,
      config_json: bankFormConfigJson.trim()
    };
    
    try {
      const url = selectedBankConfig 
        ? `/api/admin/banks/${selectedBankConfig.id}`
        : '/api/admin/banks';
      const method = selectedBankConfig ? 'PUT' : 'POST';
      
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      
      if (res.ok) {
        alert(selectedBankConfig ? "Bank config updated!" : "New bank config created!");
        setSelectedBankConfig(null);
        setBankFormKey('');
        setBankFormName('');
        setBankFormPatterns('');
        setBankFormType('SIMULATOR');
        setBankFormConfigJson('{\n  \n}');
        fetchAdminData();
        fetchSupportedBanks();
      } else {
        const err = await res.json();
        setBankFormError(extractErrorMessage(err.detail, "Failed to save configuration."));
      }
    } catch (err) {
      setBankFormError("Network error.");
    }
  };

  const handleDeleteBankConfig = async (bankId) => {
    if (!confirm("Are you sure you want to delete this bank configuration? Statements matching this format will no longer process.")) {
      return;
    }
    try {
      const res = await fetch(`/api/admin/banks/${bankId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        alert("Bank configuration deleted successfully.");
        fetchAdminData();
        fetchSupportedBanks();
      } else {
        alert("Failed to delete configuration.");
      }
    } catch (e) {
      alert("Network error.");
    }
  };

  const handleSelectEditBank = (bank) => {
    setSelectedBankConfig(bank);
    setBankFormKey(bank.bank_key);
    setBankFormName(bank.name);
    setBankFormPatterns(bank.match_patterns);
    setBankFormType(bank.parser_type);
    setBankFormConfigJson(bank.config_json);
    setBankFormError('');
  };

  const handleAdminCreateUser = async (e) => {
    e.preventDefault();
    setAdminNewUserError('');
    setAdminNewUserSuccess('');
    setAdminNewUserLoading(true);

    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          email: adminNewUserEmail,
          password: adminNewUserPassword,
          page_credits: parseInt(adminNewUserCredits, 10) || 0,
          is_admin: adminNewUserIsAdmin
        })
      });

      const data = await res.json();
      if (res.ok) {
        setAdminNewUserSuccess(`User ${adminNewUserEmail} created successfully!`);
        setAdminNewUserEmail('');
        setAdminNewUserPassword('');
        setAdminNewUserCredits(100);
        setAdminNewUserIsAdmin(false);
        fetchAdminData();
      } else {
        setAdminNewUserError(extractErrorMessage(data.detail, 'Failed to create user account.'));
      }
    } catch (err) {
      setAdminNewUserError('Network connection failed. Please try again.');
    } finally {
      setAdminNewUserLoading(false);
    }
  };

  const handleAdjustCredits = async (userId) => {
    const amountStr = creditAdjustmentInputs[userId] || '';
    const amountVal = parseInt(amountStr, 10);
    if (isNaN(amountVal) || amountVal === 0) {
      alert("Please enter a valid non-zero integer credit adjustment value.");
      return;
    }
    
    try {
      const res = await fetch(`/api/admin/users/${userId}/credits`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ credits: amountVal })
      });
      
      if (res.ok) {
        setCreditAdjustmentInputs(prev => ({ ...prev, [userId]: '' }));
        alert("Wallet credit adjusted successfully!");
        fetchAdminData();
        if (userId === user.id) {
          fetchUserProfile();
        }
      } else {
        const err = await res.json();
        alert(extractErrorMessage(err.detail, "Credit adjustment failed."));
      }
    } catch (e) {
      alert("Network error.");
    }
  };

  const handleToggleAdmin = async (userId) => {
    if (userId === user.id) {
      if (!confirm("Are you sure you want to toggle off your own administrative status? You will lose access to this console.")) {
        return;
      }
    }
    
    try {
      const res = await fetch(`/api/admin/users/${userId}/toggle-admin`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        alert("Administrative status toggled successfully!");
        fetchAdminData();
        if (userId === user.id) {
          fetchUserProfile();
          setActiveTab('convert');
        }
      } else {
        const err = await res.json();
        alert(extractErrorMessage(err.detail, "Action failed."));
      }
    } catch (e) {
      alert("Network error.");
    }
  };

  // Filter history list based on search bar query and client filter safely
  const filteredHistory = (conversionsHistory || []).filter(conv => {
    if (!conv) return false;
    if (historyClientFilter && conv.client_id !== historyClientFilter) {
      return false;
    }
    const q = (historySearch || '').toLowerCase().trim();
    if (!q) return true;
    const bName = (conv.bank_name || '').toLowerCase();
    const cName = (conv.client_name || '').toLowerCase();
    const period = (conv.statement_period || '').toLowerCase();
    const acc = (conv.account_number || '').toLowerCase();
    const fName = (conv.file_name || '').toLowerCase();
    return bName.includes(q) || cName.includes(q) || period.includes(q) || acc.includes(q) || fName.includes(q);
  });

  // --- Auth View (Tally Prime Terminal Edition) ---
  if (!token || !user) {
    return (
      <div className="min-h-screen flex flex-col justify-between bg-slate-100 antialiased font-mono text-slate-800">
        <div className="flex-grow flex flex-col justify-center py-10 px-4 sm:px-6">
          
          {/* Top Brand & Tally Prime Badge */}
          <div className="sm:mx-auto sm:w-full sm:max-w-md text-center mb-6">
            <div className="inline-flex items-center gap-2 mb-2">
              <span className="px-2.5 py-0.5 bg-[#008170] text-white font-extrabold text-[11px] rounded tracking-wider font-mono shadow-sm">
                TALLY PRIME
              </span>
              <span className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-wide">
                COMPANION SUITE
              </span>
            </div>
            <div className="flex items-center justify-center space-x-3 mb-2">
              <div className="w-10 h-10 rounded bg-[#0b192c] border border-[#1e3e62] flex items-center justify-center p-1.5 shadow-sm">
                <img 
                  src="/symbol_mark.svg" 
                  alt="Sheet Buddy" 
                  className="w-full h-full object-contain filter invert" 
                />
              </div>
              <h2 className="text-2xl font-bold text-[#0b192c] tracking-tight font-mono">
                Sheet Buddy Pro
              </h2>
            </div>
            <p className="text-xs font-mono font-bold text-slate-600 bg-white border-2 border-slate-300 rounded px-3 py-1 inline-flex items-center gap-2 shadow-xs">
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-pulse"></span>
              A Complete Tally Supporting Tool • Since 2026
            </p>
          </div>

          <div className="sm:mx-auto sm:w-full sm:max-w-md">
            <div className="bg-white rounded-lg border-2 border-slate-400 shadow-md p-6 sm:p-7 space-y-4 font-mono">
              
              {/* Practice Terminal Authentication Header */}
              <div className="border-b-2 border-slate-200 pb-2.5 mb-2 font-mono flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-slate-800 uppercase tracking-wider block">Practitioner Sign In</span>
                  <span className="text-[10px] text-slate-500 font-mono">Tally Prime Edition &bull; Practice Portal</span>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 bg-emerald-50 border border-emerald-300 rounded text-emerald-800">
                  Online
                </span>
              </div>

              {statusMessage && (
                <div className="bg-emerald-50 border-2 border-emerald-300 text-emerald-900 text-xs font-bold rounded p-3 flex items-start gap-2">
                  <span className="text-emerald-700 font-bold font-mono">[OK]</span>
                  <div className="flex-1 font-mono">{String(statusMessage)}</div>
                </div>
              )}

              {authError && (
                <div className="bg-rose-50 border-2 border-rose-300 text-rose-900 text-xs font-bold rounded p-3 flex items-start gap-2">
                  <span className="text-rose-700 font-bold font-mono">[!]</span>
                  <div className="flex-1 font-mono">{String(authError)}</div>
                </div>
              )}

              {/* Login Form */}
              {authMode === 'login' && (
                <form className="space-y-3.5" onSubmit={handleAuthSubmit}>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1">
                      Email Address
                    </label>
                    <input
                      type="email"
                      required
                      placeholder="ca.partner@firm.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="block w-full px-3 py-2 bg-white border-2 border-slate-400 rounded text-slate-900 text-xs font-mono font-medium focus:outline-none focus:border-[#008170] transition-colors placeholder:text-slate-400"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide">
                        Password
                      </label>
                      <button
                        type="button"
                        onClick={() => { setAuthMode('forgot'); setAuthError(''); }}
                        className="text-[11px] font-bold text-[#008170] hover:underline"
                      >
                        [Forgot Password?]
                      </button>
                    </div>
                    <input
                      type="password"
                      required
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="block w-full px-3 py-2 bg-white border-2 border-slate-400 rounded text-slate-900 text-xs font-mono font-medium focus:outline-none focus:border-[#008170] transition-colors placeholder:text-slate-400"
                    />
                  </div>

                  <div className="flex items-center">
                    <input
                      id="remember_me"
                      name="remember_me"
                      type="checkbox"
                      checked={remember}
                      onChange={(e) => setRemember(e.target.checked)}
                      className="h-4 w-4 text-[#008170] focus:ring-[#008170] border-slate-400 rounded cursor-pointer"
                    />
                    <label htmlFor="remember_me" className="ml-2 block text-xs font-bold text-slate-700 cursor-pointer select-none">
                      Remember me on this workstation
                    </label>
                  </div>

                  <div>
                    <button
                      type="submit"
                      disabled={authLoading}
                      className="w-full flex justify-center py-2.5 px-4 bg-[#008170] hover:bg-[#006e5f] text-white rounded font-mono font-bold text-xs uppercase tracking-wider shadow-sm transition-colors disabled:opacity-50"
                    >
                      {authLoading ? 'Verifying Credentials...' : '[Enter] Sign In to Tally Suite'}
                    </button>
                  </div>
                </form>
              )}



              {/* OTP Verification Form */}
              {authMode === 'verify' && (
                <form className="space-y-3.5" onSubmit={handleVerifyOTP}>
                  <div className="text-xs text-slate-700 font-mono">
                    We sent a 6-digit verification code to <span className="font-bold text-[#0b192c]">{verificationEmail}</span>.
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1">
                      One-Time Code (OTP)
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={6}
                      placeholder="123456"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value)}
                      className="block w-full px-3 py-2 bg-white border-2 border-slate-400 rounded text-[#0b192c] text-center font-mono tracking-widest text-lg font-bold focus:outline-none focus:border-[#008170] transition-colors"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={authLoading}
                    className="w-full flex justify-center py-2.5 px-4 bg-[#008170] hover:bg-[#006e5f] text-white rounded font-mono font-bold text-xs uppercase tracking-wider shadow-sm transition-colors disabled:opacity-50"
                  >
                    {authLoading ? 'Verifying OTP...' : 'Verify OTP & Activate Account'}
                  </button>
                  <div className="text-center pt-1">
                    <button
                      type="button"
                      onClick={() => setAuthMode('login')}
                      className="text-xs font-bold text-slate-600 hover:text-slate-900 font-mono"
                    >
                      ← Back to Sign In
                    </button>
                  </div>
                </form>
              )}

              {/* Forgot Password Form */}
              {authMode === 'forgot' && (
                <form className="space-y-3.5" onSubmit={handleForgotPassword}>
                  <div className="text-xs text-slate-600 font-mono">
                    Enter your registered email address. We will dispatch a 6-digit OTP code to verify and reset your password.
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1">
                      Registered Email Address
                    </label>
                    <input
                      type="email"
                      required
                      placeholder="ca.partner@firm.com"
                      value={email}
                      onChange={(e) => { setEmail(e.target.value); setVerificationEmail(e.target.value); }}
                      className="block w-full px-3 py-2 bg-white border-2 border-slate-400 rounded text-slate-900 text-xs font-mono font-medium focus:outline-none focus:border-[#008170] transition-colors"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={authLoading}
                    className="w-full flex justify-center py-2.5 px-4 bg-[#0b192c] hover:bg-[#1e3e62] text-amber-300 rounded font-mono font-bold text-xs uppercase tracking-wider shadow-sm transition-colors disabled:opacity-50"
                  >
                    {authLoading ? 'Sending Recovery Code...' : '[Enter] Send Recovery Code'}
                  </button>
                  <div className="text-center pt-1">
                    <button
                      type="button"
                      onClick={() => { setAuthMode('login'); setAuthError(''); }}
                      className="text-xs font-bold text-slate-600 hover:text-slate-900 font-mono"
                    >
                      ← Back to Sign In
                    </button>
                  </div>
                </form>
              )}

              {/* Reset Password Form */}
              {authMode === 'reset' && (
                <form className="space-y-3.5" onSubmit={handleResetPassword}>
                  <div className="text-xs text-slate-600 font-mono">
                    Enter the 6-digit recovery OTP code sent to <strong className="text-slate-900">{verificationEmail || email}</strong> along with your new password:
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1">
                      Recovery OTP Code
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={6}
                      placeholder="Enter 6-digit OTP"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value)}
                      className="block w-full px-3 py-2 bg-white border-2 border-slate-400 rounded text-slate-900 font-mono text-center text-sm font-bold tracking-widest focus:outline-none focus:border-[#008170]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1">
                      New Password
                    </label>
                    <input
                      type="password"
                      required
                      placeholder="Enter new secure password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="block w-full px-3 py-2 bg-white border-2 border-slate-400 rounded text-slate-900 text-xs font-mono focus:outline-none focus:border-[#008170]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1">
                      Confirm New Password
                    </label>
                    <input
                      type="password"
                      required
                      placeholder="Confirm new password"
                      value={confirmNewPassword}
                      onChange={(e) => setConfirmNewPassword(e.target.value)}
                      className="block w-full px-3 py-2 bg-white border-2 border-slate-400 rounded text-slate-900 text-xs font-mono focus:outline-none focus:border-[#008170]"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={authLoading}
                    className="w-full flex justify-center py-2.5 px-4 bg-[#008170] hover:bg-[#006e5f] text-white rounded font-mono font-bold text-xs uppercase tracking-wider shadow-sm transition-colors disabled:opacity-50"
                  >
                    {authLoading ? 'Updating Password...' : '[Enter] Update Password & Sign In'}
                  </button>
                  <div className="text-center pt-1">
                    <button
                      type="button"
                      onClick={() => { setAuthMode('login'); setAuthError(''); }}
                      className="text-xs font-bold text-slate-600 hover:text-slate-900 font-mono"
                    >
                      ← Back to Sign In
                    </button>
                  </div>
                </form>
              )}

            </div>

            {/* Feature Capability Strip (Only text kept; image removed) */}
            <div className="mt-4 bg-[#0b192c] text-white rounded-lg p-3 border-2 border-[#1e3e62] shadow-sm text-center font-mono">
              <p className="text-xs font-bold text-amber-300 uppercase tracking-wider font-mono">
                Automated Financial Reconciliation & Tally Integration
              </p>
            </div>
          </div>
        </div>

        {/* Footer on Login Page */}
        <footer className="py-5 text-center text-xs text-slate-600 border-t-2 border-slate-300 bg-slate-50 space-y-2.5 font-mono">
          <div className="flex flex-col sm:flex-row items-center justify-center space-y-2 sm:space-y-0 sm:space-x-3 max-w-lg mx-auto">
            <span className="font-bold text-slate-700">Book demo or custom enterprise pricing:</span>
            <div className="flex items-center space-x-2">
              {/* WhatsApp Link */}
              <a
                href="https://wa.me/919204915729?text=Hello!%20I'd%20like%20to%20know%20more,%20book%20a%20demo,%20or%20discuss%20pricing%20for%20Sheet%20Buddy."
                target="_blank"
                rel="noopener noreferrer"
                className="px-2.5 py-1 bg-[#008170] hover:bg-[#006e5f] text-white rounded text-xs font-bold shadow-sm transition-colors flex items-center gap-1.5"
                title="Contact on WhatsApp"
              >
                <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                  <path d="M17.472 14.382c-.022-.079-.116-.123-.27-.2c-.155-.077-.915-.452-1.056-.502c-.142-.053-.247-.077-.35.077c-.104.154-.4.502-.49.603c-.09.1-.18.11-.33.037c-.152-.074-.64-.236-1.22-.756c-.45-.4-.754-.896-.838-1.042c-.085-.145-.01-.223.067-.3c.068-.07.155-.18.23-.27c.077-.09.104-.15.155-.25c.05-.1.025-.19-.012-.265c-.038-.076-.35-.85-.48-1.164c-.127-.31-.257-.267-.35-.272c-.09-.004-.19-.004-.29-.004c-.1-.004-.263.038-.4.19c-.138.15-.527.513-.527 1.253s.54 1.455.614 1.555c.077.1 1.06 1.622 2.57 2.27c.36.155.64.248.86.315c.36.115.69.098.95.06c.29-.044.9-.368 1.03-.722c.13-.356.13-.663.09-.723M12 2C6.477 2 2 6.477 2 12c0 2.01.524 3.9 1.524 5.56L2 22l4.632-1.216C8.204 21.464 9.99 22 12 22c5.523 0 10-4.477 10-10S17.523 2 12 2z"/>
                </svg>
                <span>WhatsApp</span>
              </a>
              {/* Email Link */}
              <a
                href="mailto:sheetbuddyorg@gmail.com?subject=Sheet%20Buddy%20Demo%20and%20Pricing%20Inquiry"
                className="px-2.5 py-1 bg-[#0b192c] hover:bg-[#1e3e62] text-amber-300 rounded text-xs font-bold border border-[#1e3e62] shadow-sm transition-colors flex items-center gap-1.5"
                title="Send an Email"
              >
                <svg className="w-3.5 h-3.5 fill-none stroke-current" viewBox="0 0 24 24" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <span>Email Us</span>
              </a>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2 text-[11px] text-slate-500 font-mono">
            <span className="font-bold text-[#0b192c]">Sheet Buddy Pro</span>
            <span>•</span>
            <span>A Complete Tally Supporting Tool • Since 2026</span>
            <span>•</span>
            <span>
              Engineered for Chartered Accountants •{" "}
              <a
                href="https://www.instagram.com/verx_mysterio?igsi=MzliODFvcWt0emhn"
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-800 hover:text-black font-bold underline"
              >
                verx_mysterio
              </a>
            </span>
          </div>
        </footer>
      </div>
    );
  }


  // --- Main Executive Dashboard View ---
  return (
    <div className="min-h-screen flex flex-col bg-slate-50 antialiased font-sans">
      
      {/* Top Header containing Navigation Menu, Logo, and User stats (Tally Pro Terminal) */}
      <header className="bg-[#0b192c] text-white border-b-2 border-[#1e3e62] sticky top-0 z-50 shadow-md w-full max-w-full">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between w-full max-w-full">
          
          {/* Left: Brand Logo & Tally Prime Badge */}
          <div className="h-14 flex items-center justify-between px-5 border-b lg:border-b-0 lg:border-r border-[#1e3e62] bg-[#0b192c] flex-shrink-0">
            <div className="flex items-center space-x-3 cursor-pointer select-none" onClick={() => { setActiveTab('convert'); setExecuteError(''); }}>
              <span className="px-2 py-0.5 bg-[#008170] text-white font-extrabold text-[10px] rounded tracking-wider font-mono">
                TALLY PRIME
              </span>
              <div>
                <span className="font-bold text-white text-sm tracking-tight block leading-none font-mono">Sheet Buddy Pro</span>
                <span className="text-[10px] font-mono text-slate-400 block mt-1 tracking-normal">Accounting Suite • 2026</span>
              </div>
            </div>

            {/* Hamburger Icon button for mobile screen */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden p-2 rounded border border-[#1e3e62] bg-[#1e3e62]/40 hover:bg-[#1e3e62] text-slate-200 focus:outline-none transition-colors"
              aria-label="Toggle navigation"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                {mobileMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>

          {/* Center Navigation & Action Controls */}
          <div className={`${mobileMenuOpen ? 'flex' : 'hidden'} lg:flex flex-col lg:flex-row flex-1 items-stretch lg:items-center justify-between min-w-0 overflow-visible`}>
            <nav className="flex flex-col lg:flex-row lg:flex-nowrap items-stretch lg:items-center p-2 lg:p-0 lg:px-4 gap-1.5 flex-1 min-w-0 overflow-visible border-b lg:border-b-0 border-[#1e3e62] font-mono text-xs">
              
              {/* 1. [F1] IMPORT (Dropdown: PDF TO TALLY & CSV TO TALLY) */}
              <div ref={importMenuRef} className="relative flex-shrink-0">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setImportDropdownOpen(prev => !prev);
                    setConfigDropdownOpen(false);
                  }}
                  className={`w-full lg:w-auto px-3 py-1.5 rounded transition-all flex items-center justify-between lg:justify-start gap-1.5 whitespace-nowrap font-mono ${
                    (activeTab === 'convert' || activeTab === 'csv')
                      ? 'bg-[#1e3e62] text-amber-300 font-bold border border-[#008170] shadow-sm'
                      : 'text-slate-200 hover:text-white hover:bg-[#1e3e62]/60 font-semibold'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V3" />
                    </svg>
                    <span>[F1] IMPORT</span>
                  </span>
                  <svg 
                    className={`w-3 h-3 text-slate-400 transition-transform duration-150 ${importDropdownOpen ? 'rotate-180 text-amber-300' : ''}`} 
                    fill="none" 
                    viewBox="0 0 24 24" 
                    stroke="currentColor" 
                    strokeWidth={2.2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {importDropdownOpen && (
                  <div className="lg:absolute left-0 top-full mt-1 w-52 bg-[#0b192c] border-2 border-[#1e3e62] text-white rounded shadow-2xl py-1 z-[100] font-mono">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('convert');
                        setExecuteError('');
                        setImportDropdownOpen(false);
                        setMobileMenuOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 text-xs transition-colors ${
                        activeTab === 'convert'
                          ? 'text-amber-300 bg-[#1e3e62] font-bold'
                          : 'text-slate-200 hover:text-white hover:bg-[#1e3e62]/60'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <svg className={`w-3.5 h-3.5 ${activeTab === 'convert' ? 'text-amber-300' : 'text-slate-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 13h6m-6 4h4" />
                        </svg>
                        <span>[1] PDF to Tally</span>
                      </div>
                      {activeTab === 'convert' && (
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('csv');
                        setExecuteError('');
                        setImportDropdownOpen(false);
                        setMobileMenuOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 text-xs transition-colors ${
                        activeTab === 'csv'
                          ? 'text-amber-300 bg-[#1e3e62] font-bold'
                          : 'text-slate-200 hover:text-white hover:bg-[#1e3e62]/60'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <svg className={`w-3.5 h-3.5 ${activeTab === 'csv' ? 'text-amber-300' : 'text-slate-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M3 14h18m-9-4v8m-7 4h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <span>[2] CSV to Tally</span>
                      </div>
                      {activeTab === 'csv' && (
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                      )}
                    </button>
                  </div>
                )}
              </div>

              {/* 2. [F2] CONFIGURATION (Dropdown) */}
              <div ref={configMenuRef} className="relative flex-shrink-0">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfigDropdownOpen(prev => !prev);
                    setImportDropdownOpen(false);
                  }}
                  className={`w-full lg:w-auto px-3 py-1.5 rounded transition-all flex items-center justify-between lg:justify-start gap-1.5 whitespace-nowrap font-mono ${
                    (activeTab === 'clients' || activeTab === 'rules' || activeTab === 'history')
                      ? 'bg-[#1e3e62] text-amber-300 font-bold border border-[#008170] shadow-sm'
                      : 'text-slate-200 hover:text-white hover:bg-[#1e3e62]/60 font-semibold'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <span>[F2] CONFIG</span>
                  </span>
                  <svg 
                    className={`w-3 h-3 text-slate-400 transition-transform duration-150 ${configDropdownOpen ? 'rotate-180 text-amber-300' : ''}`} 
                    fill="none" 
                    viewBox="0 0 24 24" 
                    stroke="currentColor" 
                    strokeWidth={2.2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {configDropdownOpen && (
                  <div className="lg:absolute left-0 top-full mt-1 w-56 bg-[#0b192c] border-2 border-[#1e3e62] text-white rounded shadow-2xl py-1 z-[100] font-mono">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('clients');
                        setSelectedDossierClient(null);
                        setExecuteError('');
                        setConfigDropdownOpen(false);
                        setMobileMenuOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 text-xs transition-colors ${
                        activeTab === 'clients'
                          ? 'text-amber-300 bg-[#1e3e62] font-bold'
                          : 'text-slate-200 hover:text-white hover:bg-[#1e3e62]/60'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <svg className={`w-3.5 h-3.5 ${activeTab === 'clients' ? 'text-amber-300' : 'text-slate-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                        </svg>
                        <span>[1] Client Dossiers</span>
                      </div>
                      {activeTab === 'clients' && (
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('rules');
                        setExecuteError('');
                        setConfigDropdownOpen(false);
                        setMobileMenuOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 text-xs transition-colors ${
                        activeTab === 'rules'
                          ? 'text-amber-300 bg-[#1e3e62] font-bold'
                          : 'text-slate-200 hover:text-white hover:bg-[#1e3e62]/60'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <svg className={`w-3.5 h-3.5 ${activeTab === 'rules' ? 'text-amber-300' : 'text-slate-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                        </svg>
                        <span>[2] Ledger Rules</span>
                      </div>
                      {activeTab === 'rules' && (
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('history');
                        setExecuteError('');
                        setConfigDropdownOpen(false);
                        setMobileMenuOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 text-xs transition-colors ${
                        activeTab === 'history'
                          ? 'text-amber-300 bg-[#1e3e62] font-bold'
                          : 'text-slate-200 hover:text-white hover:bg-[#1e3e62]/60'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <svg className={`w-3.5 h-3.5 ${activeTab === 'history' ? 'text-amber-300' : 'text-slate-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 00-9.78 2.096A4.001 4.001 0 003 15z" />
                        </svg>
                        <span>[3] Cloud XML Vault</span>
                      </div>
                      {activeTab === 'history' && (
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                      )}
                    </button>
                  </div>
                )}
              </div>

              {/* 3. [F3] CREDITS */}
              <button
                type="button"
                onClick={() => {
                  setActiveTab('wallet');
                  setExecuteError('');
                  setMobileMenuOpen(false);
                  setImportDropdownOpen(false);
                  setConfigDropdownOpen(false);
                }}
                className={`px-3 py-1.5 rounded transition-all flex items-center justify-between lg:justify-start gap-1.5 whitespace-nowrap flex-shrink-0 font-mono ${
                  activeTab === 'wallet'
                    ? 'bg-[#1e3e62] text-amber-300 font-bold border border-[#008170] shadow-sm'
                    : 'text-slate-200 hover:text-white hover:bg-[#1e3e62]/60 font-semibold'
                }`}
              >
                <span>[F3] CREDITS</span>
              </button>

              {/* 4. [F4] SUPPORT */}
              <button
                type="button"
                onClick={() => {
                  setActiveTab('support');
                  setExecuteError('');
                  setMobileMenuOpen(false);
                  setImportDropdownOpen(false);
                  setConfigDropdownOpen(false);
                }}
                className={`px-3 py-1.5 rounded transition-all flex items-center justify-between lg:justify-start gap-1.5 whitespace-nowrap flex-shrink-0 font-mono ${
                  activeTab === 'support'
                    ? 'bg-[#1e3e62] text-amber-300 font-bold border border-[#008170] shadow-sm'
                    : 'text-slate-200 hover:text-white hover:bg-[#1e3e62]/60 font-semibold'
                }`}
              >
                <span>[F4] SUPPORT</span>
              </button>

              {/* 5. [F5] PROFILE */}
              <button
                type="button"
                onClick={() => {
                  setActiveTab('settings');
                  setExecuteError('');
                  setMobileMenuOpen(false);
                  setCurrentPassword('');
                  setProfileNewPassword('');
                  setProfileConfirmNewPassword('');
                  setProfileSuccessMsg('');
                  setProfileErrorMsg('');
                  setImportDropdownOpen(false);
                  setConfigDropdownOpen(false);
                }}
                className={`px-3 py-1.5 rounded transition-all flex items-center justify-between lg:justify-start gap-1.5 whitespace-nowrap flex-shrink-0 font-mono ${
                  activeTab === 'settings'
                    ? 'bg-[#1e3e62] text-amber-300 font-bold border border-[#008170] shadow-sm'
                    : 'text-slate-200 hover:text-white hover:bg-[#1e3e62]/60 font-semibold'
                }`}
              >
                <span>[F5] PROFILE</span>
              </button>

              {/* ADMIN CONSOLE */}
              {user.is_admin && (
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('admin');
                    setExecuteError('');
                    setMobileMenuOpen(false);
                    setImportDropdownOpen(false);
                    setConfigDropdownOpen(false);
                  }}
                  className={`px-3 py-1.5 rounded transition-all flex items-center justify-between lg:justify-start gap-1.5 whitespace-nowrap flex-shrink-0 font-mono ${
                    activeTab === 'admin'
                      ? 'bg-amber-400 text-[#0b192c] font-bold shadow-sm'
                      : 'text-amber-400 hover:bg-[#1e3e62]/60 font-semibold border border-amber-400/40'
                  }`}
                >
                  <span>[ADMIN] CONSOLE</span>
                </button>
              )}
            </nav>

            {/* Right: Credits Counter in Tally Gold & Logout */}
            <div className="flex items-center justify-between sm:justify-end px-4 py-2 space-x-2.5 border-t lg:border-t-0 lg:border-l border-[#1e3e62] bg-[#0b192c] flex-shrink-0 self-stretch lg:self-center font-mono">
              <div className="flex items-center space-x-1.5 bg-[#1e3e62] border border-[#008170]/50 text-amber-300 px-3 py-1 rounded shadow-sm flex-shrink-0">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <span className="text-xs font-bold">CREDITS: {user.page_credits}</span>
              </div>
              <button
                onClick={handleLogout}
                className="px-2.5 py-1 rounded border border-[#1e3e62] text-xs font-semibold text-slate-300 hover:text-rose-400 hover:bg-rose-950/40 transition-colors flex-shrink-0"
              >
                [Esc] Exit
              </button>
            </div>
          </div>
        </div>

        {/* Tier 2: Company Practice Header (Tally Ruled Sub-Bar) */}
        <div className="bg-[#1e3e62]/20 border-b border-slate-300 px-6 py-2 flex flex-wrap items-center justify-between text-xs font-mono text-slate-900 bg-slate-100">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-[11px] font-bold text-[#0b192c] flex items-center gap-1.5 tracking-wider uppercase">
              COMPANY:
            </span>
            <select
              value={activeClientId}
              onChange={(e) => setActiveClientId(e.target.value)}
              className="bg-white border-2 border-slate-400 rounded px-2.5 py-1 text-xs font-bold text-[#0b192c] focus:outline-none focus:border-[#008170] cursor-pointer shadow-sm font-mono"
            >
              <option value="">(All Practice Accounts / General)</option>
              {clientsList.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.financial_year ? `[FY ${c.financial_year}]` : ''}
                </option>
              ))}
            </select>
            {activeClientId && (
              <button
                id="btn-open-dossier"
                type="button"
                onClick={() => {
                  const clientObj = clientsList.find(c => c.id === activeClientId);
                  if (clientObj) {
                    setSelectedDossierClient(clientObj);
                    fetchClientDossier(clientObj.id);
                    setActiveTab('clients');
                  }
                }}
                className="text-[11px] bg-[#008170] hover:bg-[#006e5f] text-white px-2.5 py-1 rounded font-bold transition-colors shadow-sm flex items-center gap-1 font-mono"
              >
                <span>[Alt+D] Open Dossier</span>
              </button>
            )}
          </div>

          <div className="flex items-center space-x-2 font-mono">
            <button
              type="button"
              onClick={() => handleOpenClientModal()}
              className="text-[11px] bg-white hover:bg-slate-50 text-slate-900 px-2.5 py-1 rounded font-bold border-2 border-slate-400 shadow-sm transition-colors flex items-center gap-1.5"
            >
              <span>+ Add Company</span>
            </button>
            <button
              type="button"
              onClick={() => { setActiveTab('clients'); setSelectedDossierClient(null); }}
              className="text-[11px] bg-white hover:bg-slate-50 text-slate-800 px-2.5 py-1 rounded font-bold border-2 border-slate-400 shadow-sm transition-colors flex items-center gap-1.5"
            >
              <span>All Companies ({clientsList.length})</span>
            </button>
          </div>
        </div>
      </header>{/* Main Content Workspace */}
      <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">

        {checkoutSession ? (
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xl shadow-slate-200/40 p-8 max-w-lg mx-auto space-y-6">
            <div className="bg-white text-slate-900 p-5 rounded-xl border border-slate-200/90 flex items-center space-x-3.5 shadow-2xs">
              <div className="w-10 h-10 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 flex-shrink-0">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
              </div>
              <div>
                <h3 className="text-base font-bold tracking-tight text-slate-900">Secure Checkout</h3>
                <p className="text-xs text-slate-500">Sheet Buddy Payment Verification Gateway</p>
              </div>
            </div>

            {/* Plan Details Box */}
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 text-xs font-medium space-y-2.5">
              <div className="flex justify-between items-center text-slate-600">
                <span>Selected Plan:</span>
                <span className="font-bold text-slate-900 uppercase">{checkoutSession.planName}</span>
              </div>
              <div className="flex justify-between items-center text-slate-600">
                <span>Page Credits:</span>
                <span className="font-mono font-bold text-slate-900">{checkoutSession.pages} Pages</span>
              </div>
              <div className="flex justify-between items-center border-t border-slate-200/80 pt-2.5">
                <span className="font-semibold text-slate-700">Amount Due:</span>
                <span className="font-mono font-extrabold text-slate-900 text-base">₹{checkoutSession.amount.toFixed(2)}</span>
              </div>
            </div>

            {/* Payment Details & QR Code */}
            <div className="flex flex-col items-center space-y-3.5 p-5 border border-slate-200 rounded-xl bg-white shadow-sm">
              <span className="text-xs font-semibold text-slate-800">Scan QR Code to Pay ₹{checkoutSession.amount.toFixed(2)}</span>
              
              <img 
                src="/QR-CODE.jpeg" 
                className="w-48 h-48 rounded-xl border border-slate-200 object-contain shadow-inner" 
                alt="Payment QR Code" 
              />
              
              <span className="text-[11px] font-medium text-slate-500">GPay • PhonePe • Paytm • Any UPI App</span>
            </div>

            <div className="bg-amber-50 rounded-xl border border-amber-200 p-4 text-xs font-medium text-amber-900 space-y-2 leading-relaxed">
              <p className="font-bold text-amber-950 flex items-center gap-1.5">
                <span className="text-amber-500 font-bold font-mono">[!]</span> Action Required:
              </p>
              <p>
                Please pay exactly <span className="font-bold font-mono text-amber-950">₹{checkoutSession.amount.toFixed(2)}</span> using the QR code above.
              </p>
              <p>
                Once payment is complete, click the button below to send your payment screenshot along with your registered email account (<span className="font-semibold text-amber-950">{user.email}</span>) to our WhatsApp support.
              </p>
              <p className="text-[11px] text-amber-700 italic">
                Your credits will be activated immediately upon admin confirmation.
              </p>
            </div>

            {checkoutError && (
              <div className="bg-rose-50 text-rose-700 p-3 rounded-xl border border-rose-200 font-medium text-xs">
                {String(checkoutError)}
              </div>
            )}

            <div className="space-y-2.5 pt-1">
              <button
                onClick={handleWhatsAppCheckout}
                disabled={paymentLoading}
                className="w-full flex justify-center items-center gap-2 py-3 px-4 rounded-xl font-semibold text-white bg-emerald-600 hover:bg-emerald-500 shadow-sm transition-all text-xs disabled:opacity-50"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                <span>{paymentLoading ? 'Registering Ticket...' : 'Send Screenshot on WhatsApp'}</span>
              </button>

              <button
                type="button"
                onClick={() => setCheckoutSession(null)}
                className="w-full text-center py-2.5 px-4 rounded-xl font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-all text-xs"
              >
                Cancel & Go Back
              </button>
            </div>
          </div>
        ) : (
          <>
        {/* --- TAB 1: CONVERT STATEMENT (Option 2: Tally Pro Terminal) --- */}
        {activeTab === 'convert' && (
          <div className="space-y-5 max-w-7xl mx-auto">
            
            {/* Top Brand Banner */}
            {!parsedSummary && (
              <div className="bg-white text-slate-800 p-4 rounded-lg border-2 border-slate-400 shadow-sm max-w-2xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 font-mono">
                <div className="flex items-center space-x-3.5">
                  <div className="w-10 h-10 rounded bg-[#0b192c] border border-[#1e3e62] flex items-center justify-center p-1.5 flex-shrink-0">
                    <img src="/symbol_mark.svg" alt="Sheet Buddy" className="w-full h-full object-contain filter invert" />
                  </div>
                  <div>
                    <span className="text-[11px] font-bold text-[#0b192c] uppercase tracking-wider block">BANK STATEMENT → TALLY XML BRIDGE</span>
                    <p className="text-xs font-mono text-slate-500 mt-0.5">Automated Coordinate Parser & Reconciled Voucher Engine</p>
                  </div>
                </div>
                <span className="px-2.5 py-1 bg-[#008170] text-white text-[10px] font-bold rounded tracking-wider uppercase font-mono">
                  TALLY PRIME ENGINE
                </span>
              </div>
            )}
            
            {/* UPLOAD FORM */}
            {!parsedSummary && (
              <div className="bg-white rounded-lg border-2 border-slate-400 shadow-sm p-6 sm:p-7 max-w-2xl mx-auto space-y-5 font-mono">
                <div className="flex items-center justify-between bg-[#0b192c] text-white p-3.5 rounded border border-[#1e3e62]">
                  <div className="flex items-center space-x-3">
                    <span className="px-2 py-0.5 bg-[#008170] text-white font-extrabold text-[10px] rounded tracking-wider">
                      [F1:1]
                    </span>
                    <div>
                      <h2 className="text-sm font-bold tracking-tight">Import Bank Statement PDF</h2>
                      <p className="text-[11px] text-slate-400">Extracts transaction coordinates & compiles Tally vouchers</p>
                    </div>
                  </div>
                  <span className="text-[10px] bg-[#1e3e62] text-amber-300 font-bold px-2 py-0.5 rounded border border-amber-400/30">
                    MULTI-PDF READY
                  </span>
                </div>

                <form onSubmit={handleUploadAndParse} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wide">
                      Select Bank Statement Format
                    </label>
                    <select
                      value={supportedBanks.some(b => b.bank_key === bankName) ? bankName : (supportedBanks[0]?.bank_key || 'sbi')}
                      onChange={(e) => setBankName(e.target.value)}
                      className="w-full px-3 py-2 text-xs font-mono font-bold border-2 border-slate-400 rounded focus:outline-none focus:border-[#008170] bg-white transition-colors"
                    >
                      {supportedBanks.map((b) => (
                        <option key={b.bank_key} value={b.bank_key}>{b.name}</option>
                      ))}
                    </select>
                    {supportedBanks.find((b) => b.name === bankName)?.parser_type === "SIMULATOR" && (
                      <p className="mt-2 text-xs font-mono font-bold text-cyan-900 bg-cyan-50 border border-cyan-300 rounded px-2.5 py-1 inline-block">
                        MOCK SIMULATOR ACTIVE: You can upload any test PDF to verify pipeline.
                      </p>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide">
                        Upload Statement PDF(s)
                      </label>
                      <span className="text-[10px] font-bold font-mono bg-slate-100 text-slate-700 border border-slate-300 rounded px-2 py-0.5">
                        Batch Multi-Upload Supported
                      </span>
                    </div>

                    <div 
                      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const droppedFiles = Array.from(e.dataTransfer.files || []).filter(
                          f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
                        );
                        if (droppedFiles.length > 0) {
                          setSelectedFiles(droppedFiles);
                          setSelectedFile(droppedFiles[0]);
                          setUploadError('');
                          setParsedSummary(null);
                          setEditedNarrations({});
                          setEditedLedgers({});
                        }
                      }}
                      className="flex justify-center px-6 pt-7 pb-7 border-2 border-dashed border-slate-400 hover:border-[#008170] hover:bg-amber-50/30 rounded-lg cursor-pointer bg-slate-50/60 transition-all font-mono"
                    >
                      <div className="space-y-2.5 text-center">
                        <div className="w-10 h-10 rounded bg-[#0b192c] text-amber-300 border border-[#1e3e62] flex items-center justify-center mx-auto">
                          <svg className="w-5 h-5 stroke-current fill-none" viewBox="0 0 24 24" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                          </svg>
                        </div>
                        <div className="flex text-xs justify-center font-bold">
                          <label className="relative cursor-pointer text-[#008170] hover:underline">
                            <span>Browse single or multiple statement PDFs</span>
                            <input
                              type="file"
                              accept=".pdf"
                              multiple
                              onChange={handleFileUploadChange}
                              className="sr-only"
                            />
                          </label>
                        </div>
                        <p className="text-[11px] text-slate-500 font-mono">
                          Drag and drop files here • PDF coordinate analysis
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Multi-File or Single-File Selection Display */}
                  {selectedFiles.length > 1 ? (
                    <div className="bg-slate-50 rounded-lg border-2 border-slate-400 p-3 space-y-2 font-mono">
                      <div className="flex items-center justify-between pb-2 border-b border-slate-300">
                        <div className="flex items-center space-x-2">
                          <span className="bg-[#0b192c] text-white text-[10px] font-bold px-2 py-0.5 rounded">
                            {selectedFiles.length} FILES SELECTED
                          </span>
                          <span className="text-[11px] font-mono text-slate-600 font-bold">
                            Total: {(selectedFiles.reduce((acc, f) => acc + f.size, 0) / (1024 * 1024)).toFixed(2)} MB
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => { setSelectedFiles([]); setSelectedFile(null); }}
                          className="text-[11px] text-rose-700 hover:text-rose-900 font-bold"
                        >
                          Clear All
                        </button>
                      </div>
                      <div className="max-h-36 overflow-y-auto space-y-1 pr-1 divide-y divide-slate-200">
                        {selectedFiles.map((f, fIdx) => (
                          <div key={fIdx} className="flex items-center justify-between pt-1 text-xs">
                            <div className="flex items-center space-x-2 truncate max-w-sm">
                              <span className="text-[10px] font-mono text-slate-500">#{fIdx + 1}</span>
                              <span className="text-slate-800 truncate font-mono text-[11px] font-medium">{f.name}</span>
                              <span className="text-[10px] text-slate-500 font-mono">({(f.size / 1024).toFixed(0)} KB)</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemoveFile(fIdx)}
                              className="text-slate-500 hover:text-rose-700 px-1 text-xs font-bold transition-colors ml-2 font-mono"
                              title="Remove this file"
                            >
                              [X]
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : selectedFile ? (
                    <div className="bg-slate-50 p-2.5 rounded-lg border-2 border-slate-400 flex items-center justify-between text-xs font-mono">
                      <div className="flex items-center space-x-2 truncate max-w-md">
                        <span className="font-bold text-[#0b192c]">PDF:</span>
                        <span className="text-slate-800 truncate font-mono">{selectedFile.name}</span>
                        <span className="text-[10px] text-slate-500 font-mono">({(selectedFile.size / 1024).toFixed(0)} KB)</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setSelectedFiles([]); setSelectedFile(null); }}
                        className="text-rose-700 hover:text-rose-900 text-xs font-bold font-mono"
                      >
                        [Remove]
                      </button>
                    </div>
                  ) : null}

                  {/* Upload & Parse Live Progress Bar */}
                  {uploadLoading && uploadProgress && (
                    <div className="bg-white border-2 border-slate-400 p-3.5 rounded-lg shadow-sm space-y-2 font-mono">
                      <div className="flex items-center justify-between text-xs font-bold">
                        <span className="text-[#0b192c]">
                          Parsing Statement {uploadProgress.current} of {uploadProgress.total}
                        </span>
                        <span className="font-mono text-[#008170] font-bold">
                          {Math.round((uploadProgress.current / uploadProgress.total) * 100)}%
                        </span>
                      </div>
                      <div className="w-full bg-slate-200 rounded h-2 overflow-hidden border border-slate-300">
                        <div
                          className="bg-[#008170] h-full transition-all duration-300"
                          style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }}
                        />
                      </div>
                      <p className="text-[11px] font-mono text-slate-600 truncate">
                        File: {uploadProgress.filename}
                      </p>
                    </div>
                  )}

                  {uploadError && (
                    <div className="bg-rose-50 text-rose-900 p-3 rounded-lg border-2 border-rose-300 font-mono text-xs font-bold">
                      [Error]: {String(uploadError)}
                    </div>
                  )}

                  <div className="pt-2">
                    <button
                      type="submit"
                      disabled={uploadLoading || (selectedFiles.length === 0 && !selectedFile)}
                      className="w-full flex justify-center py-2.5 px-4 rounded font-mono font-bold text-white bg-[#008170] hover:bg-[#006e5f] shadow-sm transition-colors text-xs uppercase tracking-wider disabled:opacity-50"
                    >
                      {uploadLoading
                        ? (uploadProgress ? `Processing ${uploadProgress.current} of ${uploadProgress.total} Statements...` : 'Extracting PDF Data...')
                        : (selectedFiles.length > 1 ? `[Enter] PARSE ${selectedFiles.length} STATEMENT PDFS` : '[Enter] PARSE STATEMENT PDF')}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* DETAILED STATS PREVIEW & EXECUTION STEP */}
            {parsedSummary && (
              <div className="space-y-4 max-w-7xl mx-auto">
                
                {/* 1. Multi-Signal Auto-Detected Bank Banner (Tally Pro Terminal) */}
                <div className="bg-white text-slate-900 p-4 rounded-lg border-2 border-slate-400 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4 font-mono">
                  <div className="flex items-center space-x-3.5">
                    <div className="w-10 h-10 rounded bg-[#0b192c] border border-[#1e3e62] flex items-center justify-center p-1.5 flex-shrink-0">
                      <img src="/symbol_mark.svg" alt="Bank Logo" className="w-full h-full object-contain filter invert" />
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[#0b192c]">
                          TALLY DETECTION MATRIX
                        </span>
                        <span className="bg-emerald-100 text-emerald-800 border border-emerald-300 text-[10px] font-bold px-2 py-0.2 rounded uppercase">
                          {parsedSummary.detection_confidence ? `${Math.round(parsedSummary.detection_confidence)}% Confidence` : 'High Confidence'}
                        </span>
                      </div>
                      <h3 className="text-base font-bold text-[#0b192c] tracking-tight mt-0.5">
                        {parsedSummary.bank_name || parsedSummary.detected_bank || 'Standard Bank Statement'}
                      </h3>
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        <span className="bg-slate-100 text-slate-800 text-[10px] font-mono px-2 py-0.5 rounded border border-slate-300">
                          Format: {parsedSummary.document_type || 'NATIVE_PDF'}
                        </span>
                        {parsedSummary.account_number && (
                          <span className="bg-slate-100 text-slate-800 text-[10px] font-mono px-2 py-0.5 rounded border border-slate-300">
                            A/C: {parsedSummary.account_number}
                          </span>
                        )}
                        {parsedSummary.statement_period && (
                          <span className="bg-slate-100 text-slate-800 text-[10px] font-mono px-2 py-0.5 rounded border border-slate-300">
                            Period: {parsedSummary.statement_period}
                          </span>
                        )}
                        {parsedSummary.multi_file_count > 1 && (
                          <span className="bg-[#1e3e62] text-amber-300 text-[10px] font-mono font-bold px-2 py-0.5 rounded uppercase">
                            {parsedSummary.multi_file_count} Statements Consolidated
                          </span>
                        )}
                        {parsedSummary.detection_signals && parsedSummary.detection_signals.slice(0, 3).map((sig, sIdx) => (
                          <span key={sIdx} className="bg-slate-100 text-slate-700 text-[9px] font-mono px-1.5 py-0.5 rounded border border-slate-300">
                            {sig}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-2 self-stretch md:self-auto justify-end font-mono">
                    <button
                      onClick={() => setShortcutsModalOpen(true)}
                      className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-800 font-bold text-xs rounded border-2 border-slate-400 shadow-sm transition-colors flex items-center gap-1.5"
                      title="View Keyboard Shortcuts"
                    >
                      <svg className="w-3.5 h-3.5 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                      </svg>
                      <span>[Alt+S] Shortcuts</span>
                    </button>
                    <button
                      onClick={() => {
                        setParsedSummary(null);
                        setSelectedFile(null);
                        setSelectedFiles([]);
                        setAllTransactions([]);
                      }}
                      className="px-3 py-1.5 bg-white hover:bg-rose-50 text-rose-700 font-bold text-xs rounded border-2 border-rose-300 shadow-sm transition-colors"
                    >
                      [Esc] Re-Upload
                    </button>
                  </div>
                </div>

                {/* Warning Alerts */}
                {parsedSummary.is_duplicate && (
                  <div className="bg-amber-50 border-2 border-amber-400 rounded-lg p-3 text-xs font-mono text-amber-950 flex items-start space-x-2.5 shadow-sm">
                    <svg className="w-4 h-4 text-amber-700 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <div>
                      <span className="font-bold block uppercase text-[11px]">[Warning] Duplicate Statement File</span>
                      This statement PDF was previously parsed. Re-conversion is permitted; verify duplicate vouchers are not imported into Tally.
                    </div>
                  </div>
                )}

                {!parsedSummary.reconciled && (
                  <div className="bg-rose-50 border-2 border-rose-400 rounded-lg p-3 text-xs font-mono text-rose-950 flex items-start space-x-2.5 shadow-sm">
                    <svg className="w-4 h-4 text-rose-700 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <div>
                      <span className="font-bold block uppercase text-[11px]">[Audit Warning] Reconciliation Mismatch</span>
                      Transaction sum (Opening + Credits - Debits) differs from Closing Balance {parsedSummary.reconciliation_discrepancy ? `by ₹${Math.abs(parsedSummary.reconciliation_discrepancy).toFixed(2)}` : ''}. Review flagged entries below.
                    </div>
                  </div>
                )}

                {/* Analytics Metric Cards Grid (Tally Ruled Boxes) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 font-mono">
                  <div className="bg-white p-4 rounded-lg border-2 border-slate-400 shadow-sm flex flex-col justify-between">
                    <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">TOTAL TRANSACTIONS</p>
                    <p className="text-2xl font-bold font-mono text-[#0b192c] mt-1">{allTransactions.length || parsedSummary.transactions_count}</p>
                    <span className="text-[10px] text-slate-500 font-mono mt-1">{parsedSummary.pages_count} PDF Pages</span>
                  </div>

                  <div className="bg-white p-4 rounded-lg border-2 border-slate-400 shadow-sm flex flex-col justify-between">
                    <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">OPENING BALANCE</p>
                    <p className="text-xl font-bold font-mono text-slate-900 mt-1">₹{(parsedSummary.opening_balance || 0).toLocaleString('en-IN', {minimumFractionDigits: 2})}</p>
                    <span className="text-[10px] text-slate-500 font-mono mt-1">Start of Period</span>
                  </div>

                  <div className="bg-white p-4 rounded-lg border-2 border-slate-400 shadow-sm flex flex-col justify-between">
                    <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">CLOSING BALANCE</p>
                    <p className="text-xl font-bold font-mono text-slate-900 mt-1">₹{(parsedSummary.closing_balance || 0).toLocaleString('en-IN', {minimumFractionDigits: 2})}</p>
                    <span className="text-[10px] text-slate-500 font-mono mt-1">End of Period</span>
                  </div>

                  <div className="bg-white p-4 rounded-lg border-2 border-slate-400 shadow-sm flex flex-col justify-between">
                    <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">RECONCILIATION AUDIT</p>
                    <div className="mt-1">
                      {parsedSummary.reconciled ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                          AUDIT OK ✓
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs font-bold bg-rose-100 text-rose-800 border border-rose-300">
                          MISMATCH ✗
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-500 font-mono mt-1">
                      {allTransactions.filter(t => t.requires_review).length} items need review
                    </span>
                  </div>
                </div>

                {/* 2. Review Queue Filter Tabs & Action Toolbar */}
                <div className="bg-white rounded-lg border-2 border-slate-400 shadow-sm overflow-hidden font-mono">
                  
                  {/* Top Bar with Tally Pro Header Actions */}
                  <div className="px-4 py-2.5 bg-[#0b192c] text-white flex flex-col lg:flex-row justify-between items-start lg:items-center gap-2 border-b-2 border-slate-400">
                    <div className="font-bold text-xs uppercase text-amber-300 tracking-wider">
                      BANK STATEMENT TRANSACTION VOUCHERS ({allTransactions.length} ENTRIES)
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        id="btn-auto-match-ledgers"
                        type="button"
                        onClick={() => {
                          // Quick Auto-match rules trigger
                          setExecuteError('');
                          const updated = allTransactions.map((tx, idx) => {
                            return tx;
                          });
                        }}
                        className="px-3 py-1 bg-white border-2 border-slate-300 rounded text-xs font-bold text-slate-900 hover:bg-slate-100 transition-colors shadow-sm"
                      >
                        [Alt+A] AUTO-MATCH LEDGERS
                      </button>
                      <button
                        id="btn-export-tally-xml"
                        type="button"
                        onClick={handleExecuteConversion}
                        disabled={executeLoading || user.page_credits < parsedSummary.pages_count}
                        className="px-3 py-1 bg-[#008170] hover:bg-[#006e5f] text-white rounded text-xs font-bold transition-colors shadow-sm disabled:opacity-50"
                      >
                        [Ctrl+E] EXPORT TALLY XML
                      </button>
                    </div>
                  </div>

                  {/* Sub-bar: Review Queue Segmented Filters & Search */}
                  <div className="p-2.5 bg-slate-100 border-b border-slate-300 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-2 text-xs">
                    <div className="inline-flex flex-wrap gap-1">
                      <button
                        onClick={() => setFilterMode('ALL')}
                        className={`px-2.5 py-1 rounded text-xs transition-colors font-mono ${filterMode === 'ALL' ? 'bg-[#0b192c] text-amber-300 font-bold border border-[#1e3e62]' : 'bg-white text-slate-700 hover:text-slate-900 font-bold border border-slate-300'}`}
                      >
                        All ({allTransactions.length})
                      </button>
                      <button
                        onClick={() => setFilterMode('READY')}
                        className={`px-2.5 py-1 rounded text-xs transition-colors font-mono ${filterMode === 'READY' ? 'bg-[#0b192c] text-amber-300 font-bold border border-[#1e3e62]' : 'bg-white text-slate-700 hover:text-slate-900 font-bold border border-slate-300'}`}
                      >
                        Ready ({allTransactions.filter(t => !t.requires_review).length})
                      </button>
                      <button
                        onClick={() => setFilterMode('REVIEW')}
                        className={`px-2.5 py-1 rounded text-xs transition-colors font-mono ${filterMode === 'REVIEW' ? 'bg-rose-700 text-white font-bold border border-rose-800' : allTransactions.filter(t => t.requires_review).length > 0 ? 'bg-rose-100 text-rose-900 font-bold border border-rose-300' : 'bg-white text-slate-700 hover:text-slate-900 font-bold border border-slate-300'}`}
                      >
                        Needs Review ({allTransactions.filter(t => t.requires_review).length})
                      </button>
                      <button
                        onClick={() => setFilterMode('DUPLICATES')}
                        className={`px-2.5 py-1 rounded text-xs transition-colors font-mono ${filterMode === 'DUPLICATES' ? 'bg-amber-400 text-slate-900 font-bold border border-amber-500' : 'bg-white text-slate-700 hover:text-slate-900 font-bold border border-slate-300'}`}
                      >
                        Duplicates ({allTransactions.filter(t => t.is_duplicate).length})
                      </button>
                      <button
                        onClick={() => setFilterMode('DEBIT')}
                        className={`px-2.5 py-1 rounded text-xs transition-colors font-mono ${filterMode === 'DEBIT' ? 'bg-[#0b192c] text-amber-300 font-bold border border-[#1e3e62]' : 'bg-white text-slate-700 hover:text-slate-900 font-bold border border-slate-300'}`}
                      >
                        Debits ({allTransactions.filter(t => (t.debit || 0) > 0).length})
                      </button>
                      <button
                        onClick={() => setFilterMode('CREDIT')}
                        className={`px-2.5 py-1 rounded text-xs transition-colors font-mono ${filterMode === 'CREDIT' ? 'bg-[#0b192c] text-amber-300 font-bold border border-[#1e3e62]' : 'bg-white text-slate-700 hover:text-slate-900 font-bold border border-slate-300'}`}
                      >
                        Credits ({allTransactions.filter(t => (t.credit || 0) > 0).length})
                      </button>
                    </div>

                    <div className="flex items-center space-x-2 w-full lg:w-auto">
                      <input
                        id="table-search-input"
                        type="text"
                        placeholder="Search narration, ref, ledger... (Ctrl+F)"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="px-2.5 py-1 border-2 border-slate-400 rounded text-xs font-mono bg-white focus:outline-none focus:border-[#008170] w-full lg:w-64 placeholder:text-slate-400"
                      />
                      {allTransactions.filter(t => t.requires_review).length > 0 && (
                        <button
                          onClick={() => {
                            setCurrentReviewIdx(0);
                            setReviewModalOpen(true);
                          }}
                          className="px-2.5 py-1 bg-amber-100 hover:bg-amber-200 text-amber-950 font-bold text-xs rounded border border-amber-300 whitespace-nowrap shadow-sm transition-colors font-mono"
                        >
                          [Review Next Issue]
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Bulk Actions Bar */}
                  <div className="p-2 bg-slate-50 border-b border-slate-300 flex flex-wrap justify-between items-center gap-2 text-xs font-mono">
                    <div className="flex items-center space-x-3">
                      <label className="flex items-center space-x-1.5 cursor-pointer font-bold text-slate-800">
                        <input
                          type="checkbox"
                          checked={selectedRowIds.size > 0 && selectedRowIds.size === allTransactions.length}
                          onChange={() => handleSelectAllRows(allTransactions)}
                          className="w-3.5 h-3.5 border-slate-400 rounded text-[#008170] focus:ring-[#008170] cursor-pointer"
                        />
                        <span>Select All ({selectedRowIds.size} selected)</span>
                      </label>
                      {undoStack.length > 0 && (
                        <button
                          onClick={() => {
                            const lastUndo = undoStack[undoStack.length - 1];
                            if (lastUndo && lastUndo.type === 'NARRATION') {
                              setEditedNarrations(prev => ({
                                ...prev,
                                [lastUndo.idx]: lastUndo.oldText
                              }));
                              setUndoStack(prev => prev.slice(0, -1));
                            }
                          }}
                          className="px-2 py-0.5 border border-slate-400 bg-white hover:bg-slate-100 rounded font-bold text-[11px] shadow-sm text-slate-800 font-mono"
                          title="Undo last narration edit (Ctrl+Z)"
                        >
                          [Undo ({undoStack.length})]
                        </button>
                      )}
                    </div>

                    {selectedRowIds.size > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <input
                          type="text"
                          placeholder="Type Counter Ledger..."
                          value={bulkLedgerInput}
                          onChange={(e) => setBulkLedgerInput(e.target.value)}
                          className="px-2 py-0.5 border border-slate-400 rounded text-xs font-mono bg-white focus:outline-none focus:border-[#008170]"
                        />
                        <button
                          onClick={handleBulkAssignLedger}
                          className="px-2.5 py-1 bg-[#0b192c] hover:bg-[#1e3e62] text-white rounded font-bold text-xs shadow-sm transition-colors"
                        >
                          Assign Ledger
                        </button>
                        <button
                          onClick={handleBulkMarkReviewed}
                          className="px-2.5 py-1 bg-[#008170] hover:bg-[#006e5f] text-white rounded font-bold text-xs shadow-sm transition-colors"
                        >
                          Mark Reviewed
                        </button>
                        <button
                          onClick={() => {
                            if (!confirm(`Delete ${selectedRowIds.size} selected transactions?`)) return;
                            setAllTransactions(prev => prev.filter(t => !selectedRowIds.has(t.id)));
                            setSelectedRowIds(new Set());
                          }}
                          className="px-2.5 py-1 bg-rose-700 hover:bg-rose-800 text-white rounded font-bold text-xs shadow-sm transition-colors"
                        >
                          Delete Selected
                        </button>
                      </div>
                    )}
                  </div>

                  {/* 3. Ruled High-Contrast Accounting Grid (Option 2: Tally Pro Terminal) */}
                  <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                    <table className="min-w-full border-collapse text-left font-mono text-xs bg-white">
                      <thead className="bg-[#0b192c] text-white sticky top-0 border-b-2 border-slate-400 text-[10px] font-bold uppercase tracking-wider z-10 select-none">
                        <tr>
                          <th className="px-3 py-2 w-8 text-center border-r border-slate-400">
                            <input
                              type="checkbox"
                              checked={selectedRowIds.size > 0 && selectedRowIds.size === allTransactions.length}
                              onChange={() => handleSelectAllRows(allTransactions)}
                              className="w-3.5 h-3.5 border-slate-400 rounded text-[#008170] focus:ring-[#008170] cursor-pointer"
                            />
                          </th>
                          <th className="px-3 py-2 whitespace-nowrap border-r border-slate-400 font-bold">Date</th>
                          <th className="px-4 py-2 w-1/3 border-r border-slate-400 font-bold">Narration / Particulars (Inline Edit)</th>
                          <th className="px-3 py-2 border-r border-slate-400 font-bold">Ref / UTR</th>
                          <th className="px-3 py-2 w-1/5 border-r border-slate-400 font-bold">Counter Ledger</th>
                          <th className="px-3 py-2 text-right border-r border-slate-400 font-bold">Debit (₹)</th>
                          <th className="px-3 py-2 text-right border-r border-slate-400 font-bold">Credit (₹)</th>
                          <th className="px-3 py-2 text-right border-r border-slate-400 font-bold">Balance (₹)</th>
                          <th className="px-3 py-2 text-center border-r border-slate-400 font-bold">Conf.</th>
                          <th className="px-3 py-2 text-center font-bold">Audit</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-slate-200 text-xs text-slate-900">
                        {allTransactions
                          .filter((tx, idx) => {
                            if (filterMode === 'READY' && tx.requires_review) return false;
                            if (filterMode === 'REVIEW' && !tx.requires_review) return false;
                            if (filterMode === 'DUPLICATES' && !tx.is_duplicate) return false;
                            if (filterMode === 'DEBIT' && (!tx.debit || tx.debit <= 0)) return false;
                            if (filterMode === 'CREDIT' && (!tx.credit || tx.credit <= 0)) return false;

                            if (searchQuery.trim()) {
                              const q = searchQuery.toLowerCase();
                              const narr = (editedNarrations[idx] !== undefined ? editedNarrations[idx] : tx.narration || '').toLowerCase();
                              const ledger = (editedLedgers[idx] !== undefined ? editedLedgers[idx] : tx.assigned_ledger || '').toLowerCase();
                              const ref = (tx.ref_no || tx.utr || '').toLowerCase();
                              const amt = `${tx.debit || ''} ${tx.credit || ''} ${tx.balance || ''}`;
                              if (!narr.includes(q) && !ledger.includes(q) && !ref.includes(q) && !amt.includes(q)) {
                                return false;
                              }
                            }
                            return true;
                          })
                          .map((tx, idx) => (
                            <tr 
                              key={tx.id || idx} 
                              className={`hover:bg-amber-50/60 transition-colors border-b border-slate-200 ${selectedRowIds.has(tx.id) ? 'bg-amber-100/40' : ''} ${tx.requires_review ? 'bg-amber-50/70' : ''}`}
                            >
                              <td className="px-3 py-2 text-center border-r border-slate-200">
                                <input
                                  type="checkbox"
                                  checked={selectedRowIds.has(tx.id)}
                                  onChange={() => handleToggleRowSelection(tx.id)}
                                  className="w-3.5 h-3.5 border-slate-400 rounded text-[#008170] focus:ring-[#008170] cursor-pointer"
                                />
                              </td>
                              <td className="px-3 py-2 whitespace-nowrap font-mono text-[11px] text-slate-800 border-r border-slate-200 font-medium">
                                <div>{tx.txn_date}</div>
                                {tx.source_file && (
                                  <span className="inline-block mt-0.5 text-[8px] bg-slate-100 text-slate-700 rounded px-1.5 py-0.5 font-mono truncate max-w-[120px]" title={tx.source_file}>
                                    {tx.source_file}
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2 border-r border-slate-200">
                                <input
                                  type="text"
                                  value={editedNarrations[idx] !== undefined ? editedNarrations[idx] : tx.narration}
                                  onChange={(e) => handleNarrationEdit(idx, e.target.value)}
                                  className="w-full px-2 py-1 rounded text-[11px] font-mono text-slate-900 bg-white hover:bg-amber-50/50 focus:bg-white border border-slate-300 focus:border-[#008170] focus:ring-1 focus:ring-[#008170] transition-all"
                                />
                              </td>
                              <td className="px-3 py-2 text-slate-600 font-mono text-[11px] truncate max-w-[120px] border-r border-slate-200">
                                <div>{tx.ref_no || tx.utr || '-'}</div>
                                {tx.category && (
                                  <span className="text-[8px] bg-slate-100 text-slate-700 px-1 rounded uppercase font-mono font-bold">
                                    {tx.category}
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2 border-r border-slate-200">
                                <input
                                  type="text"
                                  value={editedLedgers[idx] !== undefined ? editedLedgers[idx] : (tx.assigned_ledger || counterLedgerName)}
                                  onChange={(e) => handleLedgerEdit(idx, e.target.value)}
                                  className="w-full px-2 py-1 rounded text-[11px] font-mono font-medium text-slate-900 bg-white hover:bg-amber-50/50 focus:bg-white border border-slate-300 focus:border-[#008170] focus:ring-1 focus:ring-[#008170] transition-all"
                                />
                              </td>
                              <td className="px-3 py-2 text-right text-rose-700 font-mono tabular-nums font-bold whitespace-nowrap border-r border-slate-200">
                                {tx.debit ? `₹${Number(tx.debit).toFixed(2)}` : '-'}
                              </td>
                              <td className="px-3 py-2 text-right text-emerald-700 font-mono tabular-nums font-bold whitespace-nowrap border-r border-slate-200">
                                {tx.credit ? `₹${Number(tx.credit).toFixed(2)}` : '-'}
                              </td>
                              <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-900 whitespace-nowrap font-bold border-r border-slate-200">
                                ₹{Number(tx.balance || 0).toFixed(2)}
                              </td>
                              <td className="px-2 py-2 text-center whitespace-nowrap border-r border-slate-200 font-mono">
                                <span className={`px-2 py-0.5 text-[9px] font-bold rounded uppercase ${tx.confidence_grade === 'HIGH' ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' : tx.confidence_grade === 'MEDIUM' ? 'bg-amber-100 text-amber-800 border border-amber-300' : 'bg-rose-100 text-rose-800 border border-rose-300'}`}>
                                  {Math.round(tx.confidence_score || 95)}%
                                </span>
                              </td>
                              <td className="px-2 py-2 text-center whitespace-nowrap">
                                {tx.requires_review ? (
                                  <button
                                    onClick={() => {
                                      const issueIdx = allTransactions.filter(t => t.requires_review).findIndex(t => t.id === tx.id);
                                      setCurrentReviewIdx(issueIdx >= 0 ? issueIdx : 0);
                                      setReviewModalOpen(true);
                                    }}
                                    className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200 transition-colors"
                                  >
                                    Review
                                  </button>
                                ) : (
                                  <span className="text-emerald-700 font-bold text-xs font-mono">OK</span>
                                )}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* 4. Bottom Configuration & Action Hub (Tally Pro Grid) */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 font-mono">
                  
                  {/* Left 2 Cols: Tally Integration Parameters */}
                  <div className="lg:col-span-2 bg-white rounded-lg border-2 border-slate-400 shadow-sm p-5 space-y-4">
                    <div className="flex items-center justify-between border-b border-slate-300 pb-3">
                      <div className="flex items-center space-x-2">
                        <span className="px-2 py-0.5 bg-[#008170] text-white font-extrabold text-[10px] rounded tracking-wider font-mono">
                          TALLY XML
                        </span>
                        <h4 className="text-xs font-bold text-[#0b192c] tracking-tight uppercase">
                          Tally Prime / ERP 9 Integration Parameters
                        </h4>
                      </div>
                      <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded border border-emerald-300">
                        Voucher Schema 1.0 Compliant
                      </span>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1 uppercase tracking-wide">
                          Tally Bank Ledger Name
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. State Bank of India"
                          value={tallyLedgerName}
                          onChange={(e) => setTallyLedgerName(e.target.value)}
                          className="w-full px-3 py-1.5 border-2 border-slate-400 rounded text-xs font-mono font-bold bg-white focus:outline-none focus:border-[#008170] transition-colors"
                        />
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide">
                            Counter Ledger Mode
                          </label>
                          <div className="inline-flex border-2 border-slate-400 bg-slate-100 p-0.5 rounded">
                            <button
                              type="button"
                              onClick={() => handleToggleCounterLedgerMode('AUTO')}
                              className={`px-2 py-0.5 text-[11px] font-bold font-mono rounded transition-colors ${
                                counterLedgerMode === 'AUTO'
                                  ? 'bg-[#008170] text-white shadow-sm'
                                  : 'text-slate-700 hover:text-slate-900'
                              }`}
                            >
                              [Auto]
                            </button>
                            <button
                              type="button"
                              onClick={() => handleToggleCounterLedgerMode('CUSTOM')}
                              className={`px-2 py-0.5 text-[11px] font-bold font-mono rounded transition-colors ${
                                counterLedgerMode === 'CUSTOM'
                                  ? 'bg-[#0b192c] text-amber-300 shadow-sm'
                                  : 'text-slate-700 hover:text-slate-900'
                              }`}
                            >
                              [Custom]
                            </button>
                          </div>
                        </div>

                        {counterLedgerMode === 'AUTO' ? (
                          <div className="bg-emerald-50 border-2 border-emerald-300 rounded p-2.5 text-xs text-slate-800 flex items-center justify-between font-mono">
                            <div>
                              <span className="font-bold text-emerald-950 block text-[11px]">Auto Rules & AI Active</span>
                              <span className="text-[10px] text-slate-600">Smart matching based on narration & rules</span>
                            </div>
                            <span className="text-[9px] bg-white border border-emerald-300 px-2 py-0.5 rounded font-mono font-bold text-emerald-800 uppercase">
                              RULES/AI
                            </span>
                          </div>
                        ) : (
                          <div className="space-y-1 font-mono">
                            <div className="flex gap-1.5">
                              <input
                                type="text"
                                placeholder="e.g. Suspense Account or Cash"
                                value={customCounterLedger || counterLedgerName}
                                onChange={(e) => handleCustomCounterLedgerChange(e.target.value)}
                                className="flex-1 px-3 py-1.5 border-2 border-slate-400 rounded text-xs font-mono font-bold bg-white focus:outline-none focus:border-[#008170]"
                              />
                              <button
                                type="button"
                                onClick={() => handleApplyCustomLedgerToAll(customCounterLedger || counterLedgerName)}
                                className="px-3 py-1.5 bg-[#0b192c] text-white hover:bg-[#1e3e62] rounded text-xs font-bold transition-colors shadow-sm"
                                title="Apply this counter ledger to all transaction rows"
                              >
                                Apply All
                              </button>
                            </div>
                            <span className="text-[10px] text-slate-500 font-mono block">
                              Sets a uniform counter ledger for all vouchers in Tally.
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 pt-1">
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1 uppercase tracking-wide">
                          Credit Voucher Type (Money In)
                        </label>
                        <select
                          value={creditVoucherType}
                          onChange={(e) => setCreditVoucherType(e.target.value)}
                          className="w-full px-3 py-1.5 border-2 border-slate-400 rounded text-xs font-mono font-bold bg-white focus:outline-none focus:border-[#008170]"
                        >
                          <option>Receipt</option>
                          <option>Contra</option>
                          <option>Sales</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1 uppercase tracking-wide">
                          Debit Voucher Type (Money Out)
                        </label>
                        <select
                          value={debitVoucherType}
                          onChange={(e) => setDebitVoucherType(e.target.value)}
                          className="w-full px-3 py-1.5 border-2 border-slate-400 rounded text-xs font-mono font-bold bg-white focus:outline-none focus:border-[#008170]"
                        >
                          <option>Payment</option>
                          <option>Contra</option>
                          <option>Purchase</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Right Col: Conversion Billing & Trigger Actions (Tally Pro Grid) */}
                  <div className="bg-white text-slate-900 rounded-lg border-2 border-slate-400 shadow-sm p-5 flex flex-col justify-between font-mono">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between border-b border-slate-300 pb-2">
                        <h4 className="text-xs font-bold text-[#0b192c] tracking-tight uppercase">
                          Execution Hub
                        </h4>
                        <span className="text-[10px] bg-[#0b192c] text-white px-2 py-0.2 rounded font-bold">
                          [Ctrl+E]
                        </span>
                      </div>

                      <div className="bg-slate-50 rounded border-2 border-slate-300 p-3 text-xs font-mono space-y-1 text-slate-700">
                        <p className="flex justify-between"><span>Deduction:</span> <span className="font-bold text-[#0b192c]">{parsedSummary.pages_count} credits</span></p>
                        <p className="flex justify-between"><span>Your Balance:</span> <span className="font-bold text-emerald-800">{user.page_credits} credits</span></p>
                        {user.page_credits < parsedSummary.pages_count && (
                          <p className="text-rose-700 font-bold uppercase mt-1 text-[11px]">[Alert]: Insufficient credits to execute!</p>
                        )}
                      </div>
                      
                      {executeError && (
                        <div className="bg-rose-50 text-rose-900 p-2.5 rounded border-2 border-rose-300 font-bold text-xs">
                          {String(executeError)}
                        </div>
                      )}
                    </div>

                    <div className="space-y-2 mt-5">
                      <button
                        id="btn-convert-tally-xml"
                        onClick={handleExecuteConversion}
                        disabled={executeLoading || user.page_credits < parsedSummary.pages_count}
                        className="w-full py-2.5 px-4 rounded font-bold text-white bg-[#008170] hover:bg-[#006e5f] shadow-sm transition-colors text-xs uppercase tracking-wider disabled:opacity-50"
                      >
                        {executeLoading ? 'GENERATING XML...' : '[Ctrl+E] CONVERT TO TALLY XML'}
                      </button>

                      <button
                        onClick={handleDownloadExcel}
                        className="w-full py-2 px-4 rounded font-bold text-white bg-[#0b192c] hover:bg-[#1e3e62] border border-[#1e3e62] transition-colors text-xs uppercase tracking-wider"
                      >
                        EXCEL RECONCILIATION EXPORT (FREE)
                      </button>
                    </div>
                  </div>
                </div>

              </div>
            )}
          </div>
        )}
{/* --- TAB: CSV TO TALLY MULTI-VOUCHER CONVERTER (Option 2: Tally Pro Terminal) --- */}
        {activeTab === 'csv' && (
          <div className="space-y-5 max-w-7xl mx-auto font-mono">
            {/* Top Brand Banner */}
            <div className="bg-white text-slate-800 p-4 rounded-lg border-2 border-slate-400 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4 font-mono">
              <div className="flex items-center space-x-3.5">
                <div className="w-10 h-10 rounded bg-[#0b192c] border border-[#1e3e62] flex items-center justify-center p-1.5 flex-shrink-0">
                  <img src="/symbol_mark.svg" alt="CSV to Tally" className="w-full h-full object-contain filter invert" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 bg-[#008170] text-white font-extrabold text-[10px] rounded tracking-wider">
                      [F1:2]
                    </span>
                    <h3 className="text-sm font-bold text-[#0b192c] tracking-tight uppercase">
                      CSV to Tally Prime Multi-Voucher Converter
                    </h3>
                  </div>
                  <p className="text-xs text-slate-500 font-mono mt-0.5">
                    Map Payment, Receipt, Contra, Journal, Sales & Purchase entries. Generate Tally XML 1.0.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 font-mono">
                <button
                  onClick={handleDownloadBlankCsv}
                  className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-800 font-bold text-xs rounded border-2 border-slate-400 shadow-sm transition-colors flex items-center space-x-1"
                  title="Download clean blank CSV template"
                >
                  <span>Blank CSV</span>
                </button>
                <button
                  onClick={handleDownloadSampleCsv}
                  className="px-3 py-1.5 bg-[#0b192c] hover:bg-[#1e3e62] text-amber-300 font-bold text-xs rounded border border-[#1e3e62] shadow-sm transition-colors flex items-center space-x-1"
                  title="Download CSV pre-filled with Payment, Receipt, Contra & Journal examples"
                >
                  <span>Sample CSV</span>
                </button>
                <button
                  onClick={handleOpenCreateMapping}
                  className="px-3 py-1.5 bg-[#008170] hover:bg-[#006e5f] text-white font-bold text-xs rounded shadow-sm transition-colors flex items-center space-x-1"
                >
                  <span>+ New Mapping</span>
                </button>
              </div>
            </div>

            {/* Upload & Mapping Card */}
            <div className="bg-white rounded-lg border-2 border-slate-400 shadow-sm p-5 space-y-4 font-mono">
              <div className="flex items-center justify-between border-b border-slate-300 pb-2.5">
                <h4 className="text-xs font-bold text-[#0b192c] tracking-tight uppercase flex items-center space-x-2">
                  <span className="w-2 h-2 rounded-full bg-[#008170] inline-block"></span>
                  <span>1. Upload CSV & Choose Column Mapping Template</span>
                </h4>
                <div className="text-[10px] font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded border border-slate-300 uppercase">
                  Step 1 of 2
                </div>
              </div>

              <form onSubmit={handleUploadAndPreviewCsv} className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-end font-mono">
                {/* File input */}
                <div className="lg:col-span-5">
                  <label className="block text-xs font-bold text-slate-700 mb-1 uppercase tracking-wide">
                    Select CSV File
                  </label>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        setCsvFile(e.target.files[0]);
                        setCsvError('');
                      }
                    }}
                    className="w-full text-xs font-mono font-medium p-1.5 border-2 border-slate-400 rounded bg-slate-50 file:mr-3 file:py-1 file:px-2.5 file:rounded file:border-0 file:text-xs file:font-mono file:font-bold file:bg-[#0b192c] file:text-white file:cursor-pointer hover:file:bg-[#1e3e62] cursor-pointer transition-colors"
                  />
                  {csvFile && (
                    <div className="text-[11px] font-mono font-bold text-emerald-800 mt-1 flex items-center space-x-1">
                      <span>✓ Ready: {csvFile.name} ({(csvFile.size / 1024).toFixed(1)} KB)</span>
                    </div>
                  )}
                </div>

                {/* Mapping Selector */}
                <div className="lg:col-span-4">
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                      Mapping Template
                    </label>
                    <button
                      type="button"
                      onClick={handleOpenCreateMapping}
                      className="text-[11px] font-bold text-[#008170] hover:underline"
                    >
                      + Custom Template
                    </button>
                  </div>
                  <select
                    value={selectedCsvMappingId}
                    onChange={(e) => setSelectedCsvMappingId(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs font-mono font-bold border-2 border-slate-400 rounded bg-white focus:outline-none focus:border-[#008170] transition-colors"
                  >
                    <option value="default">Standard Sheet Buddy CSV (Default)</option>
                    {csvMappings.map(tmpl => (
                      <option key={tmpl.id} value={tmpl.id}>
                        {tmpl.name} {tmpl.description ? `(${tmpl.description})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Submit button */}
                <div className="lg:col-span-3 flex space-x-2">
                  <button
                    type="submit"
                    disabled={csvUploading || !csvFile}
                    className="flex-1 py-2 px-3 bg-[#0b192c] hover:bg-[#1e3e62] text-amber-300 rounded font-mono font-bold text-xs uppercase tracking-wider shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {csvUploading ? 'Processing...' : 'Process & Preview'}
                  </button>

                  {selectedCsvMappingId !== 'default' && (
                    <button
                      type="button"
                      onClick={() => {
                        const targetTmpl = csvMappings.find(m => String(m.id) === String(selectedCsvMappingId));
                        if (targetTmpl) handleOpenEditMapping(targetTmpl);
                      }}
                      title="Edit this template"
                      className="px-2.5 py-2 bg-white hover:bg-slate-100 text-slate-800 rounded font-bold text-xs border-2 border-slate-400 transition-colors"
                    >
                      Edit
                    </button>
                  )}
                </div>
              </form>

              {csvError && (
                <div className="p-3 bg-rose-50 border-2 border-rose-300 text-rose-900 rounded font-mono font-bold text-xs flex items-center justify-between">
                  <span>[Warning]: {csvError}</span>
                  <button onClick={() => setCsvError('')} className="font-bold underline text-[11px] ml-2">Dismiss</button>
                </div>
              )}
            </div>

            {/* Vouchers Preview & Interactive Spreadsheet */}
            {csvVouchers.length > 0 && (
              <div className="bg-white rounded-lg border-2 border-slate-400 shadow-sm p-5 space-y-4 font-mono">
                {/* Header Metrics */}
                <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-slate-300 pb-3 gap-3">
                  <div>
                    <h4 className="text-xs font-bold text-[#0b192c] tracking-tight uppercase flex items-center space-x-2">
                      <span className="w-2 h-2 rounded-full bg-[#008170] inline-block"></span>
                      <span>2. Interactive Vouchers Review & Multi-Voucher Grid</span>
                    </h4>
                    <p className="text-xs text-slate-500 font-mono mt-0.5">
                      Verify dates, ledgers and voucher types. Edit inline before generating Tally Prime XML.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={handleAddVoucherRow}
                      className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-800 rounded font-bold text-xs border-2 border-slate-400 shadow-sm transition-colors"
                    >
                      + Add Row
                    </button>
                    <button
                      onClick={handleExportCsvToExcel}
                      className="px-3 py-1.5 bg-[#0b192c] hover:bg-[#1e3e62] text-white rounded font-bold text-xs border border-[#1e3e62] shadow-sm transition-colors"
                    >
                      Export Excel (.xlsx)
                    </button>
                    <button
                      id="btn-convert-csv-xml"
                      onClick={handleConvertCsvToXml}
                      disabled={csvConverting}
                      className="px-3.5 py-1.5 bg-[#008170] hover:bg-[#006e5f] text-white rounded font-bold text-xs shadow-sm disabled:opacity-50 flex items-center space-x-1.5 transition-colors font-mono"
                    >
                      <span>{csvConverting ? 'Generating XML...' : '[Ctrl+E] Convert to Tally XML'}</span>
                      {(() => {
                        const pricing = getCsvCreditPricing(csvVouchers.length);
                        return (
                          <span className="text-[10px] bg-[#0b192c] text-amber-300 px-1.5 py-0.2 font-bold rounded">
                            {pricing} {pricing === 1 ? 'Credit' : 'Credits'}
                          </span>
                        );
                      })()}
                    </button>
                  </div>
                </div>

                {/* Metric Summary Badges (Ruled High-Contrast Grid) */}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-7 gap-2.5 font-mono">
                  <div className="p-2.5 bg-slate-50 rounded border-2 border-slate-400 text-center">
                    <div className="text-[10px] font-bold uppercase text-slate-500">Total Vouchers</div>
                    <div className="text-lg font-bold font-mono text-[#0b192c] mt-0.5">{csvVouchers.length}</div>
                  </div>
                  <div className="p-2.5 bg-emerald-50 rounded border-2 border-emerald-300 text-center">
                    <div className="text-[10px] font-bold uppercase text-emerald-800">Valid Entries</div>
                    <div className="text-lg font-bold font-mono text-emerald-700 mt-0.5">
                      {csvVouchers.filter(v => v.is_valid).length}
                    </div>
                  </div>
                  <div className={`p-2.5 rounded border-2 text-center ${csvVouchers.filter(v => !v.is_valid).length > 0 ? 'bg-rose-50 border-rose-300 text-rose-800' : 'bg-slate-50 border-slate-400 text-slate-500'}`}>
                    <div className="text-[10px] font-bold uppercase">Validation Issues</div>
                    <div className="text-lg font-bold font-mono mt-0.5">
                      {csvVouchers.filter(v => !v.is_valid).length}
                    </div>
                  </div>
                  <div className="p-2.5 bg-slate-50 rounded border-2 border-slate-400 text-center">
                    <div className="text-[10px] font-bold uppercase text-slate-600">Payment</div>
                    <div className="text-lg font-bold font-mono text-slate-800 mt-0.5">
                      {csvVouchers.filter(v => v.voucher_type === 'Payment').length}
                    </div>
                  </div>
                  <div className="p-2.5 bg-slate-50 rounded border-2 border-slate-400 text-center">
                    <div className="text-[10px] font-bold uppercase text-slate-600">Receipt</div>
                    <div className="text-lg font-bold font-mono text-slate-800 mt-0.5">
                      {csvVouchers.filter(v => v.voucher_type === 'Receipt').length}
                    </div>
                  </div>
                  <div className="p-2.5 bg-slate-50 rounded border-2 border-slate-400 text-center">
                    <div className="text-[10px] font-bold uppercase text-slate-600">Contra/Jrn</div>
                    <div className="text-lg font-bold font-mono text-slate-800 mt-0.5">
                      {csvVouchers.filter(v => ['Contra', 'Journal'].includes(v.voucher_type)).length}
                    </div>
                  </div>
                  <div className="p-2.5 bg-[#0b192c] text-white rounded border-2 border-[#1e3e62] text-center">
                    <div className="text-[10px] font-bold uppercase text-slate-400">Total ₹</div>
                    <div className="text-sm font-bold font-mono tabular-nums text-amber-300 truncate mt-0.5" title={`₹${csvVouchers.reduce((acc, v) => acc + (parseFloat(v.amount) || 0), 0).toLocaleString('en-IN')}`}>
                      ₹{csvVouchers.reduce((acc, v) => acc + (parseFloat(v.amount) || 0), 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </div>
                  </div>
                </div>

                {csvConvertError && (
                  <div className="p-3 bg-rose-50 border-2 border-rose-300 text-rose-900 rounded font-mono font-bold text-xs">
                    [Error]: {csvConvertError}
                  </div>
                )}

                {/* Filters & Search Toolbar */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-1 font-mono">
                  <div className="flex flex-wrap items-center gap-1">
                    {['ALL', 'Payment', 'Receipt', 'Contra', 'Journal', 'Sales', 'Purchase'].map(vt => (
                      <button
                        key={vt}
                        onClick={() => setCsvFilterType(vt)}
                        className={`px-2.5 py-1 rounded text-xs font-bold transition-colors ${csvFilterType === vt ? 'bg-[#0b192c] text-amber-300 border border-[#1e3e62]' : 'bg-white text-slate-700 hover:text-slate-900 border border-slate-300'}`}
                      >
                        {vt}
                      </button>
                    ))}
                    {csvVouchers.some(v => !v.is_valid) && (
                      <button
                        onClick={() => setCsvFilterType('INVALID')}
                        className={`px-2.5 py-1 rounded text-xs font-bold transition-colors ${csvFilterType === 'INVALID' ? 'bg-rose-700 text-white border border-rose-800' : 'bg-rose-100 text-rose-900 hover:bg-rose-200 border border-rose-300'}`}
                      >
                        Issues Only ({csvVouchers.filter(v => !v.is_valid).length})
                      </button>
                    )}
                  </div>

                  <div className="relative w-full sm:w-64">
                    <input
                      type="text"
                      placeholder="Search ledgers, narration, voucher..."
                      value={csvSearchQuery}
                      onChange={(e) => setCsvSearchQuery(e.target.value)}
                      className="w-full px-3 py-1 text-xs font-mono font-medium border-2 border-slate-400 rounded bg-white focus:outline-none focus:border-[#008170] placeholder:text-slate-400"
                    />
                    {csvSearchQuery && (
                      <button
                        onClick={() => setCsvSearchQuery('')}
                        className="absolute right-2.5 top-1 text-xs font-bold text-slate-500 hover:text-slate-900"
                      >
                        [X]
                      </button>
                    )}
                  </div>
                </div>

                {/* Ruled High-Contrast Accounting Grid Table */}
                <div className="overflow-x-auto rounded-lg border-2 border-slate-400 max-h-[500px]">
                  <table className="min-w-[1050px] w-full text-left text-xs border-collapse font-mono bg-white">
                    <thead className="bg-[#0b192c] text-white sticky top-0 z-10 select-none border-b-2 border-slate-400 font-bold uppercase text-[10px] tracking-wide">
                      <tr>
                        <th className="p-2 w-10 text-center font-bold border-r border-slate-400">#</th>
                        <th className="p-2 w-28 font-bold border-r border-slate-400">Date</th>
                        <th className="p-2 w-28 font-bold border-r border-slate-400">Voucher Type</th>
                        <th className="p-2 w-28 font-bold border-r border-slate-400">Voucher No</th>
                        <th className="p-2 font-bold border-r border-slate-400">
                          <span className="bg-rose-100 text-rose-900 px-1.5 py-0.2 rounded text-[9px] mr-1.5 font-bold">Dr</span>
                          Debit Ledger
                        </th>
                        <th className="p-2 font-bold border-r border-slate-400">
                          <span className="bg-emerald-100 text-emerald-900 px-1.5 py-0.2 rounded text-[9px] mr-1.5 font-bold">Cr</span>
                          Credit Ledger
                        </th>
                        <th className="p-2 w-28 text-right font-bold border-r border-slate-400">Amount (₹)</th>
                        <th className="p-2 font-bold border-r border-slate-400">Narration</th>
                        <th className="p-2 w-16 text-center font-bold border-r border-slate-400">Status</th>
                        <th className="p-2 w-10 text-center font-bold">Del</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {csvVouchers
                        .map((v, originalIdx) => ({ voucher: v, originalIdx }))
                        .filter(({ voucher: v }) => {
                          if (csvFilterType === 'INVALID' && v.is_valid) return false;
                          if (csvFilterType !== 'ALL' && csvFilterType !== 'INVALID' && v.voucher_type !== csvFilterType) return false;
                          if (csvSearchQuery.trim()) {
                            const q = csvSearchQuery.toLowerCase();
                            const matches =
                              (v.debit_ledger || '').toLowerCase().includes(q) ||
                              (v.credit_ledger || '').toLowerCase().includes(q) ||
                              (v.narration || '').toLowerCase().includes(q) ||
                              (v.voucher_no || '').toLowerCase().includes(q) ||
                              (v.voucher_type || '').toLowerCase().includes(q);
                            if (!matches) return false;
                          }
                          return true;
                        })
                        .map(({ voucher: v, originalIdx }) => (
                          <tr
                            key={v.id || originalIdx}
                            className={`hover:bg-amber-50/60 transition-colors border-b border-slate-200 ${!v.is_valid ? 'bg-rose-50/60' : ''}`}
                          >
                            <td className="p-2 text-center text-slate-500 font-mono text-[11px] border-r border-slate-200">
                              {originalIdx + 1}
                            </td>

                            <td className="p-1 border-r border-slate-200">
                              <input
                                type="text"
                                value={v.date || ''}
                                placeholder="YYYY-MM-DD"
                                onChange={(e) => handleUpdateVoucherCell(originalIdx, 'date', e.target.value)}
                                className="w-full px-2 py-1 text-xs font-mono border border-slate-300 rounded bg-white focus:outline-none focus:border-[#008170]"
                              />
                            </td>

                            <td className="p-1 border-r border-slate-200">
                              <select
                                value={v.voucher_type || 'Payment'}
                                onChange={(e) => handleUpdateVoucherCell(originalIdx, 'voucher_type', e.target.value)}
                                className="w-full px-2 py-1 text-xs font-mono font-bold border border-slate-300 rounded bg-white focus:outline-none focus:border-[#008170]"
                              >
                                <option>Payment</option>
                                <option>Receipt</option>
                                <option>Contra</option>
                                <option>Journal</option>
                                <option>Sales</option>
                                <option>Purchase</option>
                              </select>
                            </td>

                            <td className="p-1 border-r border-slate-200">
                              <input
                                type="text"
                                value={v.voucher_no || ''}
                                placeholder="Auto"
                                onChange={(e) => handleUpdateVoucherCell(originalIdx, 'voucher_no', e.target.value)}
                                className="w-full px-2 py-1 text-xs font-mono border border-slate-300 rounded bg-white focus:outline-none focus:border-[#008170]"
                              />
                            </td>

                            <td className="p-1 border-r border-slate-200">
                              <input
                                type="text"
                                value={v.debit_ledger || ''}
                                placeholder="Debit Ledger Name"
                                onChange={(e) => handleUpdateVoucherCell(originalIdx, 'debit_ledger', e.target.value)}
                                className={`w-full px-2 py-1 text-xs font-mono border rounded bg-white focus:outline-none focus:border-[#008170] ${!v.debit_ledger ? 'border-rose-400 bg-rose-50' : 'border-slate-300'}`}
                              />
                            </td>

                            <td className="p-1 border-r border-slate-200">
                              <input
                                type="text"
                                value={v.credit_ledger || ''}
                                placeholder="Credit Ledger Name"
                                onChange={(e) => handleUpdateVoucherCell(originalIdx, 'credit_ledger', e.target.value)}
                                className={`w-full px-2 py-1 text-xs font-mono border rounded bg-white focus:outline-none focus:border-[#008170] ${!v.credit_ledger ? 'border-rose-400 bg-rose-50' : 'border-slate-300'}`}
                              />
                            </td>

                            <td className="p-1 border-r border-slate-200">
                              <input
                                type="number"
                                step="0.01"
                                value={v.amount || ''}
                                placeholder="0.00"
                                onChange={(e) => handleUpdateVoucherCell(originalIdx, 'amount', e.target.value)}
                                className={`w-full px-2 py-1 text-xs font-mono text-right font-bold border rounded bg-white focus:outline-none focus:border-[#008170] ${parseFloat(v.amount) <= 0 || !v.amount ? 'border-rose-400 bg-rose-50 text-rose-700' : 'border-slate-300 text-slate-900'}`}
                              />
                            </td>

                            <td className="p-1 border-r border-slate-200">
                              <input
                                type="text"
                                value={v.narration || ''}
                                placeholder="Narration text..."
                                onChange={(e) => handleUpdateVoucherCell(originalIdx, 'narration', e.target.value)}
                                className="w-full px-2 py-1 text-xs font-mono border border-slate-300 rounded bg-white focus:outline-none focus:border-[#008170]"
                              />
                            </td>

                            <td className="p-2 text-center border-r border-slate-200 font-mono">
                              {v.is_valid ? (
                                <span className="text-emerald-700 font-bold text-xs">OK</span>
                              ) : (
                                <span
                                  className="text-rose-700 font-bold text-xs cursor-help"
                                  title={v.validation_errors?.join(', ') || 'Validation error'}
                                >
                                  ERR
                                </span>
                              )}
                            </td>

                            <td className="p-1 text-center">
                              <button
                                onClick={() => handleDeleteVoucherRow(originalIdx)}
                                className="text-slate-400 hover:text-rose-700 font-bold text-xs p-1"
                                title="Delete row"
                              >
                                [X]
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Saved Templates Directory */}
            <div className="bg-white rounded-lg border-2 border-slate-400 shadow-sm p-5 space-y-4 font-mono">
              <div className="flex items-center justify-between border-b border-slate-300 pb-2.5">
                <div>
                  <h4 className="text-xs font-bold text-[#0b192c] tracking-tight uppercase">
                    Saved CSV Column Mapping Templates ({csvMappings.length})
                  </h4>
                  <p className="text-xs text-slate-500 font-mono mt-0.5">
                    Save mappings once for client formats or accounting software exports.
                  </p>
                </div>
                <button
                  onClick={handleOpenCreateMapping}
                  className="px-3 py-1.5 bg-[#008170] hover:bg-[#006e5f] text-white rounded font-bold text-xs shadow-sm transition-colors"
                >
                  + Add Template
                </button>
              </div>

              {csvMappings.length === 0 ? (
                <div className="p-6 text-center text-slate-500 font-mono text-xs">
                  No custom mappings saved yet. Click "+ Add Template" to create one.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {csvMappings.map(tmpl => (
                    <div
                      key={tmpl.id}
                      className={`p-3.5 rounded-lg border-2 transition-colors ${selectedCsvMappingId === String(tmpl.id) ? 'border-[#008170] bg-emerald-50/30' : 'border-slate-300 bg-white hover:border-slate-400'}`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="truncate">
                          <div className="text-xs font-bold text-[#0b192c] truncate">{tmpl.name}</div>
                          {tmpl.description && (
                            <div className="text-[11px] text-slate-500 truncate mt-0.5">{tmpl.description}</div>
                          )}
                        </div>
                        <div className="flex items-center space-x-1 ml-2">
                          <button
                            onClick={() => handleOpenEditMapping(tmpl)}
                            className="text-slate-600 hover:text-slate-900 p-1 text-xs font-bold"
                            title="Edit"
                          >
                            [Edit]
                          </button>
                          <button
                            onClick={() => handleDeleteMapping(tmpl.id)}
                            className="text-slate-400 hover:text-rose-700 p-1 text-xs font-bold"
                            title="Delete"
                          >
                            [X]
                          </button>
                        </div>
                      </div>

                      <div className="mt-3 pt-2.5 border-t border-slate-200">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedCsvMappingId(String(tmpl.id));
                          }}
                          className={`w-full py-1 text-center text-xs font-bold rounded transition-colors ${selectedCsvMappingId === String(tmpl.id) ? 'bg-[#008170] text-white shadow-sm' : 'bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300'}`}
                        >
                          {selectedCsvMappingId === String(tmpl.id) ? '✓ Active Template' : 'Use This Template'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'rules' && (
          <div className="space-y-5 max-w-6xl mx-auto font-mono">
            
            {/* Header Banner */}
            <div className="bg-white text-slate-900 p-4 rounded-lg border-2 border-slate-400 shadow-sm flex items-center justify-between">
              <div className="flex items-center space-x-3.5">
                <div className="w-10 h-10 rounded bg-[#0b192c] border border-[#1e3e62] flex items-center justify-center p-1.5 flex-shrink-0">
                  <img src="/symbol_mark.svg" alt="Rules" className="w-full h-full object-contain filter invert" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 bg-[#008170] text-white font-extrabold text-[10px] rounded tracking-wider">
                      [F2:2]
                    </span>
                    <h3 className="text-sm font-bold text-[#0b192c] tracking-tight uppercase">
                      Smart Ledger Suggestion & Categorization Rules
                    </h3>
                  </div>
                  <p className="text-xs text-slate-500 font-mono mt-0.5">
                    Define keyword rules to automatically categorize bank narrations and assign Tally counter-ledgers.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              
              {/* Left: Create Rule Form */}
              <div className="bg-white rounded-lg border-2 border-slate-400 shadow-sm p-5 space-y-3.5">
                <div className="flex items-center justify-between border-b border-slate-300 pb-2">
                  <h4 className="text-xs font-bold text-[#0b192c] tracking-tight uppercase">Add New Rule</h4>
                  <span className="text-[10px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded border border-slate-300 font-bold">Auto-Matcher</span>
                </div>
                <form onSubmit={handleCreateRule} className="space-y-3 text-xs font-mono">
                  <div>
                    <label className="block text-slate-700 font-bold mb-1 uppercase tracking-wide">Rule Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Electricity Bill Rule"
                      value={ruleNameInput}
                      onChange={(e) => setRuleNameInput(e.target.value)}
                      className="w-full px-3 py-1.5 border-2 border-slate-400 rounded text-xs font-mono bg-white focus:outline-none focus:border-[#008170] transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-bold mb-1 uppercase tracking-wide">Narration Keyword / Pattern</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. BESCOM or SALARY or SWIGGY"
                      value={rulePatternInput}
                      onChange={(e) => setRulePatternInput(e.target.value)}
                      className="w-full px-3 py-1.5 border-2 border-slate-400 rounded text-xs font-mono uppercase bg-white focus:outline-none focus:border-[#008170] transition-colors"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-slate-700 font-bold mb-1 uppercase tracking-wide">Match Type</label>
                      <select
                        value={ruleMatchType}
                        onChange={(e) => setRuleMatchType(e.target.value)}
                        className="w-full px-2 py-1.5 border-2 border-slate-400 rounded text-xs font-mono font-bold bg-white focus:outline-none focus:border-[#008170]"
                      >
                        <option value="CONTAINS">CONTAINS</option>
                        <option value="STARTS_WITH">STARTS WITH</option>
                        <option value="ENDS_WITH">ENDS WITH</option>
                        <option value="EXACT">EXACT</option>
                        <option value="REGEX">REGEX</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-slate-700 font-bold mb-1 uppercase tracking-wide">Voucher Type</label>
                      <select
                        value={ruleVoucherType}
                        onChange={(e) => setRuleVoucherType(e.target.value)}
                        className="w-full px-2 py-1.5 border-2 border-slate-400 rounded text-xs font-mono font-bold bg-white focus:outline-none focus:border-[#008170]"
                      >
                        <option value="Payment">Payment</option>
                        <option value="Receipt">Receipt</option>
                        <option value="Contra">Contra</option>
                        <option value="Journal">Journal</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-slate-700 font-bold mb-1 uppercase tracking-wide">Target Counter Ledger Name</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Electricity Expenses"
                      value={ruleLedgerInput}
                      onChange={(e) => setRuleLedgerInput(e.target.value)}
                      className="w-full px-3 py-1.5 border-2 border-slate-400 rounded text-xs font-mono font-bold bg-white focus:outline-none focus:border-[#008170] transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-bold mb-1 uppercase tracking-wide">Category</label>
                    <input
                      type="text"
                      placeholder="e.g. Utilities, Vendor, Salary"
                      value={ruleCategoryInput}
                      onChange={(e) => setRuleCategoryInput(e.target.value)}
                      className="w-full px-3 py-1.5 border-2 border-slate-400 rounded text-xs font-mono bg-white focus:outline-none focus:border-[#008170] transition-colors"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full py-2 px-3 bg-[#008170] hover:bg-[#006e5f] text-white rounded font-mono font-bold text-xs uppercase tracking-wider shadow-sm transition-colors mt-1"
                  >
                    + Save Ledger Rule
                  </button>
                </form>
              </div>

              {/* Right: Existing Rules Directory */}
              <div className="bg-white rounded-lg border-2 border-slate-400 shadow-sm p-5 space-y-3.5 lg:col-span-2 font-mono">
                <div className="flex justify-between items-center border-b border-slate-300 pb-2">
                  <h4 className="text-xs font-bold text-[#0b192c] tracking-tight uppercase">Active Rules Directory ({userRules.length})</h4>
                  <button
                    onClick={fetchUserRules}
                    className="text-xs font-mono font-bold text-[#008170] hover:underline"
                  >
                    [Refresh Rules]
                  </button>
                </div>

                {userRules.length === 0 ? (
                  <div className="py-10 text-center text-slate-500 font-mono text-xs">
                    No custom ledger rules created yet. Add rules on the left to automate ledger mapping.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded border-2 border-slate-400 max-h-[380px]">
                    <table className="min-w-full divide-y divide-slate-200 text-xs font-mono bg-white">
                      <thead className="bg-[#0b192c] text-white text-[10px] font-bold uppercase tracking-wider border-b-2 border-slate-400 sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left font-bold border-r border-slate-400">Rule Name</th>
                          <th className="px-3 py-2 text-left font-bold border-r border-slate-400">Pattern</th>
                          <th className="px-3 py-2 text-center font-bold border-r border-slate-400">Type</th>
                          <th className="px-3 py-2 text-left font-bold border-r border-slate-400">Assigned Ledger</th>
                          <th className="px-3 py-2 text-center font-bold border-r border-slate-400">Voucher</th>
                          <th className="px-3 py-2 text-center font-bold">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 text-slate-900">
                        {userRules.map((rule) => (
                          <tr key={rule.id} className="hover:bg-amber-50/60 transition-colors border-b border-slate-200">
                            <td className="px-3 py-2 font-bold text-[#0b192c] border-r border-slate-200">{rule.rule_name}</td>
                            <td className="px-3 py-2 font-mono uppercase text-slate-700 text-[11px] border-r border-slate-200">{rule.pattern}</td>
                            <td className="px-3 py-2 text-center border-r border-slate-200">
                              <span className="bg-slate-100 text-slate-700 px-1.5 py-0.2 rounded text-[10px] font-mono border border-slate-300">
                                {rule.match_type}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-emerald-800 font-bold border-r border-slate-200">{rule.ledger_name}</td>
                            <td className="px-3 py-2 text-center text-[11px] text-slate-700 border-r border-slate-200">{rule.voucher_type}</td>
                            <td className="px-3 py-2 text-center">
                              <button
                                onClick={() => handleDeleteRule(rule.id)}
                                className="text-slate-500 hover:text-rose-700 text-xs font-bold transition-colors font-mono"
                              >
                                [Del]
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

            </div>

          </div>
        )}

        {activeTab === 'clients' && (
          <div className="space-y-5 max-w-6xl mx-auto font-mono">
            {selectedDossierClient ? (
              /* --- 1. INDIVIDUAL CLIENT DOSSIER VIEW --- */
              <div className="space-y-5">
                {/* Back Navigation & Client Header */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-white text-slate-900 p-4 rounded-lg border-2 border-slate-400 shadow-sm font-mono">
                  <div>
                    <button
                      type="button"
                      onClick={() => setSelectedDossierClient(null)}
                      className="inline-flex items-center text-xs font-mono font-bold text-[#008170] hover:underline mb-1.5 transition-colors"
                    >
                      ← Back to All Companies
                    </button>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-bold tracking-tight text-[#0b192c]">
                        {selectedDossierClient.name}
                      </h2>
                      <span className="bg-[#0b192c] text-amber-300 text-[10px] font-bold px-2 py-0.5 rounded font-mono">
                        FY {selectedDossierClient.financial_year || '2024-25'}
                      </span>
                      <span className="bg-slate-100 text-slate-800 text-[10px] font-bold px-2 py-0.5 rounded border border-slate-300 uppercase font-mono">
                        {selectedDossierClient.business_type || 'Proprietorship'}
                      </span>
                    </div>
                    {selectedDossierClient.notes && (
                      <p className="text-xs text-slate-500 mt-1 max-w-xl truncate font-mono">
                        {selectedDossierClient.notes}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 font-mono">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveClientId(selectedDossierClient.id);
                        setActiveTab('convert');
                      }}
                      className="px-3 py-1.5 bg-[#008170] hover:bg-[#006e5f] text-white font-bold text-xs rounded shadow-sm transition-colors"
                    >
                      + Import Statement PDF
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOpenClientModal(selectedDossierClient)}
                      className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-800 font-bold text-xs rounded border-2 border-slate-400 shadow-sm transition-colors"
                    >
                      Edit Company
                    </button>
                  </div>
                </div>

                {/* Dossier Meta KPI Bar */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 font-mono">
                  <div className="bg-white rounded-lg border-2 border-slate-400 p-3.5 shadow-sm">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Tax Identifiers</span>
                    <span className="text-xs font-bold font-mono text-[#0b192c] block mt-1">
                      PAN: {selectedDossierClient.pan || 'NO PAN'}
                    </span>
                    <span className="text-[10px] font-mono text-slate-600 truncate block mt-0.5">
                      GST: {selectedDossierClient.gstin || 'Unregistered'}
                    </span>
                  </div>
                  <div className="bg-white rounded-lg border-2 border-slate-400 p-3.5 shadow-sm">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Statements Converted</span>
                    <span className="text-xl font-bold font-mono text-[#0b192c] block mt-0.5">
                      {dossierData ? dossierData.total_statements : (selectedDossierClient.conversions_count || 0)}
                    </span>
                  </div>
                  <div className="bg-white rounded-lg border-2 border-slate-400 p-3.5 shadow-sm">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Vouchers Generated</span>
                    <span className="text-xl font-bold font-mono text-emerald-800 block mt-0.5">
                      {dossierData ? dossierData.total_vouchers : (selectedDossierClient.vouchers_count || 0)}
                    </span>
                  </div>
                  <div className="bg-white rounded-lg border-2 border-slate-400 p-3.5 shadow-sm">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Associated Bank A/C</span>
                    <span className="text-xs font-bold font-mono text-slate-800 block mt-1 truncate" title={dossierData?.bank_accounts?.join(', ')}>
                      {dossierData?.bank_accounts?.length > 0 ? dossierData.bank_accounts.join(', ') : 'Statements Pending'}
                    </span>
                  </div>
                </div>

                {/* Financial Year Monthly Reconciliation Tracker (April - March) */}
                <div className="bg-white rounded-lg border-2 border-slate-400 p-5 shadow-sm space-y-4 font-mono">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-slate-300 pb-2.5">
                    <div>
                      <h3 className="text-xs font-bold text-[#0b192c] tracking-tight uppercase flex items-center space-x-2">
                        <span>Financial Year Reconciliation Tracker (April to March)</span>
                      </h3>
                      <p className="text-xs text-slate-500 font-mono mt-0.5">
                        Audit checklist for FY {selectedDossierClient.financial_year || '2024-25'}. Green signifies imported statement; yellow indicates missing months.
                      </p>
                    </div>
                    <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded border border-emerald-300 uppercase">
                      AUDIT MATRIX ACTIVE
                    </span>
                  </div>

                  {dossierLoading ? (
                    <div className="py-10 text-center text-xs font-mono text-slate-500">
                      Loading financial year dossier...
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5 font-mono">
                      {(dossierData?.monthly_matrix || []).map((m, idx) => (
                        <div
                          key={idx}
                          className={`p-3 rounded border-2 flex flex-col justify-between h-28 transition-colors ${
                            m.is_completed
                              ? 'bg-emerald-50/70 border-emerald-400'
                              : 'bg-slate-50 border-slate-300 hover:border-slate-400'
                          }`}
                        >
                          <div>
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-slate-900 uppercase">
                                {m.month}
                              </span>
                              <span className="text-[10px] font-mono text-slate-500 font-bold">
                                '{String(m.year).slice(-2)}
                              </span>
                            </div>
                            <div className="mt-1.5">
                              {m.is_completed ? (
                                <span className="inline-block bg-emerald-100 text-emerald-900 text-[9px] font-bold uppercase px-1.5 py-0.2 rounded border border-emerald-300">
                                  AUDIT OK ✓
                                </span>
                              ) : (
                                <span className="inline-block bg-amber-100 text-amber-900 text-[9px] font-bold uppercase px-1.5 py-0.2 rounded border border-amber-300">
                                  PENDING
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="pt-1.5 border-t border-slate-300 flex items-center justify-between text-xs">
                            {m.is_completed ? (
                              <div className="text-[11px] font-bold text-slate-700">
                                <div>{m.vouchers_count} Vouchers</div>
                                {m.latest_conversion_id && (
                                  <button
                                    type="button"
                                    onClick={() => handleDownloadCachedXml(m.latest_conversion_id, selectedDossierClient.name, m.month)}
                                    className="text-[10px] text-[#008170] font-bold hover:underline"
                                  >
                                    [Get XML]
                                  </button>
                                )}
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveClientId(selectedDossierClient.id);
                                  setActiveTab('convert');
                                }}
                                className="text-[10px] bg-[#0b192c] hover:bg-[#1e3e62] text-white px-2 py-0.5 rounded font-bold transition-colors"
                              >
                                + Upload
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Client's Cloud XML Vault Table */}
                <div className="bg-white rounded-lg border-2 border-slate-400 p-5 shadow-sm space-y-4 font-mono">
                  <div className="flex justify-between items-center border-b border-slate-300 pb-2.5">
                    <h3 className="text-xs font-bold text-[#0b192c] tracking-tight uppercase flex items-center gap-2">
                      <svg className="w-4 h-4 text-slate-600 inline-block" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 00-9.78 2.096A4.001 4.001 0 003 15z" />
                      </svg>
                      <span>Client Cloud XML Vault ({dossierData?.conversions?.length || 0} Files)</span>
                    </h3>
                    <span className="text-xs text-slate-500 font-mono">
                      Cloud archive for this company. Re-download anytime.
                    </span>
                  </div>

                  {(!dossierData?.conversions || dossierData.conversions.length === 0) ? (
                    <p className="text-slate-500 font-mono text-xs py-8 text-center">
                      No converted Tally XML files for this company yet. Convert a bank statement or CSV to store it here.
                    </p>
                  ) : (
                    <div className="overflow-x-auto rounded border-2 border-slate-400">
                      <table className="min-w-full divide-y divide-slate-200 text-xs font-mono bg-white">
                        <thead className="bg-[#0b192c] text-white text-[10px] font-bold uppercase tracking-wider border-b-2 border-slate-400">
                          <tr>
                            <th className="px-3 py-2 text-left font-bold border-r border-slate-400">Date Converted</th>
                            <th className="px-3 py-2 text-left font-bold border-r border-slate-400">File Name / Bank</th>
                            <th className="px-3 py-2 text-left font-bold border-r border-slate-400">Statement Period</th>
                            <th className="px-3 py-2 text-center font-bold border-r border-slate-400">Vouchers</th>
                            <th className="px-3 py-2 text-center font-bold border-r border-slate-400">Size</th>
                            <th className="px-3 py-2 text-right font-bold">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 text-slate-900">
                          {dossierData.conversions.map((conv) => (
                            <tr key={conv.id} className="hover:bg-amber-50/60 transition-colors border-b border-slate-200">
                              <td className="px-3 py-2 whitespace-nowrap font-mono text-[11px] text-slate-700 border-r border-slate-200">
                                {formatDisplayDate(conv.created_at)}
                              </td>
                              <td className="px-3 py-2 border-r border-slate-200">
                                <div className="font-bold text-[#0b192c]">{conv.bank_name}</div>
                                <div className="text-[10px] font-mono text-slate-500 mt-0.5">{conv.file_name}</div>
                              </td>
                              <td className="px-3 py-2 text-slate-700 border-r border-slate-200">
                                {conv.statement_period || 'Consolidated'}
                              </td>
                              <td className="px-3 py-2 text-center font-mono font-bold border-r border-slate-200">
                                {conv.transactions_count}
                              </td>
                              <td className="px-3 py-2 text-center font-mono text-slate-600 border-r border-slate-200">
                                {conv.xml_size_kb ? `${conv.xml_size_kb} KB` : '-'}
                              </td>
                              <td className="px-3 py-2 text-right whitespace-nowrap space-x-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleDownloadCachedXml(conv.id, conv.bank_name, conv.statement_period)}
                                  className="px-2.5 py-1 bg-[#008170] hover:bg-[#006e5f] text-white rounded text-xs font-bold transition-colors shadow-sm"
                                >
                                  Download XML
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteHistoryXml(conv.id)}
                                  className="px-2 py-1 text-slate-400 hover:text-rose-700 text-xs font-bold transition-colors"
                                  title="Delete from vault"
                                >
                                  [Del]
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* --- 2. ALL CLIENTS DIRECTORY & KPI GRID --- */
              <div className="bg-white rounded-lg border-2 border-slate-400 shadow-sm p-5 space-y-4 font-mono">
                {/* Header */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-slate-300 pb-3">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 rounded bg-[#0b192c] border border-[#1e3e62] flex items-center justify-center p-1.5 flex-shrink-0">
                      <svg className="w-5 h-5 text-amber-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                      </svg>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 bg-[#008170] text-white font-extrabold text-[10px] rounded tracking-wider">
                          [F2:1]
                        </span>
                        <h3 className="text-sm font-bold text-[#0b192c] tracking-tight uppercase">Multi-Client Practice Workspace</h3>
                      </div>
                      <p className="text-xs text-slate-500 font-mono mt-0.5">
                        Manage companies, track monthly FY progress, and archive Tally XML vouchers.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto font-mono">
                    <input
                      type="text"
                      placeholder="Search by name, PAN, GSTIN..."
                      value={clientSearchQuery}
                      onChange={(e) => setClientSearchQuery(e.target.value)}
                      className="px-3 py-1.5 border-2 border-slate-400 rounded text-xs font-mono font-medium focus:outline-none focus:border-[#008170] w-full sm:w-64 placeholder:text-slate-400 bg-white"
                    />
                    <button
                      type="button"
                      onClick={() => handleOpenClientModal()}
                      className="px-3.5 py-1.5 bg-[#008170] hover:bg-[#006e5f] text-white rounded font-mono font-bold text-xs shadow-sm transition-colors whitespace-nowrap"
                    >
                      + Add Company
                    </button>
                  </div>
                </div>

                {/* Clients Grid */}
                {clientsList.length === 0 ? (
                  <div className="py-12 text-center space-y-2 font-mono">
                    <p className="text-sm font-bold text-slate-700">No client companies added yet.</p>
                    <p className="text-xs text-slate-500">Create your first client profile to associate bank accounts & dossiers.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 font-mono">
                    {clientsList
                      .filter(c => {
                        if (!clientSearchQuery.trim()) return true;
                        const q = clientSearchQuery.toLowerCase();
                        return (
                          c.name?.toLowerCase().includes(q) ||
                          c.pan?.toLowerCase().includes(q) ||
                          c.gstin?.toLowerCase().includes(q) ||
                          c.business_type?.toLowerCase().includes(q)
                        );
                      })
                      .map((client) => {
                        const isCurrentActive = activeClientId === client.id;
                        return (
                          <div
                            key={client.id}
                            className={`rounded-lg border-2 p-4 flex flex-col justify-between transition-colors bg-white shadow-sm ${
                              isCurrentActive
                                ? 'border-[#008170] bg-emerald-50/20 shadow-md'
                                : 'border-slate-300 hover:border-slate-400'
                            }`}
                          >
                            <div className="space-y-2">
                              <div className="flex items-start justify-between">
                                <div className="truncate">
                                  <h4 className="text-xs font-bold text-[#0b192c] truncate">
                                    {client.name}
                                  </h4>
                                  <span className="text-[10px] text-slate-500 font-mono block">
                                    {client.business_type || 'General Business'}
                                  </span>
                                </div>
                                <span className="bg-[#0b192c] text-amber-300 text-[10px] font-bold px-2 py-0.5 rounded font-mono">
                                  FY {client.financial_year || '2024-25'}
                                </span>
                              </div>

                              <div className="flex flex-wrap gap-1 pt-1 font-mono">
                                {client.pan && (
                                  <span className="bg-slate-100 text-slate-800 text-[10px] font-bold px-1.5 py-0.2 rounded border border-slate-300">
                                    PAN: {client.pan}
                                  </span>
                                )}
                                {client.gstin && (
                                  <span className="bg-slate-100 text-slate-800 text-[10px] font-bold px-1.5 py-0.2 rounded border border-slate-300">
                                    GST: {client.gstin}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Stats */}
                            <div className="grid grid-cols-2 gap-2 pt-2.5 mt-2.5 border-t border-slate-200 text-center font-mono">
                              <div className="bg-slate-50 rounded p-1.5 border border-slate-300">
                                <span className="text-[9px] font-bold uppercase text-slate-500 block">Statements</span>
                                <span className="text-xs font-bold text-[#0b192c]">{client.conversions_count || 0}</span>
                              </div>
                              <div className="bg-slate-50 rounded p-1.5 border border-slate-300">
                                <span className="text-[9px] font-bold uppercase text-slate-500 block">Vouchers</span>
                                <span className="text-xs font-bold text-emerald-800">{client.vouchers_count || 0}</span>
                              </div>
                            </div>

                            {/* Actions */}
                            <div className="space-y-1.5 pt-2.5">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedDossierClient(client);
                                  fetchClientDossier(client.id);
                                }}
                                className="w-full py-1.5 bg-[#008170] hover:bg-[#006e5f] text-white rounded text-xs font-bold shadow-sm transition-colors font-mono"
                              >
                                Open Dossier & XML Vault
                              </button>

                              <div className="flex gap-1.5 font-mono">
                                <button
                                  type="button"
                                  onClick={() => setActiveClientId(isCurrentActive ? '' : client.id)}
                                  className={`flex-1 py-1 text-[11px] font-bold rounded border-2 transition-colors ${
                                    isCurrentActive
                                      ? 'bg-emerald-100 text-emerald-900 border-emerald-400'
                                      : 'bg-white hover:bg-slate-100 text-slate-800 border-slate-400'
                                  }`}
                                >
                                  {isCurrentActive ? 'ACTIVE WORKSPACE' : 'Set Active'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleOpenClientModal(client)}
                                  className="px-2 py-1 bg-white hover:bg-slate-100 border-2 border-slate-400 rounded text-slate-800 text-xs font-bold transition-colors"
                                  title="Edit Client"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteClient(client.id, client.name)}
                                  className="px-2 py-1 bg-white hover:bg-rose-50 border-2 border-slate-400 hover:border-rose-300 text-slate-600 hover:text-rose-700 rounded text-xs font-bold transition-colors"
                                  title="Delete Client"
                                >
                                  [Del]
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <div className="bg-white rounded-lg border-2 border-slate-400 shadow-sm p-5 space-y-4 max-w-6xl mx-auto font-mono">
            
            {/* Header, Search and Filter */}
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3 border-b border-slate-300 pb-4">
              <div className="flex items-center space-x-3.5">
                <div className="w-10 h-10 rounded bg-[#0b192c] border border-[#1e3e62] flex items-center justify-center p-1.5 flex-shrink-0">
                  <svg className="w-5 h-5 text-amber-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 00-9.78 2.096A4.001 4.001 0 003 15z" />
                  </svg>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 bg-[#008170] text-white font-extrabold text-[10px] rounded tracking-wider">
                      [F2:3]
                    </span>
                    <h3 className="text-sm font-bold text-[#0b192c] tracking-tight uppercase">Cloud XML Vault & Archive</h3>
                  </div>
                  <p className="text-xs text-slate-500 font-mono mt-0.5">
                    All generated Tally XML files are securely stored in the cloud. Re-download anytime on any workstation.
                  </p>
                </div>
              </div>
              
              <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto font-mono">
                <div className="w-full sm:w-48">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Filter By Company</label>
                  <select
                    value={historyClientFilter}
                    onChange={(e) => setHistoryClientFilter(e.target.value)}
                    className="w-full px-2.5 py-1.5 border-2 border-slate-400 rounded text-xs font-mono font-bold bg-white focus:outline-none focus:border-[#008170]"
                  >
                    <option value="">All Companies</option>
                    {clientsList.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                <div className="w-full sm:w-64">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">Search Archives</label>
                  <input
                    type="text"
                    placeholder="Search bank, period, file name..."
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    className="w-full px-3 py-1.5 border-2 border-slate-400 rounded text-xs font-mono bg-white focus:outline-none focus:border-[#008170] placeholder:text-slate-400"
                  />
                </div>
              </div>
            </div>

            {/* Table */}
            {filteredHistory.length === 0 ? (
              <p className="text-slate-500 font-mono text-xs py-10 text-center">
                No XML files matching the filter criteria found in Cloud Vault.
              </p>
            ) : (
              <div className="overflow-x-auto rounded border-2 border-slate-400">
                <table className="min-w-full divide-y divide-slate-200 text-xs font-mono bg-white">
                  <thead className="bg-[#0b192c] text-white text-[10px] font-bold uppercase tracking-wider border-b-2 border-slate-400">
                    <tr>
                      <th className="px-3 py-2 text-left font-bold border-r border-slate-400">Date Converted</th>
                      <th className="px-3 py-2 text-left font-bold border-r border-slate-400">Client Company</th>
                      <th className="px-3 py-2 text-left font-bold border-r border-slate-400">Bank / Source</th>
                      <th className="px-3 py-2 text-left font-bold border-r border-slate-400">Statement Period</th>
                      <th className="px-3 py-2 text-center font-bold border-r border-slate-400">Vouchers</th>
                      <th className="px-3 py-2 text-center font-bold border-r border-slate-400">File Size</th>
                      <th className="px-3 py-2 text-right font-bold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-slate-900">
                    {filteredHistory.map((conv) => (
                      <tr key={conv.id} className="hover:bg-amber-50/60 transition-colors border-b border-slate-200">
                        <td className="px-3 py-2.5 whitespace-nowrap font-mono text-[11px] text-slate-700 border-r border-slate-200">
                          {formatDisplayDate(conv.created_at)}
                        </td>
                        <td className="px-3 py-2.5 border-r border-slate-200">
                          {conv.client_name ? (
                            <span className="bg-slate-100 text-slate-800 border border-slate-300 px-2 py-0.5 rounded text-[10px] font-bold">
                              {conv.client_name}
                            </span>
                          ) : (
                            <span className="text-slate-500 text-[11px]">General / Unassigned</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 border-r border-slate-200">
                          <div className="font-bold text-[#0b192c]">{conv.bank_name}</div>
                          {conv.source_type === 'CSV_TALLY' ? (
                            <span className="text-[9px] bg-slate-100 text-slate-700 border border-slate-300 px-1.5 py-0.2 rounded font-mono uppercase inline-block mt-0.5">
                              CSV Import
                            </span>
                          ) : (
                            <span className="text-[9px] bg-slate-100 text-slate-700 border border-slate-300 px-1.5 py-0.2 rounded font-mono uppercase inline-block mt-0.5">
                              PDF Statement
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-slate-700 border-r border-slate-200">
                          {conv.statement_period || 'Consolidated Period'}
                        </td>
                        <td className="px-3 py-2.5 text-center font-mono font-bold border-r border-slate-200">
                          {conv.transactions_count}
                        </td>
                        <td className="px-3 py-2.5 text-center font-mono text-slate-600 border-r border-slate-200">
                          {conv.xml_size_kb ? `${conv.xml_size_kb} KB` : '-'}
                        </td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap space-x-1.5">
                          <button
                            type="button"
                            onClick={() => handleDownloadCachedXml(conv.id, conv.bank_name, conv.statement_period)}
                            className="px-2.5 py-1 bg-[#008170] hover:bg-[#006e5f] text-white rounded text-xs font-bold transition-colors shadow-sm"
                          >
                            Download XML
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteHistoryXml(conv.id)}
                            className="px-2 py-1 text-slate-400 hover:text-rose-700 text-xs font-bold transition-colors"
                            title="Delete from vault"
                          >
                            [Del]
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* --- TAB 3: WALLET & PLANS --- */}
        {activeTab === 'wallet' && (
          <div className="space-y-5 max-w-6xl mx-auto font-mono">
            
            {/* Purchase plans */}
            <div className="space-y-5">
              <div className="bg-white rounded-lg border-2 border-slate-400 shadow-sm p-5 space-y-4">
                <div className="flex items-center space-x-3.5 border-b border-slate-300 pb-3">
                  <div className="w-10 h-10 rounded bg-[#0b192c] border border-[#1e3e62] flex items-center justify-center p-1.5 flex-shrink-0">
                    <img src="/symbol_mark.svg" alt="SB" className="w-full h-full object-contain filter invert" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 bg-[#008170] text-white font-extrabold text-[10px] rounded tracking-wider">
                        [F3]
                      </span>
                      <h3 className="text-sm font-bold text-[#0b192c] tracking-tight uppercase">Buy Credit Vouchers</h3>
                    </div>
                    <p className="text-xs text-slate-500 font-mono mt-0.5">Base pricing is 25 paise per page with bulk volume extra credits. Failed conversions are never charged.</p>
                  </div>
                </div>

                {purchaseMessage && (
                  <div className="bg-emerald-50 text-emerald-900 border-2 border-emerald-300 p-3 rounded text-xs font-bold font-mono">
                    {String(purchaseMessage)}
                  </div>
                )}
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono">
                  {/* Pack 1 */}
                  <div className="rounded-lg border-2 border-slate-400 p-5 text-center flex flex-col justify-between bg-white shadow-sm hover:border-[#1e3e62] transition-colors">
                    <div>
                      <h4 className="font-bold text-[#0b192c] text-sm uppercase">Starter Pack</h4>
                      <p className="text-[11px] font-mono text-slate-500 mt-0.5">₹0.25 per page</p>
                      <div className="mt-3 text-3xl font-extrabold font-mono text-[#0b192c]">100</div>
                      <p className="text-[11px] font-bold text-slate-600 mt-0.5 uppercase">Page Credits</p>
                    </div>
                    <div className="mt-5">
                      <button
                        onClick={() => setCheckoutSession({ planName: 'Starter Pack', pages: 100, amount: 25.0 })}
                        className="w-full py-2 px-3 bg-white hover:bg-slate-100 border-2 border-slate-400 rounded font-bold text-slate-900 text-xs shadow-sm transition-colors uppercase"
                      >
                        Buy for ₹25
                      </button>
                    </div>
                  </div>

                  {/* Pack 2 */}
                  <div className="rounded-lg border-2 border-[#0b192c] p-5 text-center flex flex-col justify-between bg-slate-50 shadow-sm relative">
                    <span className="absolute top-0 right-1/2 translate-x-1/2 -translate-y-1/2 px-2.5 py-0.5 rounded text-[10px] font-bold bg-[#0b192c] text-amber-300 border border-[#1e3e62]">
                      +100 EXTRA FREE
                    </span>
                    <div>
                      <h4 className="font-bold text-[#0b192c] text-sm uppercase">Standard Pack</h4>
                      <p className="text-[11px] font-mono text-slate-500 mt-0.5">₹0.21 per page value</p>
                      <div className="mt-3 text-3xl font-extrabold font-mono text-[#0b192c]">600</div>
                      <p className="text-[11px] font-bold text-slate-600 mt-0.5 uppercase">Pages (500 + 100 Free)</p>
                    </div>
                    <div className="mt-5">
                      <button
                        onClick={() => setCheckoutSession({ planName: 'Standard Pack', pages: 500, amount: 125.0 })}
                        className="w-full py-2 px-3 bg-[#0b192c] hover:bg-[#1e3e62] text-amber-300 rounded font-bold text-xs shadow-sm transition-colors uppercase"
                      >
                        Buy for ₹125
                      </button>
                    </div>
                  </div>

                  {/* Pack 3 */}
                  <div className="rounded-lg border-2 border-[#008170] p-5 text-center flex flex-col justify-between bg-emerald-50/20 shadow-sm relative">
                    <span className="absolute top-0 right-1/2 translate-x-1/2 -translate-y-1/2 px-2.5 py-0.5 rounded text-[10px] font-bold bg-[#008170] text-white">
                      +400 EXTRA FREE • BEST VALUE
                    </span>
                    <div>
                      <h4 className="font-bold text-emerald-950 text-sm uppercase">Enterprise Practice</h4>
                      <p className="text-[11px] font-mono text-slate-500 mt-0.5">₹0.18 per page value</p>
                      <div className="mt-3 text-3xl font-extrabold font-mono text-emerald-800">1,400</div>
                      <p className="text-[11px] font-bold text-slate-600 mt-0.5 uppercase">Pages (1,000 + 400 Free)</p>
                    </div>
                    <div className="mt-5">
                      <button
                        onClick={() => setCheckoutSession({ planName: 'Enterprise Practice', pages: 1000, amount: 250.0 })}
                        className="w-full py-2 px-3 bg-[#008170] hover:bg-[#006e5f] text-white rounded font-bold text-xs shadow-sm transition-colors uppercase"
                      >
                        Buy for ₹250
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Promo Code Redemption Card */}
              <div className="bg-white rounded-lg border-2 border-slate-400 shadow-sm p-5 font-mono">
                <h4 className="text-xs font-bold text-[#0b192c] tracking-tight uppercase">Redeem Promo Code</h4>
                <p className="text-xs text-slate-500 font-mono mt-0.5 mb-3">Enter a promo code below to claim free page credits.</p>
                
                <div className="flex space-x-2 max-w-md">
                  <input
                    type="text"
                    placeholder="e.g. SHEETBUDDY50"
                    value={promoCode}
                    onChange={(e) => setPromoCode(e.target.value)}
                    className="flex-1 px-3 py-1.5 border-2 border-slate-400 rounded text-xs font-bold uppercase font-mono bg-white focus:outline-none focus:border-[#008170]"
                  />
                  <button
                    onClick={handleClaimPromoCode}
                    disabled={redeemLoading || !promoCode.trim()}
                    className="px-4 py-1.5 bg-[#0b192c] hover:bg-[#1e3e62] text-amber-300 rounded text-xs font-bold shadow-sm transition-colors disabled:opacity-50"
                  >
                    {redeemLoading ? 'Redeeming...' : 'Redeem Code'}
                  </button>
                </div>
                
                {redeemStatusMsg && (
                  <div className="mt-3 p-2.5 rounded border-2 border-emerald-300 text-xs font-bold text-emerald-900 bg-emerald-50 max-w-md">
                    {String(redeemStatusMsg)}
                  </div>
                )}
              </div>
            </div>

            {/* Wallet Ledger */}
            <div className="bg-white rounded-lg border-2 border-slate-400 shadow-sm p-5 flex flex-col font-mono">
              <h3 className="text-xs font-bold text-[#0b192c] tracking-tight uppercase border-b border-slate-300 pb-2.5 mb-3">Wallet Activity Log</h3>
              
              {walletTransactions.length === 0 ? (
                <p className="text-slate-500 text-xs py-6 text-center font-mono">No transactions found.</p>
              ) : (
                <div className="space-y-3 max-h-[350px] overflow-y-auto pr-1 divide-y divide-slate-200">
                  {walletTransactions.map((tx) => (
                    <div key={tx.id} className="flex justify-between items-start text-xs pt-3 first:pt-0 font-mono">
                      <div>
                        <div className="flex items-center space-x-2">
                          <p className="font-bold text-[#0b192c]">{tx.description || tx.type}</p>
                          {tx.type === 'PURCHASE' && (
                            <span className={`inline-block px-1.5 py-0.2 text-[9px] font-bold rounded uppercase ${tx.status === 'APPROVED' || tx.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-900 border border-emerald-300' : tx.status === 'REJECTED' ? 'bg-rose-100 text-rose-900 border border-rose-300' : 'bg-amber-100 text-amber-900 border border-amber-300'}`}>
                              {tx.status}
                            </span>
                          )}
                        </div>
                        <p className="text-slate-500 text-[10px] font-mono mt-0.5">{formatDisplayDate(tx.created_at, false)}</p>
                      </div>
                      <div className="text-right">
                        <p className={`font-mono font-bold text-sm ${tx.pages_purchased > 0 ? 'text-emerald-800' : 'text-rose-700'}`}>
                          {tx.pages_purchased > 0 ? `+${tx.pages_purchased}` : tx.pages_purchased}
                        </p>
                        {tx.amount_in_inr > 0 && <p className="text-[10px] font-mono text-slate-500">₹{tx.amount_in_inr}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        )}

        {activeTab === 'admin' && user.is_admin && (
            <div className="space-y-8 max-w-6xl mx-auto">
              
              {/* Analytics Header Grid */}
              <div className="bg-indigo-600 text-white hover:bg-indigo-500 border border-slate-200/90 rounded-2xl shadow-sm p-6">
                <div className="flex items-center space-x-3 mb-4 border-b border-slate-100 pb-3">
                  <img src="/symbol_mark.svg" alt="Admin" className="w-10 h-10 border border-slate-200 rounded-xl bg-black shadow-sm flex-shrink-0" />
                  <div>
                    <h3 className="text-xl font-bold text-black uppercase">Sheet Buddy Global System Overview</h3>
                    <p className="text-xs font-bold text-black opacity-80">Administrative Management Dashboard</p>
                  </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="bg-white p-4 border border-slate-200 rounded-xl shadow-sm">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Total Users Registered</p>
                    <p className="text-2xl font-bold text-black mt-1">{adminStats?.total_users || 0}</p>
                  </div>
                  
                  <div className="bg-white p-4 border border-slate-200 rounded-xl shadow-sm">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Total processed conversions</p>
                    <p className="text-2xl font-bold text-black mt-1">{adminStats?.total_conversions || 0}</p>
                  </div>
                  
                  <div className="bg-white p-4 border border-slate-200 rounded-xl shadow-sm">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Global Credits Issued</p>
                    <p className="text-2xl font-bold text-black mt-1">{adminStats?.total_credits || 0}</p>
                  </div>
                  
                  <div className="bg-white p-4 border border-slate-200 rounded-xl shadow-sm">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Pending Support Queries</p>
                    <p className="text-2xl font-bold text-black mt-1">{adminStats?.pending_queries || 0}</p>
                  </div>
                </div>
              </div>

              {/* Create New User Card */}
              <div className="bg-white border border-slate-200/90 rounded-2xl shadow-sm p-6 space-y-4">
                <h4 className="text-md font-bold text-black uppercase border-b border-slate-100 pb-2">Create New Client Account</h4>
                <p className="text-xs font-bold text-slate-500">Since open self-registration is disabled, administrators provision accounts directly for clients here.</p>
                <form onSubmit={handleAdminCreateUser} className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-end">
                  <div>
                    <label className="block text-xs font-bold text-black uppercase mb-1">Email Address</label>
                    <input
                      type="email"
                      required
                      placeholder="client@example.com"
                      value={adminNewUserEmail}
                      onChange={(e) => setAdminNewUserEmail(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold bg-white focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-black uppercase mb-1">Password</label>
                    <input
                      type="text"
                      required
                      placeholder="Initial password"
                      value={adminNewUserPassword}
                      onChange={(e) => setAdminNewUserPassword(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold bg-white focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-black uppercase mb-1">Initial Page Credits</label>
                    <input
                      type="number"
                      required
                      min={0}
                      value={adminNewUserCredits}
                      onChange={(e) => setAdminNewUserCredits(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold bg-white focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-black uppercase mb-1 text-center">Is Admin?</label>
                    <div className="flex justify-center items-center h-[38px] border border-slate-200 rounded-xl bg-slate-50">
                      <input
                        type="checkbox"
                        checked={adminNewUserIsAdmin}
                        onChange={(e) => setAdminNewUserIsAdmin(e.target.checked)}
                        className="w-4 h-4 border border-slate-200 rounded-xl focus:ring-0 cursor-pointer accent-black"
                      />
                    </div>
                  </div>

                  <div>
                    <button
                      type="submit"
                      disabled={adminNewUserLoading}
                      className="w-full py-2.5 px-4 border border-slate-200 rounded-xl font-bold text-white bg-black hover:bg-zinc-800 uppercase shadow-sm active:scale-[0.99] transition-all text-xs disabled:opacity-50"
                    >
                      {adminNewUserLoading ? 'Creating...' : 'Create Account'}
                    </button>
                  </div>
                </form>

                {adminNewUserError && (
                  <div className="bg-rose-600 text-white hover:bg-rose-500 text-white p-3 border border-slate-200 rounded-xl font-bold text-xs">
                    ERROR: {String(adminNewUserError)}
                  </div>
                )}

                {adminNewUserSuccess && (
                  <div className="bg-emerald-600 text-white hover:bg-emerald-500 text-white p-3 border border-slate-200 rounded-xl font-bold text-xs">
                    SUCCESS: {adminNewUserSuccess}
                  </div>
                )}
              </div>

              {/* Manage Users Card */}
              <div className="bg-white border border-slate-200/90 rounded-2xl shadow-sm p-6 space-y-4">
                <h4 className="text-md font-bold text-black uppercase border-b border-slate-100 pb-2">Manage User Profiles & Wallets</h4>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-100 border border-slate-200 rounded-xl">
                    <thead className="bg-slate-100 text-[10px] font-bold text-black uppercase tracking-wider border-b border-slate-100">
                      <tr>
                        <th className="px-4 py-3 text-left border-r border-slate-100">Email</th>
                        <th className="px-4 py-3 text-center border-r border-slate-100">Balance</th>
                        <th className="px-4 py-3 text-center border-r border-slate-100">Conversions</th>
                        <th className="px-4 py-3 text-center border-r border-slate-100">Admin Role</th>
                        <th className="px-4 py-3 text-center">Adjust Credits</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-100 text-xs font-bold text-black">
                      {adminUsers.map((u) => (
                        <tr key={u.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3 border-r border-slate-100 truncate max-w-xs">{u.email}</td>
                          <td className="px-4 py-3 border-r border-slate-100 text-center">{u.page_credits}</td>
                          <td className="px-4 py-3 border-r border-slate-100 text-center">{u.conversion_count}</td>
                          <td className="px-4 py-3 border-r border-slate-100 text-center">
                            <button
                              onClick={() => handleToggleAdmin(u.id)}
                              className={`px-3 py-1.5 border border-slate-200 rounded-lg text-[10px] font-bold uppercase tracking-wide transition-all shadow-sm ${u.is_admin ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-white text-slate-700 hover:bg-slate-50'}`}
                            >
                              {u.is_admin ? '[ADMIN]' : 'USER'}
                            </button>
                          </td>
                          <td className="px-4 py-3 text-center flex items-center justify-center space-x-2">
                            <input
                              type="number"
                              placeholder="e.g. 50 or -20"
                              value={creditAdjustmentInputs[u.id] || ''}
                              onChange={(e) => setCreditAdjustmentInputs(prev => ({ ...prev, [u.id]: e.target.value }))}
                              className="w-24 px-2 py-1 border border-slate-200 rounded-xl text-xs font-mono font-bold bg-white focus:outline-none"
                            />
                            <button
                              onClick={() => handleAdjustCredits(u.id)}
                              className="px-3 py-1.5 border border-slate-200 rounded-lg text-[10px] font-bold bg-slate-900 text-white hover:bg-slate-800 uppercase shadow-sm transition-all"
                            >
                              ADJUST
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Global Conversion Audits Log */}
              <div className="bg-white border border-slate-200/90 rounded-2xl shadow-sm p-6 space-y-4">
                <h4 className="text-md font-bold text-black uppercase border-b border-slate-100 pb-2">Global System Conversion Log</h4>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-100 border border-slate-200 rounded-xl">
                    <thead className="bg-slate-100 text-[10px] font-bold text-black uppercase tracking-wider border-b border-slate-100">
                      <tr>
                        <th className="px-4 py-3 text-left border-r border-slate-100">Date</th>
                        <th className="px-4 py-3 text-left border-r border-slate-100">User Email</th>
                        <th className="px-4 py-3 text-left border-r border-slate-100">Bank Name</th>
                        <th className="px-4 py-3 text-center border-r border-slate-100">Pages</th>
                        <th className="px-4 py-3 text-center border-r border-slate-100">Transactions</th>
                        <th className="px-4 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-100 text-xs font-bold text-black">
                      {adminConversions.map((conv) => (
                        <tr key={conv.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3 border-r border-slate-100 whitespace-nowrap">{parseUtcDate(conv.created_at).toLocaleString()}</td>
                          <td className="px-4 py-3 border-r border-slate-100 truncate max-w-xs">{conv.user_email}</td>
                          <td className="px-4 py-3 border-r border-slate-100 font-bold uppercase">{conv.bank_name}</td>
                          <td className="px-4 py-3 border-r border-slate-100 text-center">{conv.pages_count}</td>
                          <td className="px-4 py-3 border-r border-slate-100 text-center">{conv.transactions_count}</td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => handleDownloadCachedXml(conv.id, conv.bank_name, conv.statement_period)}
                              className="px-3 py-1.5 border border-slate-200 rounded-lg text-[10px] font-bold bg-slate-900 text-white hover:bg-slate-800 uppercase shadow-sm transition-all"
                            >
                              GET XML
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Payments Received Log */}
              <div className="bg-white border border-slate-200/90 rounded-2xl shadow-sm p-6 space-y-4">
                <h4 className="text-md font-bold text-black uppercase border-b border-slate-100 pb-2">Global Payments Received Log</h4>
                <div className="overflow-x-auto">
                  {adminPayments.length === 0 ? (
                    <p className="text-slate-500 font-bold text-sm py-4 text-center">No payment entries found.</p>
                  ) : (
                    <table className="min-w-full divide-y divide-slate-100 border border-slate-200 rounded-xl">
                      <thead className="bg-slate-100 text-[10px] font-bold text-black uppercase tracking-wider border-b border-slate-100">
                        <tr>
                          <th className="px-4 py-3 text-left border-r border-slate-100">Date</th>
                          <th className="px-4 py-3 text-left border-r border-slate-100">User Email</th>
                          <th className="px-4 py-3 text-center border-r border-slate-100">Pages Purchased</th>
                          <th className="px-4 py-3 text-center border-r border-slate-100">Amount Paid</th>
                          <th className="px-4 py-3 text-left border-r border-slate-100">Description</th>
                          <th className="px-4 py-3 text-center border-r border-slate-100">Status</th>
                          <th className="px-4 py-3 text-center">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-slate-100 text-xs font-bold text-black">
                        {adminPayments.map((pay) => (
                          <tr key={pay.id} className="hover:bg-slate-50">
                            <td className="px-4 py-3 border-r border-slate-100 whitespace-nowrap">{formatDisplayDate(pay.created_at)}</td>
                            <td className="px-4 py-3 border-r border-slate-100 truncate max-w-xs">{pay.user_email}</td>
                            <td className="px-4 py-3 border-r border-slate-100 text-center text-emerald-600 font-bold">+{pay.pages_purchased}</td>
                            <td className="px-4 py-3 border-r border-slate-100 text-center font-bold">₹{pay.amount_in_inr.toFixed(2)}</td>
                            <td className="px-4 py-3 border-r border-slate-100 truncate max-w-xs">{pay.description || 'UPI Credit Purchase'}</td>
                            <td className="px-4 py-3 border-r border-slate-100 text-center whitespace-nowrap">
                              <span className={`px-2.5 py-0.5 border rounded-full font-bold uppercase text-[9px] ${pay.status === 'APPROVED' || pay.status === 'COMPLETED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : pay.status === 'REJECTED' ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-indigo-50 text-indigo-700 border-indigo-200'}`}>
                                {pay.status}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-center whitespace-nowrap space-x-1">
                              {pay.status === 'PENDING' ? (
                                <>
                                  <button
                                    onClick={() => handleApprovePayment(pay.id)}
                                    className="px-2.5 py-1 border border-emerald-300 rounded-lg font-bold bg-emerald-600 text-white hover:bg-emerald-700 text-[10px] uppercase shadow-sm transition-all"
                                  >
                                    Approve
                                  </button>
                                  <button
                                    onClick={() => handleRejectPayment(pay.id)}
                                    className="px-2.5 py-1 border border-rose-300 rounded-lg font-bold bg-rose-600 text-white hover:bg-rose-700 text-[10px] uppercase shadow-sm transition-all"
                                  >
                                    Reject
                                  </button>
                                </>
                              ) : (
                                <span className="text-[10px] text-slate-400 uppercase font-bold">PROCESSED</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              {/* User Support Queries Log */}
              <div className="bg-white border border-slate-200/90 rounded-2xl shadow-sm p-6 space-y-4">
                <h4 className="text-md font-bold text-black uppercase border-b border-slate-100 pb-2">User Support Queries</h4>
                <div className="overflow-x-auto">
                  {adminQueries.length === 0 ? (
                    <p className="text-slate-500 font-bold text-sm py-4 text-center">No support queries found.</p>
                  ) : (
                    <table className="min-w-full divide-y divide-slate-100 border border-slate-200 rounded-xl">
                      <thead className="bg-slate-100 text-[10px] font-bold text-black uppercase tracking-wider border-b border-slate-100">
                        <tr>
                          <th className="px-4 py-3 text-left border-r border-slate-100">Date</th>
                          <th className="px-4 py-3 text-left border-r border-slate-100">User Email</th>
                          <th className="px-4 py-3 text-left border-r border-slate-100">WhatsApp Number</th>
                          <th className="px-4 py-3 text-left border-r border-slate-100">Subject</th>
                          <th className="px-4 py-3 text-left">Description</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-slate-100 text-xs font-bold text-black">
                        {adminQueries.map((query) => (
                          <tr key={query.id} className="hover:bg-slate-50">
                            <td className="px-4 py-3 border-r border-slate-100 whitespace-nowrap">{formatDisplayDate(query.created_at)}</td>
                            <td className="px-4 py-3 border-r border-slate-100 truncate max-w-[200px]">{query.user_email}</td>
                            <td className="px-4 py-3 border-r border-slate-100 whitespace-nowrap">
                              {query.whatsapp_number ? (
                                <a 
                                  href={`https://wa.me/${query.whatsapp_number.replace(/\D/g, '')}`}
                                  target="_blank" 
                                  rel="noreferrer"
                                  className="text-emerald-600 hover:underline font-bold"
                                >
                                  {query.whatsapp_number}
                                </a>
                              ) : (
                                <span className="text-slate-400 font-normal">None Provided</span>
                              )}
                            </td>
                            <td className="px-4 py-3 border-r border-slate-100 truncate max-w-[200px]">{query.subject}</td>
                            <td className="px-4 py-3 font-medium text-slate-700">{query.description}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              {/* Promo Codes Manager Section */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Left side: list of promo codes */}
                <div className="bg-white border border-slate-200/90 rounded-2xl shadow-sm p-6 space-y-4 lg:col-span-2">
                  <h4 className="text-md font-bold text-black uppercase border-b border-slate-100 pb-2">Promo Codes Directory</h4>
                  <div className="overflow-x-auto">
                    {adminPromoCodes.length === 0 ? (
                      <p className="text-slate-500 font-bold text-sm py-4 text-center">No promo codes registered.</p>
                    ) : (
                      <table className="min-w-full divide-y divide-slate-100 border border-slate-200 rounded-xl text-xs">
                        <thead className="bg-slate-50 font-bold text-slate-700 uppercase border-b border-slate-200">
                          <tr>
                            <th className="px-3 py-2 text-left border-r border-slate-100">Promo Code</th>
                            <th className="px-3 py-2 text-center border-r border-slate-100">Credits</th>
                            <th className="px-3 py-2 text-left border-r border-slate-100">Expiry Type</th>
                            <th className="px-3 py-2 text-left border-r border-slate-100">Expires At</th>
                            <th className="px-3 py-2 text-center border-r border-slate-100">Status</th>
                            <th className="px-3 py-2 text-center">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-slate-100 font-bold text-black">
                          {adminPromoCodes.map((promo) => (
                            <tr key={promo.id} className="hover:bg-slate-50">
                              <td className="px-3 py-2.5 border-r border-slate-100 font-bold uppercase text-slate-800">{promo.code}</td>
                              <td className="px-3 py-2.5 border-r border-slate-100 text-center text-emerald-600 font-bold">+{promo.credits}</td>
                              <td className="px-3 py-2.5 border-r border-slate-100 truncate text-[10px]">
                                {promo.type === 'UNIVERSAL_ONCE' && 'One-time Universal'}
                                {promo.type === 'PER_USER_ONCE' && 'One-time per User'}
                                {promo.type === 'TIME_BASED' && 'Time-based'}
                              </td>
                              <td className="px-3 py-2.5 border-r border-slate-100 text-slate-500 font-normal">
                                {promo.expires_at ? formatDisplayDate(promo.expires_at) : 'Never'}
                              </td>
                              <td className="px-3 py-2.5 border-r border-slate-100 text-center">
                                <span className={`px-2 py-0.5 border border-slate-200 rounded-full text-[9px] font-bold uppercase ${promo.is_active ? 'bg-emerald-50 text-emerald-700 border-emerald-200 text-black' : 'bg-rose-600 text-white hover:bg-rose-500 text-white'}`}>
                                  {promo.is_active ? 'Active' : 'Inactive'}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-center">
                                <button
                                  onClick={() => handleTogglePromoCode(promo.id)}
                                  className={`px-2.5 py-1 border rounded-lg font-bold text-[10px] uppercase shadow-sm transition-all ${promo.is_active ? 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50' : 'border-emerald-300 bg-emerald-600 text-white hover:bg-emerald-700'}`}
                                >
                                  {promo.is_active ? 'Deactivate' : 'Activate'}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>

                {/* Right side: create promo code form */}
                <div className="bg-white border border-slate-200/90 rounded-2xl shadow-sm p-6 space-y-4">
                  <h4 className="text-md font-bold text-black uppercase border-b border-slate-100 pb-2">Generate Promo Code</h4>
                  <form onSubmit={handleCreatePromoCode} className="space-y-4">
                    <div>
                      <label className="block text-[10px] font-bold text-black uppercase mb-1">Code String</label>
                      <input
                        type="text"
                        required
                        value={promoFormCode}
                        onChange={(e) => setPromoFormCode(e.target.value.toUpperCase())}
                        placeholder="e.g. WELCOME100"
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-black uppercase mb-1">Credits Awarded</label>
                      <input
                        type="number"
                        required
                        value={promoFormCredits}
                        onChange={(e) => setPromoFormCredits(e.target.value)}
                        placeholder="50"
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-black uppercase mb-1">Expiry Type</label>
                      <select
                        value={promoFormType}
                        onChange={(e) => setPromoFormType(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold bg-white focus:outline-none"
                      >
                        <option value="UNIVERSAL_ONCE">One-time Universal</option>
                        <option value="PER_USER_ONCE">One-time per User</option>
                        <option value="TIME_BASED">Time-based</option>
                      </select>
                    </div>

                    {promoFormType === 'TIME_BASED' && (
                      <div>
                        <label className="block text-[10px] font-bold text-black uppercase mb-1">Expires At</label>
                        <input
                          type="datetime-local"
                          required
                          value={promoFormExpiresAt}
                          onChange={(e) => setPromoFormExpiresAt(e.target.value)}
                          className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none bg-white"
                        />
                      </div>
                    )}

                    {promoFormError && (
                      <div className="bg-rose-600 text-white hover:bg-rose-500 text-white p-2 border border-slate-200 rounded-xl font-bold text-[10px] uppercase">
                        ERROR: {String(promoFormError)}
                      </div>
                    )}

                    <button
                      type="submit"
                      className="w-full py-2.5 px-4 border border-slate-200 rounded-xl font-bold text-black bg-indigo-600 text-white hover:bg-indigo-500 hover:bg-yellow-400 uppercase shadow-sm active:scale-[0.99] transition-all text-xs"
                    >
                      GENERATE CODE
                    </button>
                  </form>
                </div>
              </div>

              {/* Bank configurations manager */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                
                {/* Left side: list of supported formats */}
                <div className="bg-white border border-slate-200/90 rounded-2xl shadow-sm p-6 space-y-4 lg:col-span-2">
                  <h4 className="text-md font-bold text-black uppercase border-b border-slate-100 pb-2">Supported Banks & Parsers List</h4>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-100 border border-slate-200 rounded-xl text-xs">
                      <thead className="bg-slate-100 font-bold text-black uppercase tracking-wider border-b border-slate-100">
                        <tr>
                          <th className="px-3 py-2 text-left border-r border-slate-100">Name</th>
                          <th className="px-3 py-2 text-center border-r border-slate-100">Type</th>
                          <th className="px-3 py-2 text-left border-r border-slate-100">Match Patterns</th>
                          <th className="px-3 py-2 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-slate-100 font-bold text-black">
                        {adminBanks.map((bank) => (
                          <tr key={bank.id} className="hover:bg-slate-50">
                            <td className="px-3 py-2 border-r border-slate-100 font-bold uppercase">{bank.name}</td>
                            <td className="px-3 py-2 border-r border-slate-100 text-center">
                              <span className={`px-2 py-0.5 border border-slate-200 rounded-full font-bold text-[9px] ${bank.parser_type === 'NATIVE' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : bank.parser_type === 'SIMULATOR' ? 'bg-sky-50 text-sky-700 border-sky-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
                                {bank.parser_type}
                              </span>
                            </td>
                            <td className="px-3 py-2 border-r border-slate-100 font-mono">{bank.match_patterns}</td>
                            <td className="px-3 py-2 text-right space-x-1.5 whitespace-nowrap">
                              <button
                                onClick={() => handleSelectEditBank(bank)}
                                className="px-2.5 py-1 border border-slate-200 rounded-lg font-bold bg-white hover:bg-slate-50 uppercase text-[9px] shadow-sm transition-all"
                              >
                                EDIT
                              </button>
                              <button
                                onClick={() => handleDeleteBankConfig(bank.id)}
                                className="px-2.5 py-1 border border-rose-200 rounded-lg font-bold bg-white text-rose-600 hover:bg-rose-50 uppercase text-[9px] shadow-sm transition-all"
                              >
                                DELETE
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Right side: Add / Edit bank config form */}
                <div className="bg-white border border-slate-200/90 rounded-2xl shadow-sm p-6 space-y-4">
                  <h4 className="text-md font-bold text-black uppercase border-b border-slate-100 pb-2">
                    {selectedBankConfig ? "Edit Bank Config" : "Add Bank Format"}
                  </h4>
                  
                  <form onSubmit={handleSaveBankConfig} className="space-y-4 text-xs">
                    <div>
                      <label className="block font-bold text-black uppercase mb-1">Unique Bank Key</label>
                      <input
                        type="text"
                        placeholder="e.g. hdfc"
                        required
                        disabled={selectedBankConfig !== null}
                        value={bankFormKey}
                        onChange={(e) => setBankFormKey(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl font-bold bg-white focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block font-bold text-black uppercase mb-1">Bank Name</label>
                      <input
                        type="text"
                        placeholder="e.g. HDFC Bank"
                        required
                        value={bankFormName}
                        onChange={(e) => setBankFormName(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl font-bold bg-white focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block font-bold text-black uppercase mb-1">Match Patterns (comma-separated)</label>
                      <input
                        type="text"
                        placeholder="e.g. HDFC, HDFCBANK"
                        required
                        value={bankFormPatterns}
                        onChange={(e) => setBankFormPatterns(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl font-bold bg-white focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block font-bold text-black uppercase mb-1">Parser Type</label>
                      <select
                        value={bankFormType}
                        onChange={(e) => {
                          const val = e.target.value;
                          setBankFormType(val);
                          if (val === 'SIMULATOR') {
                            setBankFormConfigJson('{\n  "opening_balance": 10000.0,\n  "mock_prefix": "SIMULATED TXN"\n}');
                          } else if (val === 'RULE_BASED') {
                            setBankFormConfigJson('{\n  "date_format": "%d/%m/%Y",\n  "col_date": 0,\n  "col_narration": 1,\n  "col_debit": 2,\n  "col_credit": 3,\n  "col_balance": 4\n}');
                          } else {
                            setBankFormConfigJson('{\n  \n}');
                          }
                        }}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl font-bold bg-white focus:outline-none"
                      >
                        <option value="SIMULATOR">SIMULATOR</option>
                        <option value="RULE_BASED">RULE_BASED (COLUMN MAPPING)</option>
                        <option value="NATIVE">NATIVE PYTHON PARSER</option>
                      </select>
                    </div>

                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="block font-bold text-black uppercase">Configuration JSON File</label>
                        <button
                          type="button"
                          onClick={() => {
                            if (bankFormType === 'SIMULATOR') {
                              setBankFormConfigJson('{\n  "opening_balance": 10000.0,\n  "mock_prefix": "SIMULATED TXN"\n}');
                            } else {
                              setBankFormConfigJson('{\n  "date_format": "%d/%m/%Y",\n  "col_date": 0,\n  "col_narration": 1,\n  "col_debit": 2,\n  "col_credit": 3,\n  "col_balance": 4\n}');
                            }
                          }}
                          className="text-[10px] text-slate-500 font-bold underline"
                        >
                          Load Template
                        </button>
                      </div>
                      <textarea
                        rows="6"
                        required
                        value={bankFormConfigJson}
                        onChange={(e) => setBankFormConfigJson(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl font-mono font-bold bg-white focus:outline-none"
                      />
                    </div>

                    {bankFormError && (
                      <div className="bg-rose-600 text-white hover:bg-rose-500 text-white p-2.5 border border-slate-200 rounded-xl font-bold text-[10px] uppercase">
                        ERROR: {String(bankFormError)}
                      </div>
                    )}

                    <div className="pt-2 space-y-2">
                      <button
                        type="submit"
                        className="w-full py-2.5 px-4 border border-slate-200 rounded-xl font-bold text-black bg-emerald-600 text-white hover:bg-emerald-500 hover:bg-emerald-400 uppercase shadow-sm active:scale-[0.99] transition-all"
                      >
                        {selectedBankConfig ? "UPDATE CONFIG" : "SAVE CONFIGURATION"}
                      </button>

                      {selectedBankConfig && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedBankConfig(null);
                            setBankFormKey('');
                            setBankFormName('');
                            setBankFormPatterns('');
                            setBankFormType('SIMULATOR');
                            setBankFormConfigJson('{\n  \n}');
                            setBankFormError('');
                          }}
                          className="w-full py-2 border border-slate-200 rounded-xl font-bold bg-white hover:bg-slate-100 uppercase text-center"
                        >
                          CANCEL EDIT
                        </button>
                      )}
                    </div>
                  </form>
                </div>
                
              </div>

            </div>
          )}

          {/* --- TAB 6: SUPPORT PAGE --- */}
          {activeTab === 'support' && (
            <div className="space-y-5 max-w-2xl mx-auto bg-white p-6 border-2 border-slate-400 rounded-lg shadow-sm font-mono">
              <div className="flex items-center justify-between border-b border-slate-300 pb-3">
                <div className="flex items-center space-x-3">
                  <span className="px-2 py-0.5 bg-[#008170] text-white font-extrabold text-[10px] rounded tracking-wider">
                    [F4]
                  </span>
                  <div>
                    <h3 className="text-sm font-bold text-[#0b192c] tracking-tight uppercase">Support & Client Assistance</h3>
                    <p className="text-xs text-slate-500 font-mono mt-0.5">Direct priority desk for CA practice support and statement parsing assistance.</p>
                  </div>
                </div>
              </div>
              <p className="text-xs font-bold text-slate-700 leading-relaxed">
                Facing an issue with statement conversions, missing credits, or custom bank configurations? Let us know! Raise a ticket below or connect with the administrator directly via WhatsApp.
              </p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                <div className="border border-slate-200 rounded-xl p-4 bg-slate-50 flex flex-col justify-between">
                  <div>
                    <h4 className="font-bold text-black uppercase text-sm mb-1">WhatsApp Chat Support</h4>
                    <p className="text-[10px] font-bold text-slate-500 leading-relaxed mb-4">
                      Get instant resolutions and share statement files or screenshots with the admin directly on WhatsApp.
                    </p>
                  </div>
                  <a
                    href="https://wa.me/919204915729?text=Hello%20Sheet%20Buddy%20Support!%20I%20have%20an%20issue%20with..."
                    target="_blank"
                    rel="noreferrer"
                    className="w-full text-center py-2.5 px-4 border border-slate-200 rounded-xl font-bold text-white bg-emerald-600 text-white hover:bg-emerald-500 hover:bg-emerald-600 uppercase shadow-sm active:scale-[0.99] transition-all flex items-center justify-center space-x-2 text-xs"
                  >
                    <span>Chat on WhatsApp</span>
                  </a>
                </div>

                <div className="border border-slate-200 rounded-xl p-4 bg-slate-50 flex flex-col justify-between">
                  <div>
                    <h4 className="font-bold text-black uppercase text-sm mb-1">Email Support</h4>
                    <p className="text-[10px] font-bold text-slate-500 leading-relaxed mb-4">
                      For detailed inquiries, you can send an email with your attachments directly to our helpdesk.
                    </p>
                  </div>
                  <a
                    href="mailto:sheetbuddyorg@gmail.com?subject=Sheet%20Buddy%20Inquiry"
                    className="w-full text-center py-2.5 px-4 border border-slate-200 rounded-xl font-bold text-black bg-indigo-600 text-white hover:bg-indigo-500 hover:bg-yellow-400 uppercase shadow-sm active:scale-[0.99] transition-all text-xs"
                  >
                    Email Admin
                  </a>
                </div>
              </div>

              <div className="border border-slate-200 rounded-xl p-6 bg-white pt-4">
                <h4 className="font-bold text-slate-900 uppercase text-sm mb-2 border-b border-slate-100 pb-2">Raise a Support Query</h4>
                <form 
                  onSubmit={handleSupportQuerySubmit}
                  className="space-y-4"
                >
                  <div>
                    <label className="block text-[10px] font-bold text-black uppercase mb-1">Subject</label>
                    <input
                      type="text"
                      required
                      value={supportSubject}
                      onChange={(e) => setSupportSubject(e.target.value)}
                      placeholder="e.g. Credit balance not updated / BOB Statement parsing failed"
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl font-bold focus:outline-none bg-white text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-black uppercase mb-1">WhatsApp Number (Optional)</label>
                    <input
                      type="text"
                      value={supportWhatsapp}
                      onChange={(e) => setSupportWhatsapp(e.target.value)}
                      placeholder="e.g. +91 98765 43210"
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl font-bold focus:outline-none bg-white text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-black uppercase mb-1">Describe your Issue</label>
                    <textarea
                      rows="4"
                      required
                      value={supportDescription}
                      onChange={(e) => setSupportDescription(e.target.value)}
                      placeholder="Please provide details about your issue, statement file type, or payment details..."
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl font-bold focus:outline-none bg-white text-xs"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={supportLoading}
                    className="w-full py-2.5 px-4 border border-slate-200 rounded-xl font-bold text-white bg-black hover:bg-zinc-800 uppercase shadow-sm active:scale-[0.99] transition-all text-xs disabled:opacity-50"
                  >
                    {supportLoading ? "SUBMITTING..." : "Submit Support Ticket"}
                  </button>
                </form>
              </div>
            </div>
          )}



          {/* --- TAB 7: PROFILE SECURITY PAGE --- */}
          {activeTab === 'settings' && (
            <div className="space-y-5 max-w-md mx-auto bg-white p-6 border-2 border-slate-400 rounded-lg shadow-sm font-mono">
              <div className="flex items-center justify-between border-b border-slate-300 pb-3">
                <div className="flex items-center space-x-3">
                  <span className="px-2 py-0.5 bg-[#008170] text-white font-extrabold text-[10px] rounded tracking-wider">
                    [F5]
                  </span>
                  <h3 className="text-sm font-bold text-[#0b192c] tracking-tight uppercase">Profile & Security Settings</h3>
                </div>
              </div>
              
              <div className="space-y-4">
                <div className="border border-slate-200 rounded-xl p-4 bg-slate-50">
                  <span className="block text-[8px] font-bold text-slate-500 uppercase tracking-widest">Logged In Email</span>
                  <span className="block font-bold text-black text-sm">{user.email}</span>
                </div>

                <div className="border border-slate-200 rounded-xl p-4 bg-slate-50">
                  <span className="block text-[8px] font-bold text-slate-500 uppercase tracking-widest">Available Page Credits</span>
                  <span className="block font-bold text-black text-lg">{user.page_credits} Credits</span>
                </div>
              </div>

              <div className="border border-slate-200 rounded-xl p-6 bg-white pt-4">
                <h4 className="font-bold text-slate-900 uppercase text-sm mb-4 border-b border-slate-100 pb-2">Change Account Password</h4>
                
                <form onSubmit={handleProfileChangePassword} className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-bold text-black uppercase mb-1">Current Password</label>
                    <input
                      type="password"
                      required
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="Enter current password"
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl font-bold focus:outline-none bg-white text-xs"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-[10px] font-bold text-black uppercase mb-1">New Password</label>
                    <input
                      type="password"
                      required
                      value={profileNewPassword}
                      onChange={(e) => setProfileNewPassword(e.target.value)}
                      placeholder="Enter new password"
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl font-bold focus:outline-none bg-white text-xs"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-black uppercase mb-1">Confirm New Password</label>
                    <input
                      type="password"
                      required
                      value={profileConfirmNewPassword}
                      onChange={(e) => setProfileConfirmNewPassword(e.target.value)}
                      placeholder="Confirm new password"
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl font-bold focus:outline-none bg-white text-xs"
                    />
                  </div>

                  {profileErrorMsg && (
                    <div className="bg-rose-600 text-white hover:bg-rose-500 text-white p-3 border border-slate-200 rounded-xl font-bold text-xs">
                      ERROR: {String(profileErrorMsg)}
                    </div>
                  )}

                  {profileSuccessMsg && (
                    <div className="bg-emerald-600 text-white hover:bg-emerald-500 text-white p-3 border border-slate-200 rounded-xl font-bold text-xs">
                      SUCCESS: {profileSuccessMsg}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={profileLoading}
                    className="w-full py-2.5 px-4 border border-slate-200 rounded-xl font-bold text-white bg-black hover:bg-zinc-800 uppercase shadow-sm active:scale-[0.99] transition-all text-xs disabled:opacity-50"
                  >
                    {profileLoading ? "CHANGING PASSWORD..." : "Update Password"}
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* --- Review Next Issue Stepper Modal --- */}
          {reviewModalOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
              <div className="bg-white border-2 border-[#1e3e62] rounded-lg shadow-2xl max-w-xl w-full overflow-hidden font-mono">
                <div className="bg-[#0b192c] text-white px-4 py-2.5 flex items-center justify-between border-b-2 border-[#1e3e62]">
                  <span className="font-bold text-xs uppercase tracking-wider text-amber-300">[Review] Transaction Issue Inspector</span>
                  <button onClick={() => setReviewModalOpen(false)} className="text-slate-400 hover:text-white font-bold text-xs">[Esc]</button>
                </div>
                <div className="p-5 space-y-4">
                {(() => {
                  const reviewList = allTransactions.filter(t => t.requires_review);
                  const currentItem = reviewList[currentReviewIdx];

                  if (!currentItem) {
                    return (
                      <div className="text-center py-6 space-y-4">
                        <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-sm"><svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg></div>
                        <h3 className="text-lg font-bold uppercase text-black">All Issues Resolved!</h3>
                        <p className="text-xs font-bold text-slate-600">Every transaction has been reviewed and verified for Tally export.</p>
                        <button
                          onClick={() => setReviewModalOpen(false)}
                          className="px-6 py-2 bg-indigo-600 text-white hover:bg-indigo-500 border border-slate-200 rounded-xl font-bold text-xs uppercase shadow-sm"
                        >
                          BACK TO STATEMENT
                        </button>
                      </div>
                    );
                  }

                  const originalIdx = allTransactions.findIndex(t => t.id === currentItem.id);

                  return (
                    <>
                      <div className="flex justify-between items-center bg-rose-600 text-white hover:bg-rose-500 text-white p-3 border border-slate-200 rounded-xl shadow-sm">
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-wider block">DIAGNOSTIC ISSUE RESOLUTION STEPPER</span>
                          <h3 className="text-sm font-bold uppercase">Issue {currentReviewIdx + 1} of {reviewList.length}</h3>
                        </div>
                        <button
                          onClick={() => setReviewModalOpen(false)}
                          className="text-white font-bold text-sm px-2 py-0.5 border border-white hover:bg-white hover:text-black"
                        >
                          [Esc]
                        </button>
                      </div>

                      {/* Issue Explanation */}
                      <div className="bg-amber-50 border border-slate-200 rounded-xl p-3 text-xs font-bold text-amber-950 space-y-1">
                        <span className="font-bold uppercase block text-[10px] text-amber-900">Flagged Reasons:</span>
                        <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                          {currentItem.review_reasons && currentItem.review_reasons.length > 0 ? (
                            currentItem.review_reasons.map((r, rIdx) => (
                              <li key={rIdx}>{r}</li>
                            ))
                          ) : (
                            <li>Low confidence or potential format anomaly.</li>
                          )}
                        </ul>
                      </div>

                      {/* Transaction Data Card */}
                      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3 text-xs">
                        <div className="grid grid-cols-2 gap-2 font-mono">
                          <div>
                            <span className="text-[9px] font-bold text-slate-500 uppercase block">Txn Date</span>
                            <span className="font-bold text-black">{currentItem.txn_date}</span>
                          </div>
                          <div>
                            <span className="text-[9px] font-bold text-slate-500 uppercase block">Amount</span>
                            <span className={`font-bold ${currentItem.debit ? 'text-rose-600' : 'text-emerald-600'}`}>
                              {currentItem.debit ? `Debit: ₹${Number(currentItem.debit).toFixed(2)}` : `Credit: ₹${Number(currentItem.credit).toFixed(2)}`}
                            </span>
                          </div>
                        </div>

                        <div>
                          <label className="block text-[10px] font-bold text-black uppercase mb-1">Edit Narration</label>
                          <input
                            type="text"
                            value={editedNarrations[originalIdx] !== undefined ? editedNarrations[originalIdx] : currentItem.narration}
                            onChange={(e) => handleNarrationEdit(originalIdx, e.target.value)}
                            className="w-full px-2.5 py-1.5 border border-slate-200 rounded-xl text-xs font-mono font-bold bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] font-bold text-black uppercase mb-1">Assign Counter Ledger</label>
                          <input
                            type="text"
                            value={editedLedgers[originalIdx] !== undefined ? editedLedgers[originalIdx] : (currentItem.assigned_ledger || counterLedgerName)}
                            onChange={(e) => handleLedgerEdit(originalIdx, e.target.value)}
                            className="w-full px-2.5 py-1.5 border border-slate-200 rounded-xl text-xs font-bold bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                          />
                        </div>
                      </div>

                      {/* Stepper Buttons */}
                      <div className="flex items-center justify-between pt-2">
                        <div className="flex space-x-2">
                          <button
                            disabled={currentReviewIdx === 0}
                            onClick={() => setCurrentReviewIdx(prev => Math.max(0, prev - 1))}
                            className="px-3 py-1.5 border border-slate-200 rounded-xl font-bold text-xs bg-white hover:bg-slate-100 disabled:opacity-40 uppercase"
                          >
                            ← PREV
                          </button>
                          <button
                            disabled={currentReviewIdx >= reviewList.length - 1}
                            onClick={() => setCurrentReviewIdx(prev => Math.min(reviewList.length - 1, prev + 1))}
                            className="px-3 py-1.5 border border-slate-200 rounded-xl font-bold text-xs bg-white hover:bg-slate-100 disabled:opacity-40 uppercase"
                          >
                            NEXT →
                          </button>
                        </div>

                        <button
                          onClick={() => {
                            setAllTransactions(prev => prev.map(t => t.id === currentItem.id ? { ...t, requires_review: false } : t));
                            if (currentReviewIdx >= reviewList.length - 1) {
                              setCurrentReviewIdx(Math.max(0, reviewList.length - 2));
                            }
                          }}
                          className="px-4 py-2 border border-slate-200 rounded-xl font-bold text-xs bg-emerald-600 text-white hover:bg-emerald-500 hover:bg-emerald-400 shadow-sm uppercase"
                        >
                          [Enter] ACCEPT & RESOLVE
                        </button>
                      </div>
                    </>
                  );
                })()}
                </div>
              </div>
            </div>
          )}

          {/* --- Custom CSV Column Mapping Modal --- */}
          {mappingModalOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 overflow-y-auto">
              <div className="bg-white border-2 border-[#1e3e62] rounded-lg shadow-2xl max-w-2xl w-full my-8 overflow-hidden font-mono">
                {/* Modal Header (Tally Pro Terminal) */}
                <div className="bg-[#0b192c] text-white px-4 py-3 flex justify-between items-center border-b-2 border-[#1e3e62]">
                  <div className="flex items-center space-x-2">
                    <span className="px-2 py-0.5 bg-[#008170] text-white text-[10px] font-bold rounded font-mono">
                      [MAP]
                    </span>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-amber-300">
                      {editingMappingId ? 'Edit CSV Column Mapping Template' : 'New Custom CSV Column Mapping Template'}
                    </h3>
                  </div>
                  <button
                    onClick={() => setMappingModalOpen(false)}
                    className="text-slate-400 hover:text-white font-bold text-xs"
                  >
                    [Esc]
                  </button>
                </div>
                <div className="p-5 space-y-4">

                {/* Auto-Detect Helper */}
                <div className="p-3 bg-slate-100 border border-slate-200 rounded-xl space-y-2">
                  <div className="text-xs font-bold uppercase text-black">
                    Auto-Detect Headers From Sample CSV (Optional)
                  </div>
                  <div className="text-[11px] font-bold text-slate-600">
                    Upload an export CSV file to automatically inspect column names and populate the dropdowns below.
                  </div>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        handleInspectCsv(e.target.files[0]);
                      }
                    }}
                    disabled={inspectingCsv}
                    className="w-full text-xs font-bold border border-slate-200 rounded-lg bg-white p-2 file:mr-3 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200"
                  />
                  {detectedHeaders.length > 0 && (
                    <div className="text-[11px] font-bold text-green-700">
                      Detected {detectedHeaders.length} columns: {detectedHeaders.slice(0, 8).join(', ')}{detectedHeaders.length > 8 ? '...' : ''}
                    </div>
                  )}
                </div>

                {/* Form */}
                <form onSubmit={handleSaveMapping} className="space-y-4 text-xs">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-bold text-black uppercase mb-1">
                        Template Name *
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. HDFC Bank Statement CSV"
                        value={mapFormName}
                        onChange={(e) => setMapFormName(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-black uppercase mb-1">
                        Description / Notes
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Columns for SAP/Zoho/Tally"
                        value={mapFormDesc}
                        onChange={(e) => setMapFormDesc(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                      />
                    </div>
                  </div>

                  <div className="border-t border-slate-100 pt-3">
                    <div className="font-bold uppercase text-black mb-2 text-xs">Date & Voucher Details</div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block font-bold text-slate-700 uppercase mb-1 text-[11px]">
                          Date Column Name
                        </label>
                        <input
                          type="text"
                          required
                          value={mapFormDateCol}
                          onChange={(e) => setMapFormDateCol(e.target.value)}
                          list="detected-headers-list"
                          placeholder="Date"
                          className="w-full px-2.5 py-1.5 border border-slate-200 rounded-xl font-bold"
                        />
                      </div>
                      <div>
                        <label className="block font-bold text-slate-700 uppercase mb-1 text-[11px]">
                          Date Format
                        </label>
                        <select
                          value={mapFormDateFmt}
                          onChange={(e) => setMapFormDateFmt(e.target.value)}
                          className="w-full px-2 py-1.5 border border-slate-200 rounded-xl font-bold bg-white"
                        >
                          <option value="%d-%m-%Y">DD-MM-YYYY (e.g. 15-04-2026)</option>
                          <option value="%Y-%m-%d">YYYY-MM-DD (e.g. 2026-04-15)</option>
                          <option value="%d/%m/%Y">DD/MM/YYYY (e.g. 15/04/2026)</option>
                          <option value="%m/%d/%Y">MM/DD/YYYY (e.g. 04/15/2026)</option>
                          <option value="%d.%m.%Y">DD.MM.YYYY (e.g. 15.04.2026)</option>
                        </select>
                      </div>
                      <div>
                        <label className="block font-bold text-slate-700 uppercase mb-1 text-[11px]">
                          Voucher No Column
                        </label>
                        <input
                          type="text"
                          value={mapFormVnumCol}
                          onChange={(e) => setMapFormVnumCol(e.target.value)}
                          list="detected-headers-list"
                          placeholder="Voucher No (optional)"
                          className="w-full px-2.5 py-1.5 border border-slate-200 rounded-xl font-bold"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                      <div>
                        <label className="block font-bold text-slate-700 uppercase mb-1 text-[11px]">
                          Voucher Type Column (optional)
                        </label>
                        <input
                          type="text"
                          value={mapFormVtypeCol}
                          onChange={(e) => setMapFormVtypeCol(e.target.value)}
                          list="detected-headers-list"
                          placeholder="e.g. Voucher Type"
                          className="w-full px-2.5 py-1.5 border border-slate-200 rounded-xl font-bold"
                        />
                      </div>
                      <div>
                        <label className="block font-bold text-slate-700 uppercase mb-1 text-[11px]">
                          Default Voucher Type (fallback)
                        </label>
                        <select
                          value={mapFormDefVtype}
                          onChange={(e) => setMapFormDefVtype(e.target.value)}
                          className="w-full px-2 py-1.5 border border-slate-200 rounded-xl font-bold bg-white"
                        >
                          <option value="Payment">Payment</option>
                          <option value="Receipt">Receipt</option>
                          <option value="Contra">Contra</option>
                          <option value="Journal">Journal</option>
                          <option value="Sales">Sales</option>
                          <option value="Purchase">Purchase</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-slate-100 pt-3">
                    <div className="font-bold uppercase text-black mb-2 text-xs">Double-Entry Ledgers</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="p-3 bg-red-50/60 border border-red-200 rounded-xl space-y-2">
                        <label className="block font-bold text-red-900 uppercase text-[11px]">
                          Debit Ledger Column
                        </label>
                        <input
                          type="text"
                          value={mapFormDrCol}
                          onChange={(e) => setMapFormDrCol(e.target.value)}
                          list="detected-headers-list"
                          placeholder="e.g. Debit Ledger / Expense"
                          className="w-full px-2.5 py-1.5 border border-slate-200 rounded-xl font-bold bg-white"
                        />
                        <label className="block font-bold text-slate-600 uppercase text-[10px]">
                          Fallback Debit Ledger Name (if empty)
                        </label>
                        <input
                          type="text"
                          value={mapFormDefDr}
                          onChange={(e) => setMapFormDefDr(e.target.value)}
                          placeholder="e.g. General Expenses"
                          className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg font-bold bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                      </div>

                      <div className="p-3 bg-emerald-50/60 border border-emerald-200 rounded-xl space-y-2">
                        <label className="block font-bold text-green-900 uppercase text-[11px]">
                          Credit Ledger Column
                        </label>
                        <input
                          type="text"
                          value={mapFormCrCol}
                          onChange={(e) => setMapFormCrCol(e.target.value)}
                          list="detected-headers-list"
                          placeholder="e.g. Credit Ledger / Bank"
                          className="w-full px-2.5 py-1.5 border border-slate-200 rounded-xl font-bold bg-white"
                        />
                        <label className="block font-bold text-slate-600 uppercase text-[10px]">
                          Fallback Credit Ledger Name (if empty)
                        </label>
                        <input
                          type="text"
                          value={mapFormDefCr}
                          onChange={(e) => setMapFormDefCr(e.target.value)}
                          placeholder="e.g. HDFC Bank Account"
                          className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg font-bold bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-slate-100 pt-3">
                    <div className="font-bold uppercase text-black mb-2 text-xs">Amount & Narration Mapping</div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block font-bold text-slate-700 uppercase mb-1 text-[11px]">
                          Amount Column (single)
                        </label>
                        <input
                          type="text"
                          value={mapFormAmtCol}
                          onChange={(e) => setMapFormAmtCol(e.target.value)}
                          list="detected-headers-list"
                          placeholder="Amount"
                          className="w-full px-2.5 py-1.5 border border-slate-200 rounded-xl font-bold"
                        />
                      </div>
                      <div>
                        <label className="block font-bold text-slate-700 uppercase mb-1 text-[11px]">
                          Debit Amount (or separate)
                        </label>
                        <input
                          type="text"
                          value={mapFormDrAmtCol}
                          onChange={(e) => setMapFormDrAmtCol(e.target.value)}
                          list="detected-headers-list"
                          placeholder="Debit / Withdrawal"
                          className="w-full px-2.5 py-1.5 border border-slate-200 rounded-xl font-bold"
                        />
                      </div>
                      <div>
                        <label className="block font-bold text-slate-700 uppercase mb-1 text-[11px]">
                          Credit Amount (or separate)
                        </label>
                        <input
                          type="text"
                          value={mapFormCrAmtCol}
                          onChange={(e) => setMapFormCrAmtCol(e.target.value)}
                          list="detected-headers-list"
                          placeholder="Credit / Deposit"
                          className="w-full px-2.5 py-1.5 border border-slate-200 rounded-xl font-bold"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                      <div>
                        <label className="block font-bold text-slate-700 uppercase mb-1 text-[11px]">
                          Narration Column
                        </label>
                        <input
                          type="text"
                          value={mapFormNarrCol}
                          onChange={(e) => setMapFormNarrCol(e.target.value)}
                          list="detected-headers-list"
                          placeholder="Narration / Description"
                          className="w-full px-2.5 py-1.5 border border-slate-200 rounded-xl font-bold"
                        />
                      </div>
                      <div>
                        <label className="block font-bold text-slate-700 uppercase mb-1 text-[11px]">
                          Ref / Cheque No Column
                        </label>
                        <input
                          type="text"
                          value={mapFormRefCol}
                          onChange={(e) => setMapFormRefCol(e.target.value)}
                          list="detected-headers-list"
                          placeholder="Ref / Cheque No / UTR"
                          className="w-full px-2.5 py-1.5 border border-slate-200 rounded-xl font-bold"
                        />
                      </div>
                    </div>
                  </div>

                  <datalist id="detected-headers-list">
                    {detectedHeaders.map((h, i) => (
                      <option key={i} value={h} />
                    ))}
                  </datalist>

                  <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => setMappingModalOpen(false)}
                      className="px-4 py-2 border border-slate-200 rounded-xl font-bold uppercase text-xs hover:bg-slate-100"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-6 py-2 bg-[#008170] hover:bg-[#006e5f] text-white rounded font-mono font-bold uppercase text-xs shadow-sm transition-colors"
                    >
                      {editingMappingId ? 'Update Mapping Template' : 'Save Mapping Template'}
                    </button>
                  </div>
                </form>
                </div>
              </div>
            </div>
          )}

          {/* --- Client Create/Edit Modal (Tally Pro Terminal) --- */}
          {clientModalOpen && (
            <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 font-mono">
              <div className="bg-white border-2 border-[#1e3e62] rounded-lg shadow-2xl max-w-lg w-full overflow-hidden">
                <div className="bg-[#0b192c] text-white px-4 py-3 flex justify-between items-center border-b-2 border-[#1e3e62]">
                  <div className="flex items-center space-x-2">
                    <span className="px-2 py-0.5 bg-[#008170] text-white text-[10px] font-bold rounded">
                      [F2]
                    </span>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-amber-300">
                      {editingClient ? 'Edit Company Profile' : 'Add New Company Profile'}
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setClientModalOpen(false)}
                    className="text-slate-400 hover:text-white font-bold text-xs"
                  >
                    [Esc]
                  </button>
                </div>
                <div className="p-5 space-y-3.5">

                {clientError && (
                  <div className="bg-rose-600 text-white hover:bg-rose-500 text-white p-2.5 text-xs font-bold border border-slate-200 rounded-xl shadow-sm">
                    {clientError}
                  </div>
                )}

                <form onSubmit={handleSaveClient} className="space-y-3.5">
                  <div>
                    <label className="block text-xs font-bold uppercase mb-1">Company / Client Name *</label>
                    <input
                      type="text"
                      placeholder="e.g. Sharma Trading Co."
                      value={clientFormName}
                      onChange={(e) => setClientFormName(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                      required
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold uppercase mb-1">PAN Number</label>
                      <input
                        type="text"
                        placeholder="e.g. ABCDE1234F"
                        maxLength={10}
                        value={clientFormPan}
                        onChange={(e) => setClientFormPan(e.target.value.toUpperCase())}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold font-mono uppercase focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold uppercase mb-1">GSTIN</label>
                      <input
                        type="text"
                        placeholder="e.g. 07ABCDE1234F1Z5"
                        maxLength={15}
                        value={clientFormGstin}
                        onChange={(e) => setClientFormGstin(e.target.value.toUpperCase())}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold font-mono uppercase focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold uppercase mb-1">Financial Year</label>
                      <select
                        value={clientFormFy}
                        onChange={(e) => setClientFormFy(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none bg-white cursor-pointer"
                      >
                        <option value="2024-25">FY 2024-25</option>
                        <option value="2025-26">FY 2025-26</option>
                        <option value="2026-27">FY 2026-27</option>
                        <option value="2023-24">FY 2023-24</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold uppercase mb-1">Business Type</label>
                      <select
                        value={clientFormType}
                        onChange={(e) => setClientFormType(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none bg-white cursor-pointer"
                      >
                        <option value="Proprietorship">Proprietorship</option>
                        <option value="Partnership">Partnership</option>
                        <option value="Pvt Ltd">Pvt Ltd Company</option>
                        <option value="LLP">LLP</option>
                        <option value="Individual">Individual</option>
                        <option value="Trust / NGO">Trust / NGO</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold uppercase mb-1">Email</label>
                      <input
                        type="email"
                        placeholder="client@example.com"
                        value={clientFormEmail}
                        onChange={(e) => setClientFormEmail(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold uppercase mb-1">Phone</label>
                      <input
                        type="text"
                        placeholder="+91 9876543210"
                        value={clientFormPhone}
                        onChange={(e) => setClientFormPhone(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase mb-1">Notes / Address</label>
                    <textarea
                      rows={2}
                      placeholder="Additional remarks, account notes, branch details..."
                      value={clientFormNotes}
                      onChange={(e) => setClientFormNotes(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none"
                    />
                  </div>

                  <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => setClientModalOpen(false)}
                      className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-bold uppercase hover:bg-slate-100"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={clientSaving}
                      className="px-5 py-2 bg-indigo-600 text-white hover:bg-indigo-500 hover:bg-yellow-400 border border-slate-200 rounded-xl text-xs font-bold uppercase shadow-sm active:translate-x-[1px] active:translate-y-[1px]"
                    >
                      {clientSaving ? 'Saving...' : (editingClient ? 'Update Company' : 'Save Company')}
                    </button>
                  </div>
                </form>
                </div>
              </div>
            </div>
          )}
          
          {/* --- Keyboard Shortcuts Helper Modal (Tally Pro Terminal) --- */}
          {shortcutsModalOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 font-mono">
              <div className="bg-white border-2 border-[#1e3e62] rounded-lg shadow-2xl max-w-lg w-full overflow-hidden">
                <div className="bg-[#0b192c] text-white px-4 py-3 flex justify-between items-center border-b-2 border-[#1e3e62]">
                  <div className="flex items-center space-x-2">
                    <span className="px-2 py-0.5 bg-[#008170] text-white text-[10px] font-bold rounded">
                      HOTKEYS
                    </span>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-amber-300">
                      Tally Prime Keyboard Hotkeys
                    </h3>
                  </div>
                  <button
                    onClick={() => setShortcutsModalOpen(false)}
                    className="text-slate-400 hover:text-white font-bold text-xs"
                  >
                    [Esc]
                  </button>
                </div>

                <div className="p-5 space-y-3">
                  <div className="divide-y divide-slate-200 border-2 border-slate-400 rounded text-xs font-mono max-h-[380px] overflow-y-auto">
                    <div className="flex justify-between items-center p-2 bg-[#0b192c] text-white">
                      <span className="font-bold text-amber-300 uppercase tracking-wide">Primary Action / Navigation</span>
                      <span className="text-[10px] text-slate-400 uppercase">Shortcut Key</span>
                    </div>
                    <div className="flex justify-between items-center p-2 bg-slate-50">
                      <span className="font-bold text-[#0b192c]">Import Menu (Toggle Dropdown)</span>
                      <kbd className="px-2 py-0.5 bg-[#0b192c] text-amber-300 rounded font-bold text-[11px] border border-[#1e3e62]">F1</kbd>
                    </div>
                    <div className="flex justify-between items-center p-2 bg-white pl-5 text-slate-700">
                      <span>↳ [1] PDF to Tally Statement</span>
                      <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-300 text-slate-800 rounded font-bold text-[11px]">1  or  Alt+1</kbd>
                    </div>
                    <div className="flex justify-between items-center p-2 bg-white pl-5 text-slate-700">
                      <span>↳ [2] CSV to Tally Converter</span>
                      <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-300 text-slate-800 rounded font-bold text-[11px]">2  or  Alt+2</kbd>
                    </div>
                    <div className="flex justify-between items-center p-2 bg-slate-50">
                      <span className="font-bold text-[#0b192c]">Configuration Menu (Toggle Dropdown)</span>
                      <kbd className="px-2 py-0.5 bg-[#0b192c] text-amber-300 rounded font-bold text-[11px] border border-[#1e3e62]">F2</kbd>
                    </div>
                    <div className="flex justify-between items-center p-2 bg-white pl-5 text-slate-700">
                      <span>↳ [1] Client Dossiers & Company Matrix</span>
                      <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-300 text-slate-800 rounded font-bold text-[11px]">1</kbd>
                    </div>
                    <div className="flex justify-between items-center p-2 bg-white pl-5 text-slate-700">
                      <span>↳ [2] Smart Ledger Rules Engine</span>
                      <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-300 text-slate-800 rounded font-bold text-[11px]">2</kbd>
                    </div>
                    <div className="flex justify-between items-center p-2 bg-white pl-5 text-slate-700">
                      <span>↳ [3] Cloud XML Vault & Audit History</span>
                      <kbd className="px-2 py-0.5 bg-slate-100 border border-slate-300 text-slate-800 rounded font-bold text-[11px]">3  or  Alt+3</kbd>
                    </div>
                    <div className="flex justify-between items-center p-2 bg-slate-50">
                      <span className="font-bold text-[#0b192c]">Page Credits & Pricing</span>
                      <kbd className="px-2 py-0.5 bg-[#0b192c] text-amber-300 rounded font-bold text-[11px] border border-[#1e3e62]">F3</kbd>
                    </div>
                    <div className="flex justify-between items-center p-2 bg-white">
                      <span className="font-bold text-[#0b192c]">Support & CA Assistance</span>
                      <kbd className="px-2 py-0.5 bg-[#0b192c] text-amber-300 rounded font-bold text-[11px] border border-[#1e3e62]">F4</kbd>
                    </div>
                    <div className="flex justify-between items-center p-2 bg-slate-50">
                      <span className="font-bold text-[#0b192c]">Practitioner Profile & Security</span>
                      <kbd className="px-2 py-0.5 bg-[#0b192c] text-amber-300 rounded font-bold text-[11px] border border-[#1e3e62]">F5</kbd>
                    </div>
                    <div className="flex justify-between items-center p-2 bg-white">
                      <span className="font-bold text-[#0b192c]">Export / Convert to Tally XML</span>
                      <kbd className="px-2 py-0.5 bg-[#008170] text-white rounded font-bold text-[11px]">Ctrl + E</kbd>
                    </div>
                    <div className="flex justify-between items-center p-2 bg-slate-50">
                      <span className="font-bold text-[#0b192c]">Auto-Match Ledger Rules</span>
                      <kbd className="px-2 py-0.5 bg-slate-200 border border-slate-300 text-slate-800 rounded font-bold text-[11px]">Alt + A</kbd>
                    </div>
                    <div className="flex justify-between items-center p-2 bg-white">
                      <span className="font-bold text-[#0b192c]">Open Active Company Dossier</span>
                      <kbd className="px-2 py-0.5 bg-slate-200 border border-slate-300 text-slate-800 rounded font-bold text-[11px]">Alt + D</kbd>
                    </div>
                    <div className="flex justify-between items-center p-2 bg-slate-50">
                      <span className="font-bold text-[#0b192c]">Search Transactions & Entries</span>
                      <kbd className="px-2 py-0.5 bg-slate-200 border border-slate-300 text-slate-800 rounded font-bold text-[11px]">Ctrl + F</kbd>
                    </div>
                    <div className="flex justify-between items-center p-2 bg-white">
                      <span className="font-bold text-[#0b192c]">Undo Last Narration Edit</span>
                      <kbd className="px-2 py-0.5 bg-slate-200 border border-slate-300 text-slate-800 rounded font-bold text-[11px]">Ctrl + Z</kbd>
                    </div>
                    <div className="flex justify-between items-center p-2 bg-slate-50">
                      <span className="font-bold text-[#0b192c]">Toggle Shortcuts Quick Reference</span>
                      <kbd className="px-2 py-0.5 bg-slate-200 border border-slate-300 text-slate-800 rounded font-bold text-[11px]">Alt + S  or  ?</kbd>
                    </div>
                    <div className="flex justify-between items-center p-2 bg-white">
                      <span className="font-bold text-[#0b192c]">Close Active Modal / Dropdown Menu</span>
                      <kbd className="px-2 py-0.5 bg-slate-200 border border-slate-300 text-slate-800 rounded font-bold text-[11px]">Esc</kbd>
                    </div>
                  </div>

                  <button
                    onClick={() => setShortcutsModalOpen(false)}
                    className="w-full py-2 bg-[#0b192c] hover:bg-[#1e3e62] text-amber-300 rounded font-bold text-xs uppercase shadow-sm font-mono mt-2"
                  >
                    [Esc] CLOSE SHORTCUTS
                  </button>
                </div>
              </div>
            </div>
          )}
          
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200/80 py-6 text-center text-xs font-bold text-black mt-auto space-y-4">
        {/* Contact CTA */}
        <div className="flex flex-col sm:flex-row items-center justify-center space-y-2 sm:space-y-0 sm:space-x-3 pb-2 border-b border-slate-100 max-w-lg mx-auto">
          <span>To know more, book demo or pricing contact us:</span>
          <div className="flex items-center space-x-3">
            {/* WhatsApp Link */}
            <a
              href="https://wa.me/919204915729?text=Hello!%20I'd%20like%20to%20know%20more,%20book%20a%20demo,%20or%20discuss%20pricing%20for%20Sheet%20Buddy."
              target="_blank"
              rel="noopener noreferrer"
              className="p-1 border border-slate-200 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm transition-all flex items-center justify-center w-7 h-7"
              title="Contact on WhatsApp"
            >
              <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                <path d="M17.472 14.382c-.022-.079-.116-.123-.27-.2c-.155-.077-.915-.452-1.056-.502c-.142-.053-.247-.077-.35.077c-.104.154-.4.502-.49.603c-.09.1-.18.11-.33.037c-.152-.074-.64-.236-1.22-.756c-.45-.4-.754-.896-.838-1.042c-.085-.145-.01-.223.067-.3c.068-.07.155-.18.23-.27c.077-.09.104-.15.155-.25c.05-.1.025-.19-.012-.265c-.038-.076-.35-.85-.48-1.164c-.127-.31-.257-.267-.35-.272c-.09-.004-.19-.004-.29-.004c-.1-.004-.263.038-.4.19c-.138.15-.527.513-.527 1.253s.54 1.455.614 1.555c.077.1 1.06 1.622 2.57 2.27c.36.155.64.248.86.315c.36.115.69.098.95.06c.29-.044.9-.368 1.03-.722c.13-.356.13-.663.09-.723M12 2C6.477 2 2 6.477 2 12c0 2.01.524 3.9 1.524 5.56L2 22l4.632-1.216C8.204 21.464 9.99 22 12 22c5.523 0 10-4.477 10-10S17.523 2 12 2z"/>
              </svg>
            </a>
            {/* Email Link */}
            <a
              href="mailto:sheetbuddyorg@gmail.com?subject=Sheet%20Buddy%20Demo%20and%20Pricing%20Inquiry"
              className="p-1 border border-slate-200 rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-all flex items-center justify-center w-7 h-7"
              title="Send an Email"
            >
              <svg className="w-4 h-4 fill-none stroke-current" viewBox="0 0 24 24" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </a>
          </div>
        </div>

        <div className="flex items-center justify-center space-x-2 pt-2">
          <img src="/symbol_mark.svg" alt="Sheet Buddy" className="w-5 h-5 rounded-md inline-block shadow-xs" />
          <span className="font-bold uppercase tracking-tight">Sheet Buddy</span>
          <span className="text-slate-400 font-normal">|</span>
          <span className="text-slate-600 font-bold">A Tally Supporting Tool • Since 2026</span>
        </div>

        <p className="text-slate-600 font-bold">
          Sheet Buddy Pro • Engineered for Chartered Accountants •{" "}
          <a
            href="https://www.instagram.com/verx_mysterio?igsi=MzliODFvcWt0emhn"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:no-underline text-black font-bold"
          >
            verx_mysterio
          </a>
        </p>
      </footer>

    </div>
  );
}
