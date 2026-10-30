import React, { useState, useEffect } from 'react';

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
  const [bankName, setBankName] = useState('auto');
  const [supportedBanks, setSupportedBanks] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
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

  // --- Custom Tally Overrides ---
  const [tallyLedgerName, setTallyLedgerName] = useState('');
  const [counterLedgerName, setCounterLedgerName] = useState('Suspense');
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
    } else {
      localStorage.removeItem('token');
      setUser(null);
    }
  }, [token]);

  // Keyboard shortcut listener for productivity
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ctrl + F / Cmd + F -> Focus search input in convert or history table
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        const searchEl = document.getElementById('table-search-input') || document.getElementById('history-search-input');
        if (searchEl) {
          e.preventDefault();
          searchEl.focus();
          searchEl.select();
        }
      }
      // Ctrl + Z -> Undo last narration change
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        if (undoStack.length > 0) {
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
      }
      // Esc -> Close modals
      if (e.key === 'Escape') {
        setReviewModalOpen(false);
        setShortcutsModalOpen(false);
        setMappingModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undoStack, parsedSummary]);

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
        alert(err.detail || "Failed to save rule.");
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
          setBankName(prev => prev || data[0].bank_key);
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
      }

      alert(`Success! 100% Compliant Tally Prime XML generated for ${csvVouchers.length} vouchers (${pricing} credits deducted).`);
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
          setAuthError(data.detail || 'An error occurred during authentication.');
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
        setAuthError(data.detail || 'Invalid or expired OTP.');
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
        setAuthError(data.detail || 'Failed to resend OTP.');
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
    setAuthLoading(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: verificationEmail })
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.detail || 'Failed to request password recovery.');
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
    setAuthLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: verificationEmail,
          otp_code: otp,
          new_password: newPassword
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.detail || 'Invalid or expired OTP.');
      } else {
        setAuthMode('login');
        setIsRegistering(false);
        setEmail(verificationEmail);
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
        setProfileErrorMsg(data.detail || "Failed to change password.");
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
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
      setUploadError('');
      setParsedSummary(null);
      setEditedNarrations({});
    }
  };

  const handleUploadAndParse = async (e) => {
    e.preventDefault();
    if (!selectedFile) {
      setUploadError('Please select a PDF file first.');
      return;
    }

    setUploadLoading(true);
    setUploadError('');
    setParsedSummary(null);
    setEditedNarrations({});

    const formData = new FormData();
    formData.append('bank_name', bankName);
    formData.append('file', selectedFile);

    try {
      const res = await fetch('/api/convert/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });

      const data = await res.json();
      if (!res.ok) {
        setUploadError(data.detail || 'Failed to parse statement.');
      } else {
        setParsedSummary(data);
        const txList = data.all_transactions || data.transactions_preview || [];
        setAllTransactions(txList);
        setSelectedRowIds(new Set());
        const initialNarrs = {};
        const initialLedgers = {};
        txList.forEach((tx, index) => {
          initialNarrs[index] = tx.narration;
          initialLedgers[index] = tx.assigned_ledger || tx.suggested_ledger || counterLedgerName;
        });
        setEditedNarrations(initialNarrs);
        setEditedLedgers(initialLedgers);
      }
    } catch (err) {
      setUploadError('Network error. Failed to parse statement PDF.');
    } finally {
      setUploadLoading(false);
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

    const formattedPayload = {
      temp_file_id: parsedSummary.temp_file_id,
      bank_name: parsedSummary.bank_name || bankName,
      tally_bank_ledger_name: tallyLedgerName,
      counter_ledger_name: counterLedgerName,
      credit_voucher_type: creditVoucherType,
      debit_voucher_type: debitVoucherType,
      pages_count: parsedSummary.pages_count,
      file_fingerprint: parsedSummary.file_fingerprint,
      transactions: allTransactions.map((tx, idx) => ({
        ...tx,
        narration: editedNarrations[idx] !== undefined ? editedNarrations[idx] : tx.narration,
        assigned_ledger: editedLedgers[idx] !== undefined ? editedLedgers[idx] : (tx.assigned_ledger || counterLedgerName)
      }))
    };

    try {
      const res = await fetch('/api/convert/execute', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify(formattedPayload)
      });

      if (!res.ok) {
        const data = await res.json();
        setExecuteError(data.detail || 'Conversion execution failed.');
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
        setSelectedFile(null);
        setTallyLedgerName('');
        setCounterLedgerName('Suspense');
        setEditedNarrations({});
        setEditedLedgers({});
        setAllTransactions([]);
        
        fetchUserProfile();
        fetchHistory();
        fetchWalletTxs();
        
        setActiveTab('history');
      }
    } catch (err) {
      setExecuteError('Connection lost. Conversion failed.');
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
        alert(data.detail || "The XML file is no longer available in the cache.");
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
        setPurchaseMessage(data.detail || 'Purchase failed.');
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
        setCheckoutError(data.detail || 'Failed to register payment ticket.');
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
        setPromoFormError(data.detail || "Failed to create promo code.");
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
        alert(`Failed to toggle: ${data.detail}`);
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
        alert(data.detail || "Failed to submit query.");
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
        alert(`Approval failed: ${data.detail}`);
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
        alert(`Rejection failed: ${data.detail}`);
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
        setRedeemStatusMsg(data.detail || 'Redemption failed.');
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
        setBankFormError(err.detail || "Failed to save configuration.");
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
        setAdminNewUserError(data.detail || 'Failed to create user account.');
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
        alert(err.detail || "Credit adjustment failed.");
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
        alert(err.detail || "Action failed.");
      }
    } catch (e) {
      alert("Network error.");
    }
  };

  // Filter history list based on search bar query safely
  const filteredHistory = (conversionsHistory || []).filter(conv => {
    if (!conv) return false;
    const q = (historySearch || '').toLowerCase().trim();
    if (!q) return true;
    const bName = (conv.bank_name || '').toLowerCase();
    const period = (conv.statement_period || '').toLowerCase();
    const acc = (conv.account_number || '').toLowerCase();
    return bName.includes(q) || period.includes(q) || acc.includes(q);
  });

  // --- Auth View ---
  if (!token || !user) {
    return (
      <div className="min-h-screen flex flex-col bg-[#f4f2ed]">
        <div className="flex-grow flex flex-col justify-center py-12 px-4">
          <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
            <div className="flex justify-center text-black">
              <img 
                src="/symbol_mark.svg" 
                alt="Sheet Buddy Symbol" 
                className="w-20 h-20 border-4 border-black p-1 shadow-[4px_4px_0px_rgba(0,0,0,1)] bg-black object-contain mx-auto" 
              />
            </div>
            <h2 className="mt-5 text-center text-4xl font-black text-black tracking-tight uppercase">
              Sheet Buddy
            </h2>
            <p className="mt-2 text-center text-xs text-black border-2 border-black bg-white inline-block px-3 py-1 mx-auto shadow-[2px_2px_0px_rgba(0,0,0,1)] font-black uppercase tracking-wider">
              A Complete Tally Supporting Tool • Since 2026
            </p>
          </div>

          <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
            <div className="bg-white py-8 px-4 border-4 border-black shadow-[8px_8px_0px_rgba(0,0,0,1)] sm:rounded-none sm:px-10 space-y-6">
              
              {statusMessage && (
                <div className="bg-[#25D366] text-white p-3 border-2 border-black font-bold text-sm">
                  INFO: {statusMessage}
                </div>
              )}

              {authError && (
                <div className="bg-[#ff5757] text-white p-3 border-2 border-black font-bold text-sm">
                  ERROR: {authError}
                </div>
              )}

              {authMode === 'login' && (
                <form className="space-y-6" onSubmit={handleAuthSubmit}>
                  <div>
                    <label className="block text-sm font-black text-black uppercase">Email Address</label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="mt-1 block w-full px-3 py-2 border-2 border-black focus:outline-none focus:bg-yellow-50 text-sm font-bold"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-black text-black uppercase">Password</label>
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="mt-1 block w-full px-3 py-2 border-2 border-black focus:outline-none focus:bg-yellow-50 text-sm font-bold"
                    />
                  </div>

                  <div className="flex items-center">
                    <input
                      id="remember_me"
                      name="remember_me"
                      type="checkbox"
                      checked={remember}
                      onChange={(e) => setRemember(e.target.checked)}
                      className="h-4 w-4 text-black focus:ring-black border-2 border-black rounded-none cursor-pointer"
                    />
                    <label htmlFor="remember_me" className="ml-2 block text-xs font-black text-black uppercase cursor-pointer select-none">
                      Remember Me
                    </label>
                  </div>

                  <div>
                    <button
                      type="submit"
                      disabled={authLoading}
                      className="w-full flex justify-center py-2.5 px-4 border-2 border-black font-black text-black bg-[#ffd615] hover:bg-yellow-400 active:translate-x-[2px] active:translate-y-[2px] active:shadow-[1px_1px_0px_rgba(0,0,0,1)] shadow-[4px_4px_0px_rgba(0,0,0,1)] transition-all uppercase disabled:opacity-50"
                    >
                      {authLoading ? 'Logging in...' : 'Log In'}
                    </button>
                  </div>
                </form>
              )}

            </div>

            {/* Feature Capability Strip */}
            <div className="mt-6 bg-black border-4 border-black p-4 shadow-[6px_6px_0px_rgba(0,0,0,1)] text-center">
              <p className="text-[10px] font-black text-[#FFD629] uppercase tracking-widest mb-2 text-center">POWERFUL ACCOUNTING AUTOMATION</p>
              <img src="/feature_icons.svg" alt="Statements, Analytics, Automation, Validation, Export" className="w-full h-auto object-contain mx-auto" />
            </div>
          </div>
        </div>

        {/* Footer on Login Page */}
        <footer className="bg-white border-t-4 border-black py-6 text-center text-xs font-bold text-black mt-auto space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-center space-y-2 sm:space-y-0 sm:space-x-3 pb-2 border-b border-slate-100 max-w-lg mx-auto">
            <span>To know more, book demo or pricing contact us:</span>
            <div className="flex items-center space-x-3">
              {/* WhatsApp Link */}
              <a
                href="https://wa.me/919204915729?text=Hello!%20I'd%20like%20to%20know%20more,%20book%20a%20demo,%20or%20discuss%20pricing%20for%20Sheet%20Buddy."
                target="_blank"
                rel="noopener noreferrer"
                className="p-1 border-2 border-black bg-[#25D366] hover:bg-green-500 text-white rounded-none shadow-[2px_2px_0px_rgba(0,0,0,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0px_rgba(0,0,0,1)] transition-all flex items-center justify-center w-7 h-7"
                title="Contact on WhatsApp"
              >
                <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                  <path d="M17.472 14.382c-.022-.079-.116-.123-.27-.2c-.155-.077-.915-.452-1.056-.502c-.142-.053-.247-.077-.35.077c-.104.154-.4.502-.49.603c-.09.1-.18.11-.33.037c-.152-.074-.64-.236-1.22-.756c-.45-.4-.754-.896-.838-1.042c-.085-.145-.01-.223.067-.3c.068-.07.155-.18.23-.27c.077-.09.104-.15.155-.25c.05-.1.025-.19-.012-.265c-.038-.076-.35-.85-.48-1.164c-.127-.31-.257-.267-.35-.272c-.09-.004-.19-.004-.29-.004c-.1-.004-.263.038-.4.19c-.138.15-.527.513-.527 1.253s.54 1.455.614 1.555c.077.1 1.06 1.622 2.57 2.27c.36.155.64.248.86.315c.36.115.69.098.95.06c.29-.044.9-.368 1.03-.722c.13-.356.13-.663.09-.723M12 2C6.477 2 2 6.477 2 12c0 2.01.524 3.9 1.524 5.56L2 22l4.632-1.216C8.204 21.464 9.99 22 12 22c5.523 0 10-4.477 10-10S17.523 2 12 2z"/>
                </svg>
              </a>
              {/* Email Link */}
              <a
                href="mailto:sheetbuddyorg@gmail.com?subject=Sheet%20Buddy%20Demo%20and%20Pricing%20Inquiry"
                className="p-1 border-2 border-black bg-[#3b82f6] hover:bg-blue-500 text-white rounded-none shadow-[2px_2px_0px_rgba(0,0,0,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0px_rgba(0,0,0,1)] transition-all flex items-center justify-center w-7 h-7"
                title="Send an Email"
              >
                <svg className="w-4 h-4 fill-none stroke-current" viewBox="0 0 24 24" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </a>
            </div>
          </div>

          <div className="flex items-center justify-center space-x-2 pt-2">
            <img src="/symbol_mark.svg" alt="Sheet Buddy" className="w-5 h-5 border border-black bg-black inline-block" />
            <span className="font-black uppercase tracking-tight">Sheet Buddy</span>
            <span className="text-slate-400 font-normal">|</span>
            <span className="text-slate-600 font-bold">A Tally Supporting Tool • Since 2026</span>
          </div>

          <p className="text-slate-600 font-bold">
            Build with ❤️ by{" "}
            <a
              href="https://www.instagram.com/verx_mysterio?igsi=MzliODFvcWt0emhn"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:no-underline text-black font-black"
            >
              verx_mysterio
            </a>
          </p>
        </footer>
      </div>
    );
  }

  // --- Main Brutalist Header Navigation Dashboard View ---
  return (
    <div className="min-h-screen flex flex-col bg-[#f4f2ed]">
      
      {/* Top Header containing Navigation Menu, Logo, and User stats */}
      <header className="bg-white border-b-4 border-black sticky top-0 z-50 shadow-[0px_4px_0px_rgba(0,0,0,0.05)] w-full max-w-full">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between w-full max-w-full">
          
          {/* Left: Brand Logo & Mobile hamburger toggle */}
          <div className="h-16 flex items-center justify-between px-5 border-b-2 lg:border-b-0 lg:border-r-4 border-black bg-[#ffd615] flex-shrink-0">
            <div className="flex items-center space-x-2.5 cursor-pointer" onClick={() => { setActiveTab('convert'); setExecuteError(''); }}>
              <img src="/symbol_mark.svg" alt="Sheet Buddy Logo" className="w-8 h-8 border-2 border-black rounded-none shadow-[2px_2px_0px_rgba(0,0,0,1)] bg-black flex-shrink-0" />
              <div>
                <span className="font-black text-black text-lg tracking-tight uppercase block leading-none">Sheet Buddy</span>
                <span className="text-[8px] font-black text-black opacity-75 uppercase tracking-wider block mt-0.5">Tally Companion • 2026</span>
              </div>
            </div>

            {/* Hamburger Icon button for mobile screen */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden p-1.5 border-2 border-black bg-white hover:bg-slate-100 text-black focus:outline-none shadow-[2px_2px_0px_rgba(0,0,0,1)]"
              aria-label="Toggle navigation"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                {mobileMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>

          {/* Center Navigation: Single row desktop with horizontal scrollbar if needed */}
          <div className={`${mobileMenuOpen ? 'flex' : 'hidden'} lg:flex flex-col lg:flex-row flex-1 items-stretch lg:items-center justify-between min-w-0 overflow-hidden`}>
            <nav className="flex flex-col lg:flex-row lg:flex-nowrap items-stretch lg:items-center p-2 gap-2 flex-1 min-w-0 overflow-x-auto border-b-2 lg:border-b-0 border-black scrollbar-thin">
              <button
                onClick={() => { setActiveTab('convert'); setExecuteError(''); setMobileMenuOpen(false); }}
                className={`min-w-[130px] px-3.5 py-2 text-xs font-black border-2 border-black uppercase tracking-wider transition-all whitespace-nowrap text-center flex-shrink-0 ${activeTab === 'convert' ? 'bg-[#ffd615] text-black shadow-[2px_2px_0px_rgba(0,0,0,1)] -translate-y-[1px]' : 'bg-white hover:bg-yellow-50 text-black'}`}
              >
                IMPORT TRANSACTION
              </button>
              <button
                onClick={() => { setActiveTab('csv'); setExecuteError(''); setMobileMenuOpen(false); }}
                className={`min-w-[130px] px-3.5 py-2 text-xs font-black border-2 border-black uppercase tracking-wider transition-all whitespace-nowrap text-center flex-shrink-0 ${activeTab === 'csv' ? 'bg-[#ffd615] text-black shadow-[2px_2px_0px_rgba(0,0,0,1)] -translate-y-[1px]' : 'bg-white hover:bg-yellow-50 text-black'}`}
              >
                CSV TO TALLY
              </button>
              <button
                onClick={() => { setActiveTab('rules'); setExecuteError(''); setMobileMenuOpen(false); }}
                className={`min-w-[130px] px-3.5 py-2 text-xs font-black border-2 border-black uppercase tracking-wider transition-all whitespace-nowrap text-center flex-shrink-0 ${activeTab === 'rules' ? 'bg-[#ffd615] text-black shadow-[2px_2px_0px_rgba(0,0,0,1)] -translate-y-[1px]' : 'bg-white hover:bg-yellow-50 text-black'}`}
              >
                LEDGER RULES
              </button>
              <button
                onClick={() => { setActiveTab('history'); setExecuteError(''); setMobileMenuOpen(false); }}
                className={`min-w-[130px] px-3.5 py-2 text-xs font-black border-2 border-black uppercase tracking-wider transition-all whitespace-nowrap text-center flex-shrink-0 ${activeTab === 'history' ? 'bg-[#ffd615] text-black shadow-[2px_2px_0px_rgba(0,0,0,1)] -translate-y-[1px]' : 'bg-white hover:bg-yellow-50 text-black'}`}
              >
                HISTORY ARCHIVE
              </button>
              <button
                onClick={() => { setActiveTab('wallet'); setExecuteError(''); setMobileMenuOpen(false); }}
                className={`min-w-[130px] px-3.5 py-2 text-xs font-black border-2 border-black uppercase tracking-wider transition-all whitespace-nowrap text-center flex-shrink-0 ${activeTab === 'wallet' ? 'bg-[#ffd615] text-black shadow-[2px_2px_0px_rgba(0,0,0,1)] -translate-y-[1px]' : 'bg-white hover:bg-yellow-50 text-black'}`}
              >
                BUY CREDITS
              </button>
              <button
                onClick={() => { setActiveTab('support'); setExecuteError(''); setMobileMenuOpen(false); }}
                className={`min-w-[130px] px-3.5 py-2 text-xs font-black border-2 border-black uppercase tracking-wider transition-all whitespace-nowrap text-center flex-shrink-0 ${activeTab === 'support' ? 'bg-[#ffd615] text-black shadow-[2px_2px_0px_rgba(0,0,0,1)] -translate-y-[1px]' : 'bg-white hover:bg-yellow-50 text-black'}`}
              >
                CONTACT SUPPORT
              </button>
              <button
                onClick={() => { 
                  setActiveTab('settings'); 
                  setExecuteError(''); 
                  setMobileMenuOpen(false);
                  setCurrentPassword('');
                  setProfileNewPassword('');
                  setProfileConfirmNewPassword('');
                  setProfileSuccessMsg('');
                  setProfileErrorMsg('');
                }}
                className={`min-w-[130px] px-3.5 py-2 text-xs font-black border-2 border-black uppercase tracking-wider transition-all whitespace-nowrap text-center flex-shrink-0 ${activeTab === 'settings' ? 'bg-[#ffd615] text-black shadow-[2px_2px_0px_rgba(0,0,0,1)] -translate-y-[1px]' : 'bg-white hover:bg-yellow-50 text-black'}`}
              >
                PROFILE SECURITY
              </button>
              {user.is_admin && (
                <button
                  onClick={() => { setActiveTab('admin'); setExecuteError(''); setMobileMenuOpen(false); }}
                  className={`min-w-[130px] px-3.5 py-2 text-xs font-black border-2 border-black uppercase tracking-wider transition-all whitespace-nowrap text-center flex-shrink-0 ${activeTab === 'admin' ? 'bg-[#ffd615] text-black shadow-[2px_2px_0px_rgba(0,0,0,1)] -translate-y-[1px]' : 'bg-white hover:bg-yellow-50 text-black'}`}
                >
                  ADMIN CONSOLE
                </button>
              )}
            </nav>

            {/* Right: User Credits status and logout - strictly contained within page border */}
            <div className="flex items-center justify-between sm:justify-end px-5 py-2.5 space-x-3 border-t-2 lg:border-t-0 lg:border-l-4 border-black bg-slate-50 flex-shrink-0 self-stretch lg:self-center">
              <div className="flex items-center space-x-1.5 bg-white px-3 py-1.5 border-2 border-black shadow-[2px_2px_0px_rgba(0,0,0,1)] flex-shrink-0">
                <span className="text-xs font-black text-black">{user.page_credits}</span>
                <span className="text-[10px] font-black uppercase text-slate-600">Credits</span>
              </div>
              <button
                onClick={handleLogout}
                className="px-3.5 py-1.5 border-2 border-black font-black text-xs uppercase text-black bg-white hover:bg-[#ff5757] hover:text-white shadow-[2px_2px_0px_rgba(0,0,0,1)] transition-all flex-shrink-0"
              >
                LOGOUT
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Workspace */}
      <main className="flex-1 overflow-y-auto p-8">

        {checkoutSession ? (
          <div className="bg-white border-4 border-black shadow-[8px_8px_0px_rgba(0,0,0,1)] p-8 max-w-lg mx-auto space-y-6">
            <div className="bg-[#ffd615] p-4 border-2 border-black shadow-[2px_2px_0px_rgba(0,0,0,1)] flex items-center space-x-3">
              <span className="text-2xl">💳</span>
              <div>
                <h3 className="text-lg font-black text-black uppercase">Secure Checkout</h3>
                <p className="text-xs font-bold text-slate-700">Sheet Buddy Payment Gateway Integration</p>
              </div>
            </div>

            {/* Plan Details Box */}
            <div className="bg-slate-100 p-4 border-2 border-black text-sm font-bold space-y-2">
              <div className="flex justify-between">
                <span>Selected Plan:</span>
                <span className="font-black text-black uppercase">{checkoutSession.planName}</span>
              </div>
              <div className="flex justify-between">
                <span>Page Credits:</span>
                <span className="font-black text-black">{checkoutSession.pages} Pages</span>
              </div>
              <div className="flex justify-between border-t-2 border-black border-dashed pt-2 text-md">
                <span>Amount Due:</span>
                <span className="font-black text-black text-lg">₹{checkoutSession.amount.toFixed(2)}</span>
              </div>
            </div>

            {/* Payment Details & QR Code */}
            <div className="flex flex-col items-center space-y-4 py-4 border-2 border-black bg-white shadow-[4px_4px_0px_rgba(0,0,0,1)]">
              <span className="text-xs font-black text-black uppercase tracking-wider">Scan QR Code to Pay ₹{checkoutSession.amount.toFixed(2)}</span>
              
              <img 
                src="/QR-CODE.jpeg" 
                className="w-48 h-48 border-4 border-black object-contain" 
                alt="Payment QR Code" 
              />
              
              <span className="text-[10px] font-bold text-slate-500 uppercase">GPay / PhonePe / Paytm / Any UPI App</span>
            </div>

            <div className="bg-amber-50 border-2 border-black p-4 text-xs font-bold text-amber-900 space-y-2 leading-relaxed">
              <p className="font-black uppercase text-amber-950">⚠️ Action Required:</p>
              <p>
                Please pay exactly <span className="font-black text-black">₹{checkoutSession.amount.toFixed(2)}</span> using the QR code above.
              </p>
              <p>
                Once payment is complete, click the button below to send your **payment screenshot** along with your registered email account (**{user.email}**) to our WhatsApp number **+919204915729**.
              </p>
              <p className="italic text-[10px]">
                Your credits will be activated immediately upon admin confirmation.
              </p>
            </div>

            {checkoutError && (
              <div className="bg-[#ff5757] text-white p-3 border-2 border-black font-bold text-xs shadow-[2px_2px_0px_rgba(0,0,0,1)] uppercase">
                ERROR: {checkoutError}
              </div>
            )}

            <div className="space-y-3 pt-2">
              <button
                onClick={handleWhatsAppCheckout}
                disabled={paymentLoading}
                className="w-full flex justify-center py-3 px-4 border-2 border-black font-black text-white bg-[#25D366] hover:bg-[#1ebd58] hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[4px_4px_0px_rgba(0,0,0,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0px_rgba(0,0,0,1)] shadow-[2px_2px_0px_rgba(0,0,0,1)] transition-all uppercase text-center text-xs disabled:opacity-50 font-bold"
              >
                {paymentLoading ? 'REGISTING TICKET...' : 'Send Screenshot on WhatsApp'}
              </button>

              <button
                type="button"
                onClick={() => setCheckoutSession(null)}
                className="w-full text-center py-2 px-4 border-2 border-black font-black text-black bg-white hover:bg-slate-50 uppercase text-xs shadow-[2px_2px_0px_rgba(0,0,0,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0px_rgba(0,0,0,1)] transition-all"
              >
                CANCEL & GO BACK
              </button>
            </div>
          </div>
        ) : (
          <>

        {/* --- TAB 1: CONVERT STATEMENT --- */}
        {activeTab === 'convert' && (
          <div className="space-y-6">
            
            {/* Top Brand Banner */}
            {!parsedSummary && (
              <div className="bg-black text-white p-4 border-4 border-black shadow-[6px_6px_0px_rgba(0,0,0,1)] max-w-2xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center space-x-3">
                  <img src="/symbol_mark.svg" alt="Sheet Buddy" className="w-10 h-10 border border-yellow-400 bg-black flex-shrink-0" />
                  <div>
                    <h3 className="font-black text-sm text-[#FFD629] uppercase tracking-wider">BANK STATEMENT → TALLY VOUCHERS</h3>
                    <p className="text-[10px] font-bold text-slate-300">Fast, Automated & Mathematically Reconciled XML Export</p>
                  </div>
                </div>
                <span className="px-3 py-1 bg-[#FFD629] text-black text-[10px] font-black uppercase shadow-[2px_2px_0px_rgba(255,255,255,1)]">SINCE 2026</span>
              </div>
            )}
            
            {/* UPLOAD FORM */}
            {!parsedSummary && (
              <div className="bg-white border-4 border-black shadow-[8px_8px_0px_rgba(0,0,0,1)] p-6 max-w-2xl mx-auto">
                <div className="flex items-center space-x-3 mb-6 bg-[#ffd615] p-3 border-2 border-black shadow-[2px_2px_0px_rgba(0,0,0,1)]">
                  <div className="p-0.5 bg-white border-2 border-black text-black">
                    <img src="/app_icon_yellow.svg" alt="SB Icon" className="w-8 h-8" />
                  </div>
                  <div>
                    <h2 className="text-lg font-black text-black uppercase">Import BANK PDF Statement</h2>
                    <p className="text-xs font-bold text-black opacity-80">Converts statement layout coordinates into Tally Vouchers</p>
                  </div>
                </div>

                <form onSubmit={handleUploadAndParse} className="space-y-6">
                  <div>
                    <label className="block text-sm font-black text-black uppercase mb-1">Select Bank Statement Format</label>
                    <select
                      value={bankName}
                      onChange={(e) => setBankName(e.target.value)}
                      className="w-full pl-3 pr-10 py-2.5 text-sm border-2 border-black font-bold focus:outline-none focus:bg-yellow-50 bg-white"
                    >
                      {supportedBanks.map((b) => (
                        <option key={b.bank_key} value={b.bank_key}>{b.name}</option>
                      ))}
                    </select>
                    {supportedBanks.find((b) => b.name === bankName)?.parser_type === "SIMULATOR" && (
                      <p className="mt-2 text-xs font-black text-black bg-[#3fecff] border-2 border-black px-2 py-0.5 inline-block">
                        MOCK SIMULATOR ACTIVE: You can upload any test PDF to try.
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-black text-black uppercase mb-1">Upload File (PDF)</label>
                    <div className="flex justify-center px-6 pt-8 pb-8 border-4 border-black border-dashed rounded-none hover:bg-yellow-50/20 cursor-pointer bg-slate-50 transition-colors">
                      <div className="space-y-3 text-center">
                        <img 
                          src="/symbol_mark.svg" 
                          alt="PDF Upload" 
                          className="mx-auto h-12 w-12 border-2 border-black bg-black p-1 shadow-[3px_3px_0px_rgba(0,0,0,1)]" 
                        />
                        <div className="flex text-sm justify-center">
                          <label className="relative cursor-pointer bg-transparent rounded-none font-black text-black underline hover:no-underline">
                            <span>Choose bank statement PDF</span>
                            <input
                              type="file"
                              accept=".pdf"
                              onChange={handleFileUploadChange}
                              className="sr-only"
                            />
                          </label>
                        </div>
                        <p className="text-xs font-bold text-slate-500">Maximum size limit: 15MB</p>
                      </div>
                    </div>
                  </div>

                  {selectedFile && (
                    <div className="bg-white p-3 border-2 border-black shadow-[2px_2px_0px_rgba(0,0,0,1)] flex items-center justify-between text-xs font-bold">
                      <span className="text-black truncate max-w-md">{selectedFile.name}</span>
                      <button
                        type="button"
                        onClick={() => setSelectedFile(null)}
                        className="text-[#ff4b3f] hover:underline uppercase font-black"
                      >
                        Remove
                      </button>
                    </div>
                  )}

                  {uploadError && (
                    <div className="bg-[#ff5757] text-white p-3 border-2 border-black font-bold text-sm shadow-[2px_2px_0px_rgba(0,0,0,1)]">
                      ERROR: {uploadError}
                    </div>
                  )}

                  <div className="pt-2">
                    <button
                      type="submit"
                      disabled={uploadLoading || !selectedFile}
                      className="w-full flex justify-center py-3 px-4 border-2 border-black font-black text-black bg-[#ffd615] hover:bg-yellow-400 hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[6px_6px_0px_rgba(0,0,0,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[2px_2px_0px_rgba(0,0,0,1)] shadow-[4px_4px_0px_rgba(0,0,0,1)] transition-all uppercase disabled:opacity-50"
                    >
                      {uploadLoading ? 'Uploading & Extracting PDF Data...' : 'PARSE STATEMENT PDF'}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* DETAILED STATS PREVIEW & EXECUTION STEP */}
            {parsedSummary && (
              <div className="space-y-8 max-w-6xl mx-auto">
                
                {/* 1. Multi-Signal Auto-Detected Bank Banner */}
                <div className="bg-black text-white p-5 border-4 border-black shadow-[6px_6px_0px_rgba(0,0,0,1)] flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                  <div className="flex items-center space-x-3.5">
                    <img src="/symbol_mark.svg" alt="Bank Logo" className="w-11 h-11 border-2 border-[#FFD629] bg-black p-0.5 flex-shrink-0" />
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="text-[10px] font-black uppercase tracking-widest text-[#FFD629]">
                          INTELLIGENT DETECTION ENGINE
                        </span>
                        <span className="bg-[#3affaa] text-black text-[9px] font-black px-1.5 py-0.2 border border-black uppercase">
                          {parsedSummary.detection_confidence ? `${Math.round(parsedSummary.detection_confidence)}% CONFIDENCE` : 'HIGH CONFIDENCE'}
                        </span>
                      </div>
                      <h3 className="text-xl font-black text-white tracking-tight uppercase mt-0.5">
                        {parsedSummary.bank_name || parsedSummary.detected_bank || 'Standard Bank Statement'}
                      </h3>
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        <span className="bg-zinc-800 text-zinc-300 text-[10px] font-mono font-bold px-2 py-0.5 border border-zinc-700">
                          TYPE: {parsedSummary.document_type || 'NATIVE_PDF'}
                        </span>
                        {parsedSummary.account_number && (
                          <span className="bg-zinc-800 text-zinc-300 text-[10px] font-mono font-bold px-2 py-0.5 border border-zinc-700">
                            A/C: {parsedSummary.account_number}
                          </span>
                        )}
                        {parsedSummary.statement_period && (
                          <span className="bg-zinc-800 text-zinc-300 text-[10px] font-mono font-bold px-2 py-0.5 border border-zinc-700">
                            PERIOD: {parsedSummary.statement_period}
                          </span>
                        )}
                        {parsedSummary.detection_signals && parsedSummary.detection_signals.slice(0, 3).map((sig, sIdx) => (
                          <span key={sIdx} className="bg-yellow-400 text-black text-[9px] font-mono font-bold px-1.5 py-0.5 border border-black">
                            {sig}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-2 self-stretch md:self-auto justify-end">
                    <button
                      onClick={() => setShortcutsModalOpen(true)}
                      className="px-3 py-1.5 bg-white text-black font-black text-xs border-2 border-black hover:bg-slate-100 shadow-[2px_2px_0px_rgba(255,255,255,1)] uppercase"
                      title="View Keyboard Shortcuts"
                    >
                      ⌨️ SHORTCUTS
                    </button>
                    <button
                      onClick={() => {
                        setParsedSummary(null);
                        setSelectedFile(null);
                        setAllTransactions([]);
                      }}
                      className="px-3 py-1.5 bg-[#ff5757] text-white font-black text-xs border-2 border-black hover:bg-red-600 shadow-[2px_2px_0px_rgba(255,255,255,1)] uppercase"
                    >
                      RE-UPLOAD
                    </button>
                  </div>
                </div>

                {/* Warning Alerts */}
                {parsedSummary.is_duplicate && (
                  <div className="bg-[#ffde47] border-4 border-black p-4 text-sm font-bold text-black flex items-start space-x-3 shadow-[4px_4px_0px_rgba(0,0,0,1)]">
                    <svg className="w-6 h-6 text-black flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <div>
                      <span className="font-black uppercase block">DUPLICATE STATEMENT FILE WARNING:</span>
                      This PDF has already been successfully converted before. Re-converting is allowed, but ensure you are not importing duplicate entries into Tally.
                    </div>
                  </div>
                )}

                {!parsedSummary.reconciled && (
                  <div className="bg-[#ff5757] border-4 border-black p-4 text-sm font-bold text-white flex items-start space-x-3 shadow-[4px_4px_0px_rgba(0,0,0,1)]">
                    <svg className="w-6 h-6 text-white flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <div>
                      <span className="font-black uppercase block">RECONCILIATION AUDIT WARNING:</span>
                      The transaction sum (Opening + Credits - Debits) differs from the reported Closing Balance {parsedSummary.reconciliation_discrepancy ? `by ₹${Math.abs(parsedSummary.reconciliation_discrepancy).toFixed(2)}` : ''}. Review highlighted rows below.
                    </div>
                  </div>
                )}

                {/* Analytics Metric Cards Grid */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="bg-white p-4 border-4 border-black shadow-[4px_4px_0px_rgba(0,0,0,1)] flex flex-col justify-between">
                    <p className="text-[10px] font-black text-black uppercase tracking-wider">Total Transactions</p>
                    <p className="text-3xl font-black text-black mt-1">{allTransactions.length || parsedSummary.transactions_count}</p>
                    <span className="text-[10px] text-slate-500 font-bold mt-1">{parsedSummary.pages_count} PDF Pages</span>
                  </div>

                  <div className="bg-white p-4 border-4 border-black shadow-[4px_4px_0px_rgba(0,0,0,1)] flex flex-col justify-between">
                    <p className="text-[10px] font-black text-black uppercase tracking-wider">Opening Balance</p>
                    <p className="text-xl font-black text-black mt-1">₹{(parsedSummary.opening_balance || 0).toLocaleString('en-IN', {minimumFractionDigits: 2})}</p>
                    <span className="text-[10px] text-slate-500 font-bold mt-1">Start of Period</span>
                  </div>

                  <div className="bg-white p-4 border-4 border-black shadow-[4px_4px_0px_rgba(0,0,0,1)] flex flex-col justify-between">
                    <p className="text-[10px] font-black text-black uppercase tracking-wider">Closing Balance</p>
                    <p className="text-xl font-black text-black mt-1">₹{(parsedSummary.closing_balance || 0).toLocaleString('en-IN', {minimumFractionDigits: 2})}</p>
                    <span className="text-[10px] text-slate-500 font-bold mt-1">End of Period</span>
                  </div>

                  <div className="bg-white p-4 border-4 border-black shadow-[4px_4px_0px_rgba(0,0,0,1)] flex flex-col justify-between">
                    <p className="text-[10px] font-black text-black uppercase tracking-wider">Reconciliation Audit</p>
                    <div className="mt-2">
                      {parsedSummary.reconciled ? (
                        <span className="inline-flex items-center px-3 py-1 border-2 border-black font-black bg-[#3affaa] text-black text-xs uppercase shadow-[2px_2px_0px_rgba(0,0,0,1)]">
                          RECONCILED ✓
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-3 py-1 border-2 border-black font-black bg-[#ff5757] text-white text-xs uppercase shadow-[2px_2px_0px_rgba(0,0,0,1)]">
                          MISMATCH ✗
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-500 font-bold mt-1">
                      {allTransactions.filter(t => t.requires_review).length} items need review
                    </span>
                  </div>
                </div>

                {/* 2. Review Queue Filter Tabs & Action Toolbar */}
                <div className="bg-white border-4 border-black shadow-[8px_8px_0px_rgba(0,0,0,1)] overflow-hidden">
                  
                  {/* Top Bar with Queue Filter Tabs */}
                  <div className="p-4 bg-[#ffd615] border-b-4 border-black flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => setFilterMode('ALL')}
                        className={`px-3 py-1.5 border-2 border-black font-black text-xs uppercase transition-all ${filterMode === 'ALL' ? 'bg-black text-white shadow-[2px_2px_0px_rgba(0,0,0,1)]' : 'bg-white text-black hover:bg-slate-100'}`}
                      >
                        ALL ({allTransactions.length})
                      </button>
                      <button
                        onClick={() => setFilterMode('READY')}
                        className={`px-3 py-1.5 border-2 border-black font-black text-xs uppercase transition-all ${filterMode === 'READY' ? 'bg-black text-white shadow-[2px_2px_0px_rgba(0,0,0,1)]' : 'bg-white text-black hover:bg-slate-100'}`}
                      >
                        READY ({allTransactions.filter(t => !t.requires_review).length})
                      </button>
                      <button
                        onClick={() => setFilterMode('REVIEW')}
                        className={`px-3 py-1.5 border-2 border-black font-black text-xs uppercase transition-all ${filterMode === 'REVIEW' ? 'bg-[#ff5757] text-white shadow-[2px_2px_0px_rgba(0,0,0,1)]' : allTransactions.filter(t => t.requires_review).length > 0 ? 'bg-[#ff5757] text-white hover:bg-red-600' : 'bg-white text-black'}`}
                      >
                        NEEDS REVIEW ({allTransactions.filter(t => t.requires_review).length})
                      </button>
                      <button
                        onClick={() => setFilterMode('DUPLICATES')}
                        className={`px-3 py-1.5 border-2 border-black font-black text-xs uppercase transition-all ${filterMode === 'DUPLICATES' ? 'bg-amber-400 text-black shadow-[2px_2px_0px_rgba(0,0,0,1)]' : 'bg-white text-black hover:bg-slate-100'}`}
                      >
                        DUPLICATES ({allTransactions.filter(t => t.is_duplicate).length})
                      </button>
                      <button
                        onClick={() => setFilterMode('DEBIT')}
                        className={`px-3 py-1.5 border-2 border-black font-black text-xs uppercase transition-all ${filterMode === 'DEBIT' ? 'bg-black text-white shadow-[2px_2px_0px_rgba(0,0,0,1)]' : 'bg-white text-black hover:bg-slate-100'}`}
                      >
                        DEBITS ({allTransactions.filter(t => (t.debit || 0) > 0).length})
                      </button>
                      <button
                        onClick={() => setFilterMode('CREDIT')}
                        className={`px-3 py-1.5 border-2 border-black font-black text-xs uppercase transition-all ${filterMode === 'CREDIT' ? 'bg-black text-white shadow-[2px_2px_0px_rgba(0,0,0,1)]' : 'bg-white text-black hover:bg-slate-100'}`}
                      >
                        CREDITS ({allTransactions.filter(t => (t.credit || 0) > 0).length})
                      </button>
                    </div>

                    <div className="flex items-center space-x-2 w-full lg:w-auto">
                      <input
                        id="table-search-input"
                        type="text"
                        placeholder="Search narration, ref, ledger... (Ctrl+F)"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="px-3 py-1.5 border-2 border-black text-xs font-bold bg-white focus:outline-none w-full lg:w-64"
                      />
                      {allTransactions.filter(t => t.requires_review).length > 0 && (
                        <button
                          onClick={() => {
                            setCurrentReviewIdx(0);
                            setReviewModalOpen(true);
                          }}
                          className="px-3 py-1.5 bg-black text-[#FFD629] font-black text-xs border-2 border-black uppercase whitespace-nowrap hover:bg-zinc-800 shadow-[2px_2px_0px_rgba(0,0,0,1)]"
                        >
                          ⚡ REVIEW NEXT ISSUE
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Bulk Actions Toolbar */}
                  <div className="px-4 py-2.5 bg-slate-100 border-b-2 border-black flex flex-wrap items-center justify-between gap-3 text-xs font-bold">
                    <div className="flex items-center space-x-3">
                      <label className="flex items-center space-x-1.5 cursor-pointer font-black select-none">
                        <input
                          type="checkbox"
                          checked={selectedRowIds.size > 0 && selectedRowIds.size === allTransactions.length}
                          onChange={() => handleSelectAllRows(allTransactions)}
                          className="w-4 h-4 border-2 border-black accent-black rounded-none"
                        />
                        <span>SELECT ALL ({selectedRowIds.size} selected)</span>
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
                          className="px-2 py-0.5 border border-black bg-white hover:bg-slate-200 font-bold text-[11px] shadow-[1px_1px_0px_rgba(0,0,0,1)]"
                          title="Undo last narration edit (Ctrl+Z)"
                        >
                          ↩ UNDO ({undoStack.length})
                        </button>
                      )}
                    </div>

                    {selectedRowIds.size > 0 && (
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="text"
                          placeholder="Type Counter Ledger..."
                          value={bulkLedgerInput}
                          onChange={(e) => setBulkLedgerInput(e.target.value)}
                          className="px-2 py-1 border-2 border-black text-xs font-bold bg-white focus:outline-none"
                        />
                        <button
                          onClick={handleBulkAssignLedger}
                          className="px-3 py-1 bg-[#ffd615] border-2 border-black font-black text-xs hover:bg-yellow-400 shadow-[1px_1px_0px_rgba(0,0,0,1)] uppercase"
                        >
                          ASSIGN LEDGER
                        </button>
                        <button
                          onClick={handleBulkMarkReviewed}
                          className="px-3 py-1 bg-[#3affaa] border-2 border-black font-black text-xs hover:bg-emerald-400 shadow-[1px_1px_0px_rgba(0,0,0,1)] uppercase"
                        >
                          MARK REVIEWED
                        </button>
                        <button
                          onClick={() => {
                            if (!confirm(`Delete ${selectedRowIds.size} selected transactions?`)) return;
                            setAllTransactions(prev => prev.filter(t => !selectedRowIds.has(t.id)));
                            setSelectedRowIds(new Set());
                          }}
                          className="px-3 py-1 bg-[#ff5757] text-white border-2 border-black font-black text-xs hover:bg-red-600 shadow-[1px_1px_0px_rgba(0,0,0,1)] uppercase"
                        >
                          DELETE SELECTED
                        </button>
                      </div>
                    )}
                  </div>

                  {/* 3. Interactive Transactions Grid */}
                  <div className="overflow-x-auto max-h-[440px] overflow-y-auto">
                    <table className="min-w-full divide-y divide-black text-left">
                      <thead className="bg-slate-200 text-[10px] font-black text-black uppercase tracking-wider sticky top-0 border-b-2 border-black z-10">
                        <tr>
                          <th className="px-3 py-2.5 border-r border-black w-8 text-center">
                            <input
                              type="checkbox"
                              checked={selectedRowIds.size > 0 && selectedRowIds.size === allTransactions.length}
                              onChange={() => handleSelectAllRows(allTransactions)}
                              className="w-3.5 h-3.5 border-2 border-black accent-black rounded-none"
                            />
                          </th>
                          <th className="px-3 py-2.5 border-r border-black whitespace-nowrap">Date</th>
                          <th className="px-4 py-2.5 border-r border-black w-1/3">Narration (Editable)</th>
                          <th className="px-3 py-2.5 border-r border-black">Ref / UTR</th>
                          <th className="px-3 py-2.5 border-r border-black w-1/5">Counter Ledger</th>
                          <th className="px-3 py-2.5 text-right border-r border-black">Debit (Out)</th>
                          <th className="px-3 py-2.5 text-right border-r border-black">Credit (In)</th>
                          <th className="px-3 py-2.5 text-right border-r border-black">Balance</th>
                          <th className="px-3 py-2.5 text-center border-r border-black">Confidence</th>
                          <th className="px-3 py-2.5 text-center">Audit</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-black text-xs font-bold text-black">
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
                              className={`hover:bg-yellow-50/40 transition-colors ${selectedRowIds.has(tx.id) ? 'bg-yellow-50' : ''} ${tx.requires_review ? 'bg-red-50/40' : ''}`}
                            >
                              <td className="px-3 py-2 border-r border-black text-center">
                                <input
                                  type="checkbox"
                                  checked={selectedRowIds.has(tx.id)}
                                  onChange={() => handleToggleRowSelection(tx.id)}
                                  className="w-3.5 h-3.5 border-2 border-black accent-black rounded-none"
                                />
                              </td>
                              <td className="px-3 py-2 border-r border-black whitespace-nowrap font-mono text-[11px]">
                                {tx.txn_date}
                              </td>
                              <td className="px-3 py-2 border-r border-black">
                                <input
                                  type="text"
                                  value={editedNarrations[idx] !== undefined ? editedNarrations[idx] : tx.narration}
                                  onChange={(e) => handleNarrationEdit(idx, e.target.value)}
                                  className="w-full px-2 py-1 border border-black font-mono font-bold text-[11px] bg-white focus:bg-yellow-50 focus:outline-none"
                                />
                              </td>
                              <td className="px-3 py-2 border-r border-black text-slate-600 font-mono text-[10px] truncate max-w-[120px]">
                                <div>{tx.ref_no || tx.utr || '-'}</div>
                                {tx.category && (
                                  <span className="text-[8px] bg-slate-100 text-slate-700 px-1 border border-slate-300 uppercase">
                                    {tx.category}
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2 border-r border-black">
                                <input
                                  type="text"
                                  value={editedLedgers[idx] !== undefined ? editedLedgers[idx] : (tx.assigned_ledger || counterLedgerName)}
                                  onChange={(e) => handleLedgerEdit(idx, e.target.value)}
                                  className="w-full px-2 py-1 border border-black font-bold text-[11px] bg-white focus:bg-yellow-50 focus:outline-none"
                                />
                              </td>
                              <td className="px-3 py-2 border-r border-black text-right text-[#ff4b3f] font-mono whitespace-nowrap">
                                {tx.debit ? `₹${Number(tx.debit).toFixed(2)}` : ''}
                              </td>
                              <td className="px-3 py-2 border-r border-black text-right text-emerald-600 font-mono whitespace-nowrap">
                                {tx.credit ? `₹${Number(tx.credit).toFixed(2)}` : ''}
                              </td>
                              <td className="px-3 py-2 border-r border-black text-right font-mono text-slate-800 whitespace-nowrap">
                                ₹{Number(tx.balance || 0).toFixed(2)}
                              </td>
                              <td className="px-2 py-2 border-r border-black text-center whitespace-nowrap">
                                <span className={`px-1.5 py-0.5 text-[9px] font-black uppercase border border-black ${tx.confidence_grade === 'HIGH' ? 'bg-[#3affaa] text-black' : tx.confidence_grade === 'MEDIUM' ? 'bg-[#ffd615] text-black' : 'bg-[#ff5757] text-white'}`}>
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
                                    className="px-2 py-0.5 bg-[#ff5757] text-white text-[9px] font-black uppercase border border-black hover:bg-red-600"
                                  >
                                    REVIEW ⚠️
                                  </button>
                                ) : tx.is_duplicate ? (
                                  <span className="px-1.5 py-0.5 bg-amber-300 text-black text-[9px] font-black uppercase border border-black">
                                    DUP
                                  </span>
                                ) : (
                                  <span className="text-emerald-600 font-black text-xs">✓</span>
                                )}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* 4. Actions & Tally XML Export Settings */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  
                  {/* Left: Customization Settings */}
                  <div className="bg-white border-4 border-black shadow-[6px_6px_0px_rgba(0,0,0,1)] p-6 space-y-4 lg:col-span-2">
                    <div className="flex justify-between items-center border-b-2 border-black pb-2">
                      <h4 className="text-md font-black text-black uppercase">Tally Prime / ERP 9 Integration Settings</h4>
                      <span className="bg-[#3affaa] text-black text-[9px] font-black px-2 py-0.5 border border-black uppercase">
                        ✓ Tally XML 1.0 Compliant
                      </span>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-black text-black uppercase mb-1">Tally Bank Ledger Name</label>
                        <input
                          type="text"
                          placeholder="e.g. State Bank of India"
                          value={tallyLedgerName}
                          onChange={(e) => setTallyLedgerName(e.target.value)}
                          className="w-full px-3 py-2 border-2 border-black text-sm font-bold bg-white focus:outline-none focus:bg-yellow-50"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-black text-black uppercase mb-1">Default Counter Ledger</label>
                        <input
                          type="text"
                          value={counterLedgerName}
                          onChange={(e) => setCounterLedgerName(e.target.value)}
                          className="w-full px-3 py-2 border-2 border-black text-sm font-bold bg-white focus:outline-none focus:bg-yellow-50"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                      <div>
                        <label className="block text-xs font-black text-black uppercase mb-1">Credit Voucher Type (Money In)</label>
                        <select
                          value={creditVoucherType}
                          onChange={(e) => setCreditVoucherType(e.target.value)}
                          className="w-full px-3 py-2 border-2 border-black text-sm font-bold bg-white focus:outline-none"
                        >
                          <option>Receipt</option>
                          <option>Contra</option>
                          <option>Sales</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-black text-black uppercase mb-1">Debit Voucher Type (Money Out)</label>
                        <select
                          value={debitVoucherType}
                          onChange={(e) => setDebitVoucherType(e.target.value)}
                          className="w-full px-3 py-2 border-2 border-black text-sm font-bold bg-white focus:outline-none"
                        >
                          <option>Payment</option>
                          <option>Contra</option>
                          <option>Purchase</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Right: Conversion Billing & Trigger Actions */}
                  <div className="bg-[#ffd615] border-4 border-black shadow-[6px_6px_0px_rgba(0,0,0,1)] p-6 flex flex-col justify-between">
                    <div className="space-y-3">
                      <h4 className="text-md font-black text-black uppercase">Run Conversion</h4>
                      <div className="bg-white p-3 border-2 border-black text-xs font-bold space-y-1">
                        <p>Deduction: <span className="font-extrabold">{parsedSummary.pages_count} credits</span></p>
                        <p>Your Balance: <span className="font-extrabold">{user.page_credits} credits</span></p>
                        {user.page_credits < parsedSummary.pages_count && (
                          <p className="text-[#ff4b3f] font-black uppercase mt-1">Insufficient credits to execute!</p>
                        )}
                      </div>
                      
                      {executeError && (
                        <div className="bg-[#ff5757] text-white p-2 border-2 border-black font-bold text-xs">
                          {executeError}
                        </div>
                      )}
                    </div>

                    <div className="space-y-3 mt-6">
                      <button
                        onClick={handleExecuteConversion}
                        disabled={executeLoading || user.page_credits < parsedSummary.pages_count}
                        className="w-full py-3 px-4 border-2 border-black font-black text-black bg-white hover:bg-slate-50 hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[4px_4px_0px_rgba(0,0,0,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0px_rgba(0,0,0,1)] shadow-[2px_2px_0px_rgba(0,0,0,1)] transition-all uppercase disabled:opacity-50"
                      >
                        {executeLoading ? 'GENERATING XML...' : 'CONVERT TO TALLY XML'}
                      </button>

                      <button
                        onClick={handleDownloadExcel}
                        className="w-full py-2.5 px-4 border-2 border-black font-black text-black bg-[#3fecff] hover:bg-cyan-300 hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[4px_4px_0px_rgba(0,0,0,1)] shadow-[2px_2px_0px_rgba(0,0,0,1)] transition-all uppercase text-xs"
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

        {/* --- TAB: CSV TO TALLY MULTI-VOUCHER CONVERTER --- */}
        {activeTab === 'csv' && (
          <div className="space-y-8 max-w-7xl mx-auto">
            {/* Top Neo-Brutalist Banner */}
            <div className="bg-black text-white p-6 border-4 border-black shadow-[6px_6px_0px_rgba(0,0,0,1)] flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="flex items-center space-x-3.5">
                <img src="/symbol_mark.svg" alt="CSV to Tally" className="w-10 h-10 border border-[#FFD629] bg-black p-0.5 flex-shrink-0" />
                <div>
                  <h3 className="text-xl font-black text-[#FFD629] uppercase tracking-tight">
                    CSV To Tally Prime Multi-Voucher Converter
                  </h3>
                  <p className="text-xs font-bold text-slate-300">
                    Import Payment, Receipt, Contra, Journal, Sales & Purchase entries from any CSV. Map columns, edit inline, and generate Tally XML.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={handleDownloadBlankCsv}
                  className="px-3 py-2 bg-white text-black font-black text-xs uppercase border-2 border-white shadow-[2px_2px_0px_rgba(255,255,255,1)] hover:bg-yellow-100 transition-all flex items-center space-x-1.5"
                  title="Download clean blank CSV template"
                >
                  <span>⬇ Blank CSV</span>
                </button>
                <button
                  onClick={handleDownloadSampleCsv}
                  className="px-3 py-2 bg-[#ffd615] text-black font-black text-xs uppercase border-2 border-black shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:translate-x-[-1px] hover:translate-y-[-1px] transition-all flex items-center space-x-1.5"
                  title="Download CSV pre-filled with Payment, Receipt, Contra & Journal examples"
                >
                  <span>★ Sample CSV</span>
                </button>
                <button
                  onClick={handleOpenCreateMapping}
                  className="px-3 py-2 bg-[#3affaa] text-black font-black text-xs uppercase border-2 border-black shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:translate-x-[-1px] hover:translate-y-[-1px] transition-all flex items-center space-x-1.5"
                >
                  <span>+ New Mapping</span>
                </button>
              </div>
            </div>

            {/* Upload & Mapping Card */}
            <div className="bg-white border-4 border-black shadow-[8px_8px_0px_rgba(0,0,0,1)] p-6 space-y-6">
              <div className="flex items-center justify-between border-b-2 border-black pb-3">
                <h4 className="text-sm font-black text-black uppercase flex items-center space-x-2">
                  <span className="w-3 h-3 bg-[#ffd615] border border-black inline-block"></span>
                  <span>1. Upload CSV & Choose Column Mapping Template</span>
                </h4>
                <div className="text-[11px] font-bold text-slate-500">
                  Step 1 of 2
                </div>
              </div>

              <form onSubmit={handleUploadAndPreviewCsv} className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-end">
                {/* File input */}
                <div className="lg:col-span-5">
                  <label className="block text-xs font-black uppercase text-black mb-1">
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
                    className="w-full text-xs font-bold p-2 border-2 border-black bg-slate-50 file:mr-3 file:py-1.5 file:px-3 file:border-2 file:border-black file:text-xs file:font-black file:bg-[#ffd615] file:uppercase file:cursor-pointer hover:file:bg-yellow-400 cursor-pointer"
                  />
                  {csvFile && (
                    <div className="text-[11px] font-bold text-green-700 mt-1 flex items-center space-x-1">
                      <span>✓ Ready: {csvFile.name} ({(csvFile.size / 1024).toFixed(1)} KB)</span>
                    </div>
                  )}
                </div>

                {/* Mapping Selector */}
                <div className="lg:col-span-4">
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-black uppercase text-black">
                      Mapping Template
                    </label>
                    <button
                      type="button"
                      onClick={handleOpenCreateMapping}
                      className="text-[10px] font-black text-black underline uppercase hover:text-blue-700"
                    >
                      + Create Custom
                    </button>
                  </div>
                  <select
                    value={selectedCsvMappingId}
                    onChange={(e) => setSelectedCsvMappingId(e.target.value)}
                    className="w-full p-2.5 text-xs font-bold border-2 border-black bg-white focus:outline-none focus:bg-yellow-50"
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
                    className="flex-1 py-2.5 px-4 bg-[#ffd615] text-black border-2 border-black font-black text-xs uppercase shadow-[3px_3px_0px_rgba(0,0,0,1)] hover:translate-x-[-1px] hover:translate-y-[-1px] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
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
                      className="px-3 py-2.5 bg-white border-2 border-black font-black text-xs hover:bg-slate-100 shadow-[2px_2px_0px_rgba(0,0,0,1)]"
                    >
                      ✎
                    </button>
                  )}
                </div>
              </form>

              {csvError && (
                <div className="p-3 bg-red-100 border-2 border-[#ff5757] text-[#ff5757] font-black text-xs flex items-center justify-between">
                  <span>⚠ {csvError}</span>
                  <button onClick={() => setCsvError('')} className="font-bold underline text-[11px]">DISMISS</button>
                </div>
              )}
            </div>

            {/* Vouchers Preview & Interactive Spreadsheet */}
            {csvVouchers.length > 0 && (
              <div className="bg-white border-4 border-black shadow-[8px_8px_0px_rgba(0,0,0,1)] p-6 space-y-6">
                {/* Header Metrics */}
                <div className="flex flex-col md:flex-row md:items-center justify-between border-b-2 border-black pb-4 gap-4">
                  <div>
                    <h4 className="text-sm font-black text-black uppercase flex items-center space-x-2">
                      <span className="w-3 h-3 bg-[#3affaa] border border-black inline-block"></span>
                      <span>2. Interactive Vouchers Review & Multi-Voucher Grid</span>
                    </h4>
                    <p className="text-xs font-bold text-slate-500 mt-0.5">
                      Double-check dates, ledger accounts, and voucher types. Edit inline before converting to Tally Prime.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={handleAddVoucherRow}
                      className="px-3 py-1.5 bg-slate-100 text-black border-2 border-black font-black text-xs uppercase hover:bg-slate-200 shadow-[2px_2px_0px_rgba(0,0,0,1)]"
                    >
                      + Add Row
                    </button>
                    <button
                      onClick={handleExportCsvToExcel}
                      className="px-3 py-1.5 bg-[#3fecff] text-black border-2 border-black font-black text-xs uppercase hover:bg-cyan-300 shadow-[2px_2px_0px_rgba(0,0,0,1)]"
                    >
                      Export Excel (.xlsx)
                    </button>
                    <button
                      onClick={handleConvertCsvToXml}
                      disabled={csvConverting}
                      className="px-4 py-1.5 bg-[#ffd615] text-black border-2 border-black font-black text-xs uppercase hover:bg-yellow-400 shadow-[2px_2px_0px_rgba(0,0,0,1)] disabled:opacity-50 flex items-center space-x-1.5"
                    >
                      <span>{csvConverting ? 'Generating XML...' : 'Convert to Tally XML'}</span>
                      {(() => {
                        const pricing = getCsvCreditPricing(csvVouchers.length);
                        return (
                          <span className="text-[10px] bg-black text-white px-1.5 py-0.5 font-black rounded-none">
                            {pricing} {pricing === 1 ? 'Credit' : 'Credits'}
                          </span>
                        );
                      })()}
                    </button>
                  </div>
                </div>

                {/* Metric Summary Badges */}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-7 gap-2.5">
                  <div className="p-2.5 bg-slate-100 border-2 border-black text-center">
                    <div className="text-[10px] font-black uppercase text-slate-600">Total Vouchers</div>
                    <div className="text-lg font-black text-black">{csvVouchers.length}</div>
                  </div>
                  <div className="p-2.5 bg-green-50 border-2 border-black text-center">
                    <div className="text-[10px] font-black uppercase text-green-800">Valid Entries</div>
                    <div className="text-lg font-black text-green-700">
                      {csvVouchers.filter(v => v.is_valid).length}
                    </div>
                  </div>
                  <div className={`p-2.5 border-2 border-black text-center ${csvVouchers.filter(v => !v.is_valid).length > 0 ? 'bg-red-100 text-red-700' : 'bg-slate-50 text-slate-400'}`}>
                    <div className="text-[10px] font-black uppercase">Validation Errors</div>
                    <div className="text-lg font-black">
                      {csvVouchers.filter(v => !v.is_valid).length}
                    </div>
                  </div>
                  <div className="p-2.5 bg-blue-50 border-2 border-black text-center">
                    <div className="text-[10px] font-black uppercase text-blue-800">Payments</div>
                    <div className="text-lg font-black text-blue-700">
                      {csvVouchers.filter(v => v.voucher_type === 'Payment').length}
                    </div>
                  </div>
                  <div className="p-2.5 bg-emerald-50 border-2 border-black text-center">
                    <div className="text-[10px] font-black uppercase text-emerald-800">Receipts</div>
                    <div className="text-lg font-black text-emerald-700">
                      {csvVouchers.filter(v => v.voucher_type === 'Receipt').length}
                    </div>
                  </div>
                  <div className="p-2.5 bg-purple-50 border-2 border-black text-center">
                    <div className="text-[10px] font-black uppercase text-purple-800">Contra / Journal</div>
                    <div className="text-lg font-black text-purple-700">
                      {csvVouchers.filter(v => ['Contra', 'Journal'].includes(v.voucher_type)).length}
                    </div>
                  </div>
                  <div className="p-2.5 bg-yellow-100 border-2 border-black text-center">
                    <div className="text-[10px] font-black uppercase text-black">Total ₹</div>
                    <div className="text-sm font-black text-black truncate" title={`₹${csvVouchers.reduce((acc, v) => acc + (parseFloat(v.amount) || 0), 0).toLocaleString('en-IN')}`}>
                      ₹{csvVouchers.reduce((acc, v) => acc + (parseFloat(v.amount) || 0), 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </div>
                  </div>
                </div>

                {csvConvertError && (
                  <div className="p-3 bg-red-100 border-2 border-[#ff5757] text-[#ff5757] font-black text-xs">
                    ⚠ {csvConvertError}
                  </div>
                )}

                {/* Filters & Search Toolbar */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
                  <div className="flex flex-wrap items-center gap-1">
                    {['ALL', 'Payment', 'Receipt', 'Contra', 'Journal', 'Sales', 'Purchase'].map(vt => (
                      <button
                        key={vt}
                        onClick={() => setCsvFilterType(vt)}
                        className={`px-2.5 py-1 text-xs font-black border border-black uppercase transition-all ${csvFilterType === vt ? 'bg-black text-white shadow-[1px_1px_0px_rgba(0,0,0,1)]' : 'bg-white hover:bg-slate-100'}`}
                      >
                        {vt}
                      </button>
                    ))}
                    {csvVouchers.some(v => !v.is_valid) && (
                      <button
                        onClick={() => setCsvFilterType('INVALID')}
                        className={`px-2.5 py-1 text-xs font-black border border-black uppercase transition-all ${csvFilterType === 'INVALID' ? 'bg-[#ff5757] text-white shadow-[1px_1px_0px_rgba(0,0,0,1)]' : 'bg-red-50 text-red-600 hover:bg-red-100'}`}
                      >
                        ⚠ Issues Only ({csvVouchers.filter(v => !v.is_valid).length})
                      </button>
                    )}
                  </div>

                  <div className="relative w-full sm:w-64">
                    <input
                      type="text"
                      placeholder="Search ledgers, narration, voucher..."
                      value={csvSearchQuery}
                      onChange={(e) => setCsvSearchQuery(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs font-bold border-2 border-black focus:outline-none focus:bg-yellow-50"
                    />
                    {csvSearchQuery && (
                      <button
                        onClick={() => setCsvSearchQuery('')}
                        className="absolute right-2 top-1.5 text-xs font-bold text-slate-400 hover:text-black"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>

                {/* Spreadsheet Table */}
                <div className="overflow-x-auto border-2 border-black max-h-[500px]">
                  <table className="min-w-[1050px] w-full text-left text-xs border-collapse">
                    <thead className="bg-black text-white sticky top-0 z-10 select-none">
                      <tr>
                        <th className="p-2 border border-slate-700 w-10 text-center font-black">#</th>
                        <th className="p-2 border border-slate-700 w-28 font-black">Date</th>
                        <th className="p-2 border border-slate-700 w-28 font-black">Voucher Type</th>
                        <th className="p-2 border border-slate-700 w-28 font-black">Voucher No</th>
                        <th className="p-2 border border-slate-700 font-black">
                          <span className="bg-red-600 text-white px-1 py-0.5 text-[9px] mr-1">Dr</span>
                          Debit Ledger
                        </th>
                        <th className="p-2 border border-slate-700 font-black">
                          <span className="bg-green-600 text-white px-1 py-0.5 text-[9px] mr-1">Cr</span>
                          Credit Ledger
                        </th>
                        <th className="p-2 border border-slate-700 w-28 text-right font-black">Amount (₹)</th>
                        <th className="p-2 border border-slate-700 font-black">Narration</th>
                        <th className="p-2 border border-slate-700 w-24 font-black">Ref / Cheque</th>
                        <th className="p-2 border border-slate-700 w-16 text-center font-black">Status</th>
                        <th className="p-2 border border-slate-700 w-10 text-center font-black">✕</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black font-bold">
                      {csvVouchers
                        .map((vch, originalIdx) => ({ vch, originalIdx }))
                        .filter(({ vch }) => {
                          if (csvFilterType === 'INVALID') {
                            if (vch.is_valid) return false;
                          } else if (csvFilterType !== 'ALL') {
                            if (vch.voucher_type !== csvFilterType) return false;
                          }
                          if (csvSearchQuery) {
                            const q = csvSearchQuery.toLowerCase();
                            const match = (
                              (vch.narration && vch.narration.toLowerCase().includes(q)) ||
                              (vch.debit_ledger && vch.debit_ledger.toLowerCase().includes(q)) ||
                              (vch.credit_ledger && vch.credit_ledger.toLowerCase().includes(q)) ||
                              (vch.voucher_number && vch.voucher_number.toLowerCase().includes(q)) ||
                              (vch.ref_no && vch.ref_no.toLowerCase().includes(q))
                            );
                            if (!match) return false;
                          }
                          return true;
                        })
                        .map(({ vch, originalIdx }) => (
                          <tr key={originalIdx} className={`hover:bg-yellow-50/70 transition-colors ${!vch.is_valid ? 'bg-red-50/70' : originalIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}`}>
                            <td className="p-1.5 border border-slate-300 text-center text-slate-500 font-mono text-[11px]">
                              {originalIdx + 1}
                            </td>
                            <td className="p-1 border border-slate-300">
                              <input
                                type="text"
                                value={vch.date || ''}
                                onChange={(e) => handleUpdateVoucherCell(originalIdx, 'date', e.target.value)}
                                className="w-full px-1.5 py-1 text-xs border border-transparent hover:border-black focus:border-black bg-transparent focus:bg-white focus:outline-none"
                                placeholder="YYYY-MM-DD"
                              />
                            </td>
                            <td className="p-1 border border-slate-300">
                              <select
                                value={vch.voucher_type || 'Payment'}
                                onChange={(e) => handleUpdateVoucherCell(originalIdx, 'voucher_type', e.target.value)}
                                className="w-full px-1 py-1 text-xs font-black border border-transparent hover:border-black focus:border-black bg-transparent focus:bg-white focus:outline-none"
                              >
                                <option value="Payment">Payment</option>
                                <option value="Receipt">Receipt</option>
                                <option value="Contra">Contra</option>
                                <option value="Journal">Journal</option>
                                <option value="Sales">Sales</option>
                                <option value="Purchase">Purchase</option>
                              </select>
                            </td>
                            <td className="p-1 border border-slate-300">
                              <input
                                type="text"
                                value={vch.voucher_number || ''}
                                onChange={(e) => handleUpdateVoucherCell(originalIdx, 'voucher_number', e.target.value)}
                                className="w-full px-1.5 py-1 text-xs border border-transparent hover:border-black focus:border-black bg-transparent focus:bg-white focus:outline-none"
                                placeholder="Auto / No"
                              />
                            </td>
                            <td className="p-1 border border-slate-300">
                              <input
                                type="text"
                                value={vch.debit_ledger || ''}
                                onChange={(e) => handleUpdateVoucherCell(originalIdx, 'debit_ledger', e.target.value)}
                                className={`w-full px-1.5 py-1 text-xs font-bold border ${!vch.debit_ledger ? 'border-red-400 bg-red-50' : 'border-transparent hover:border-black focus:border-black bg-transparent focus:bg-white'} focus:outline-none`}
                                placeholder="Debit Ledger Name"
                              />
                            </td>
                            <td className="p-1 border border-slate-300">
                              <input
                                type="text"
                                value={vch.credit_ledger || ''}
                                onChange={(e) => handleUpdateVoucherCell(originalIdx, 'credit_ledger', e.target.value)}
                                className={`w-full px-1.5 py-1 text-xs font-bold border ${!vch.credit_ledger ? 'border-red-400 bg-red-50' : 'border-transparent hover:border-black focus:border-black bg-transparent focus:bg-white'} focus:outline-none`}
                                placeholder="Credit Ledger Name"
                              />
                            </td>
                            <td className="p-1 border border-slate-300">
                              <input
                                type="number"
                                step="0.01"
                                value={vch.amount}
                                onChange={(e) => handleUpdateVoucherCell(originalIdx, 'amount', e.target.value)}
                                className={`w-full px-1.5 py-1 text-xs text-right font-black border ${!vch.amount || vch.amount <= 0 ? 'border-red-400 bg-red-50 text-red-600' : 'border-transparent hover:border-black focus:border-black bg-transparent focus:bg-white'} focus:outline-none`}
                              />
                            </td>
                            <td className="p-1 border border-slate-300">
                              <input
                                type="text"
                                value={vch.narration || ''}
                                onChange={(e) => handleUpdateVoucherCell(originalIdx, 'narration', e.target.value)}
                                className="w-full px-1.5 py-1 text-xs border border-transparent hover:border-black focus:border-black bg-transparent focus:bg-white focus:outline-none"
                                placeholder="Narration description"
                              />
                            </td>
                            <td className="p-1 border border-slate-300">
                              <input
                                type="text"
                                value={vch.ref_no || ''}
                                onChange={(e) => handleUpdateVoucherCell(originalIdx, 'ref_no', e.target.value)}
                                className="w-full px-1.5 py-1 text-xs border border-transparent hover:border-black focus:border-black bg-transparent focus:bg-white focus:outline-none"
                                placeholder="Ref/Chq"
                              />
                            </td>
                            <td className="p-1 border border-slate-300 text-center">
                              {vch.is_valid ? (
                                <span className="text-[10px] bg-green-200 text-green-900 px-1 py-0.5 font-black uppercase">
                                  OK
                                </span>
                              ) : (
                                <span
                                  className="text-[10px] bg-red-200 text-red-900 px-1 py-0.5 font-black uppercase cursor-help"
                                  title={(vch.error_reasons && vch.error_reasons.length > 0) ? vch.error_reasons.join(', ') : (vch.validation_error || 'Missing required ledger, date or amount')}
                                >
                                  ERR
                                </span>
                              )}
                            </td>
                            <td className="p-1 border border-slate-300 text-center">
                              <button
                                onClick={() => handleDeleteVoucherRow(originalIdx)}
                                className="text-slate-400 hover:text-red-600 font-black text-xs px-1"
                                title="Remove row"
                              >
                                ✕
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>

                {/* Bottom Conversion Call to Action */}
                <div className="flex flex-col sm:flex-row items-center justify-between p-4 bg-[#ffd615]/30 border-2 border-black gap-3">
                  <div className="text-xs font-bold text-black">
                    Ready to post to Tally? Click below to generate XML for your company data.
                  </div>
                  <div className="flex items-center space-x-3">
                    <button
                      onClick={handleExportCsvToExcel}
                      className="px-4 py-2 bg-white text-black border-2 border-black font-black text-xs uppercase shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:bg-slate-50"
                    >
                      Export Excel
                    </button>
                    <button
                      onClick={handleConvertCsvToXml}
                      disabled={csvConverting}
                      className="px-6 py-2 bg-black text-white border-2 border-black font-black text-xs uppercase shadow-[4px_4px_0px_rgba(0,0,0,1)] hover:bg-slate-800 disabled:opacity-50 flex items-center space-x-2"
                    >
                      <span>{csvConverting ? 'Generating...' : 'CONVERT TO TALLY PRIME XML'}</span>
                      {(() => {
                        const pricing = getCsvCreditPricing(csvVouchers.length);
                        return (
                          <span className="text-[10px] bg-[#ffd615] text-black px-1.5 py-0.5 font-black">
                            {pricing} {pricing === 1 ? 'Credit' : 'Credits'}
                          </span>
                        );
                      })()}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Saved Mapping Templates Section */}
            <div className="bg-white border-4 border-black shadow-[8px_8px_0px_rgba(0,0,0,1)] p-6 space-y-4">
              <div className="flex items-center justify-between border-b-2 border-black pb-3">
                <h4 className="text-sm font-black text-black uppercase">
                  Saved CSV Column Mapping Templates ({csvMappings.length})
                </h4>
                <button
                  onClick={handleOpenCreateMapping}
                  className="px-3 py-1.5 bg-[#ffd615] text-black border-2 border-black font-black text-xs uppercase shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:bg-yellow-400"
                >
                  + Add Template
                </button>
              </div>

              {csvMappings.length === 0 ? (
                <div className="text-center py-6 text-xs font-bold text-slate-500">
                  No custom mapping templates saved yet. You can use the standard Sheet Buddy template or click "+ Add Template" to map your custom ERP/bank CSV columns.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {csvMappings.map((tmpl) => (
                    <div key={tmpl.id} className="border-2 border-black p-4 bg-slate-50 shadow-[3px_3px_0px_rgba(0,0,0,1)] space-y-2.5">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="font-black text-xs uppercase text-black">{tmpl.name}</div>
                          {tmpl.description && (
                            <div className="text-[11px] text-slate-600 font-bold">{tmpl.description}</div>
                          )}
                        </div>
                        <div className="flex items-center space-x-1.5">
                          <button
                            onClick={() => handleOpenEditMapping(tmpl)}
                            className="p-1 border border-black bg-white hover:bg-yellow-100 text-[10px] font-black"
                            title="Edit template"
                          >
                            ✎
                          </button>
                          <button
                            onClick={() => handleDeleteMapping(tmpl.id)}
                            className="p-1 border border-black bg-white hover:bg-red-100 text-[10px] font-black text-red-600"
                            title="Delete template"
                          >
                            ✕
                          </button>
                        </div>
                      </div>

                      <div className="text-[11px] font-bold space-y-1 divide-y divide-slate-200">
                        <div className="flex justify-between pt-1">
                          <span className="text-slate-500">Date Column:</span>
                          <span className="font-mono font-black">{tmpl.date_column} ({tmpl.date_format})</span>
                        </div>
                        <div className="flex justify-between pt-1">
                          <span className="text-slate-500">Voucher Type:</span>
                          <span>{tmpl.voucher_type_column || tmpl.default_voucher_type}</span>
                        </div>
                        <div className="flex justify-between pt-1">
                          <span className="text-slate-500">Dr Ledger:</span>
                          <span className="truncate max-w-[150px]">{tmpl.debit_ledger_column || tmpl.default_debit_ledger || 'Unassigned'}</span>
                        </div>
                        <div className="flex justify-between pt-1">
                          <span className="text-slate-500">Cr Ledger:</span>
                          <span className="truncate max-w-[150px]">{tmpl.credit_ledger_column || tmpl.default_credit_ledger || 'Unassigned'}</span>
                        </div>
                        <div className="flex justify-between pt-1">
                          <span className="text-slate-500">Amount Column:</span>
                          <span>{tmpl.amount_column || `${tmpl.debit_amount_column || ''} / ${tmpl.credit_amount_column || ''}`}</span>
                        </div>
                      </div>

                      <button
                        onClick={() => {
                          setSelectedCsvMappingId(String(tmpl.id));
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className={`w-full py-1 text-center text-xs font-black uppercase border border-black transition-all ${selectedCsvMappingId === String(tmpl.id) ? 'bg-black text-white' : 'bg-white hover:bg-yellow-200'}`}
                      >
                        {selectedCsvMappingId === String(tmpl.id) ? '✓ Currently Selected' : 'Use This Template'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* --- TAB: LEDGER RULES ENGINE --- */}
        {activeTab === 'rules' && (
          <div className="space-y-8 max-w-6xl mx-auto">
            
            {/* Header Banner */}
            <div className="bg-black text-white p-6 border-4 border-black shadow-[6px_6px_0px_rgba(0,0,0,1)] flex items-center justify-between">
              <div className="flex items-center space-x-3.5">
                <img src="/symbol_mark.svg" alt="Rules" className="w-10 h-10 border border-[#FFD629] bg-black p-0.5 flex-shrink-0" />
                <div>
                  <h3 className="text-xl font-black text-[#FFD629] uppercase tracking-tight">
                    Smart Ledger Suggestion & Categorization Rules
                  </h3>
                  <p className="text-xs font-bold text-slate-300">
                    Define keyword rules to automatically categorize narrations and assign specific Tally counter-ledgers.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              
              {/* Left: Create Rule Form */}
              <div className="bg-white border-4 border-black shadow-[8px_8px_0px_rgba(0,0,0,1)] p-6 space-y-4">
                <h4 className="text-md font-black text-black uppercase border-b-2 border-black pb-2">Add New Rule</h4>
                <form onSubmit={handleCreateRule} className="space-y-3 text-xs">
                  <div>
                    <label className="block font-black text-black uppercase mb-1">Rule Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Electricity Bill Rule"
                      value={ruleNameInput}
                      onChange={(e) => setRuleNameInput(e.target.value)}
                      className="w-full px-3 py-2 border-2 border-black font-bold bg-white focus:outline-none focus:bg-yellow-50"
                    />
                  </div>

                  <div>
                    <label className="block font-black text-black uppercase mb-1">Narration Match Pattern / Keyword</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. BESCOM or SALARY or SWIGGY"
                      value={rulePatternInput}
                      onChange={(e) => setRulePatternInput(e.target.value)}
                      className="w-full px-3 py-2 border-2 border-black font-bold bg-white focus:outline-none focus:bg-yellow-50 uppercase"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block font-black text-black uppercase mb-1">Match Type</label>
                      <select
                        value={ruleMatchType}
                        onChange={(e) => setRuleMatchType(e.target.value)}
                        className="w-full px-2 py-2 border-2 border-black font-bold bg-white focus:outline-none"
                      >
                        <option value="CONTAINS">CONTAINS</option>
                        <option value="STARTS_WITH">STARTS WITH</option>
                        <option value="ENDS_WITH">ENDS WITH</option>
                        <option value="EXACT">EXACT</option>
                        <option value="REGEX">REGEX</option>
                      </select>
                    </div>

                    <div>
                      <label className="block font-black text-black uppercase mb-1">Voucher Type</label>
                      <select
                        value={ruleVoucherType}
                        onChange={(e) => setRuleVoucherType(e.target.value)}
                        className="w-full px-2 py-2 border-2 border-black font-bold bg-white focus:outline-none"
                      >
                        <option value="Payment">Payment</option>
                        <option value="Receipt">Receipt</option>
                        <option value="Contra">Contra</option>
                        <option value="Journal">Journal</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block font-black text-black uppercase mb-1">Target Counter Ledger Name</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Electricity Expenses"
                      value={ruleLedgerInput}
                      onChange={(e) => setRuleLedgerInput(e.target.value)}
                      className="w-full px-3 py-2 border-2 border-black font-bold bg-white focus:outline-none focus:bg-yellow-50"
                    />
                  </div>

                  <div>
                    <label className="block font-black text-black uppercase mb-1">Category</label>
                    <input
                      type="text"
                      placeholder="e.g. Utilities, Vendor, Salary"
                      value={ruleCategoryInput}
                      onChange={(e) => setRuleCategoryInput(e.target.value)}
                      className="w-full px-3 py-2 border-2 border-black font-bold bg-white focus:outline-none focus:bg-yellow-50"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full py-2.5 px-4 border-2 border-black font-black text-black bg-[#ffd615] hover:bg-yellow-400 uppercase shadow-[2px_2px_0px_rgba(0,0,0,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0px_rgba(0,0,0,1)] transition-all mt-2"
                  >
                    SAVE LEDGER RULE
                  </button>
                </form>
              </div>

              {/* Right: Existing Rules Directory */}
              <div className="bg-white border-4 border-black shadow-[8px_8px_0px_rgba(0,0,0,1)] p-6 space-y-4 lg:col-span-2">
                <div className="flex justify-between items-center border-b-2 border-black pb-2">
                  <h4 className="text-md font-black text-black uppercase">Active Rules Directory ({userRules.length})</h4>
                  <button
                    onClick={fetchUserRules}
                    className="text-xs font-black underline hover:no-underline"
                  >
                    Refresh
                  </button>
                </div>

                {userRules.length === 0 ? (
                  <div className="py-8 text-center text-slate-500 font-bold text-xs">
                    No custom ledger rules created yet. Add rules on the left to automate ledger mapping!
                  </div>
                ) : (
                  <div className="overflow-x-auto max-h-[380px]">
                    <table className="min-w-full divide-y divide-black border-2 border-black text-xs">
                      <thead className="bg-slate-100 font-black text-black uppercase border-b border-black">
                        <tr>
                          <th className="px-3 py-2 text-left border-r border-black">Rule Name</th>
                          <th className="px-3 py-2 text-left border-r border-black">Pattern</th>
                          <th className="px-3 py-2 text-center border-r border-black">Type</th>
                          <th className="px-3 py-2 text-left border-r border-black">Assigned Ledger</th>
                          <th className="px-3 py-2 text-center border-r border-black">Voucher</th>
                          <th className="px-3 py-2 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-black font-bold text-black">
                        {userRules.map((rule) => (
                          <tr key={rule.id} className="hover:bg-slate-50">
                            <td className="px-3 py-2.5 border-r border-black font-black">{rule.rule_name}</td>
                            <td className="px-3 py-2.5 border-r border-black font-mono uppercase text-slate-800">{rule.pattern}</td>
                            <td className="px-3 py-2.5 border-r border-black text-center text-[10px]">
                              <span className="bg-slate-100 px-1 py-0.5 border border-black font-mono">
                                {rule.match_type}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 border-r border-black text-emerald-700 font-bold">{rule.ledger_name}</td>
                            <td className="px-3 py-2.5 border-r border-black text-center text-[10px]">{rule.voucher_type}</td>
                            <td className="px-3 py-2 text-center">
                              <button
                                onClick={() => handleDeleteRule(rule.id)}
                                className="px-2 py-0.5 bg-white hover:bg-[#ff5757] hover:text-white border border-black text-[10px] font-black uppercase transition-colors"
                              >
                                DELETE
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

          {/* --- TAB 2: CONVERSION HISTORY --- */}
          {activeTab === 'history' && (
            <div className="bg-white border-4 border-black shadow-[8px_8px_0px_rgba(0,0,0,1)] p-6 space-y-6 max-w-6xl mx-auto">
              
              {/* Header and Search */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center space-y-4 sm:space-y-0 border-b-4 border-black pb-4">
                <div className="flex items-center space-x-3">
                  <img src="/app_icon_yellow.svg" alt="History" className="w-10 h-10 border-2 border-black bg-white shadow-[2px_2px_0px_rgba(0,0,0,1)] flex-shrink-0" />
                  <div>
                    <h3 className="text-xl font-black text-black uppercase">Conversion History Archive</h3>
                    <p className="text-xs font-bold text-slate-500 mt-0.5">Re-download processed XML statements from cache free of charge.</p>
                  </div>
                </div>
                <div className="w-full sm:w-72">
                  <label className="block text-[10px] font-black text-black uppercase mb-1">Search Archives</label>
                  <input
                    type="text"
                    placeholder="Search bank, period, account..."
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    className="w-full px-3 py-2 border-2 border-black text-xs font-bold focus:outline-none"
                  />
                </div>
              </div>

              {/* Table */}
              {filteredHistory.length === 0 ? (
                <p className="text-slate-500 font-bold text-sm py-6 text-center">No conversion records matching "{historySearch}" were found.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-black border-2 border-black">
                    <thead className="bg-[#ffd615] text-[10px] font-black text-black uppercase tracking-wider border-b-2 border-black">
                      <tr>
                        <th className="px-6 py-3 text-left border-r border-black">Date Converted</th>
                        <th className="px-6 py-3 text-left border-r border-black">Bank Name</th>
                        <th className="px-6 py-3 text-left border-r border-black">Statement Period</th>
                        <th className="px-6 py-3 text-center border-r border-black">Pages</th>
                        <th className="px-6 py-3 text-center border-r border-black">Transactions</th>
                        <th className="px-6 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-black text-xs font-bold text-black">
                      {filteredHistory.map((conv) => (
                        <tr key={conv.id} className="hover:bg-slate-50">
                          <td className="px-6 py-4 border-r border-black whitespace-nowrap">{formatDisplayDate(conv.created_at)}</td>
                          <td className="px-6 py-4 border-r border-black font-black uppercase text-slate-800">{conv.bank_name}</td>
                          <td className="px-6 py-4 border-r border-black">{conv.statement_period || 'N/A'}</td>
                          <td className="px-6 py-4 border-r border-black text-center">{conv.pages_count}</td>
                          <td className="px-6 py-4 border-r border-black text-center">{conv.transactions_count}</td>
                          <td className="px-6 py-4 text-right">
                            <button
                              onClick={() => handleDownloadCachedXml(conv.id, conv.bank_name, conv.statement_period)}
                              className="inline-flex items-center px-4 py-2 border-2 border-black text-xs font-black rounded-none bg-[#3fecff] hover:bg-cyan-300 text-black hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[3px_3px_0px_rgba(0,0,0,1)] shadow-[1px_1px_0px_rgba(0,0,0,1)] transition-all uppercase"
                            >
                              GET XML
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
            <div className="space-y-8 max-w-6xl mx-auto">
              
              {/* Purchase plans */}
              <div className="space-y-6">
                <div className="bg-white border-4 border-black shadow-[8px_8px_0px_rgba(0,0,0,1)] p-6">
                  <div className="flex items-center space-x-3 mb-6">
                    <img src="/symbol_mark.svg" alt="SB" className="w-10 h-10 border-2 border-black bg-black shadow-[2px_2px_0px_rgba(0,0,0,1)] flex-shrink-0" />
                    <div>
                      <h3 className="text-xl font-black text-black uppercase mb-0.5">Buy Credit Vouchers</h3>
                      <p className="text-xs font-bold text-slate-500">Purchase page credits directly. Base pricing is **25 paise per page** with bulk volume extra credits. Failed conversions are never charged.</p>
                    </div>
                  </div>
                  
                  {purchaseMessage && (
                    <div className="bg-[#3fecff] text-black border-2 border-black p-3 text-sm font-black shadow-[2px_2px_0px_rgba(0,0,0,1)] mb-6 uppercase">
                      {purchaseMessage}
                    </div>
                  )}
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Pack 1 */}
                    <div className="border-4 border-black p-5 text-center flex flex-col justify-between bg-[#f4f2ed] shadow-[4px_4px_0px_rgba(0,0,0,1)]">
                      <div>
                        <h4 className="font-black text-black text-sm uppercase">Starter Pack</h4>
                        <p className="text-[10px] font-bold text-slate-400 mt-1">₹0.25 per page</p>
                        <div className="mt-4 text-4xl font-black text-black">100</div>
                        <p className="text-[10px] font-black uppercase tracking-wider mt-0.5">Page Credits</p>
                      </div>
                      <div className="mt-6">
                        <button
                          onClick={() => setCheckoutSession({ planName: 'Starter Pack', pages: 100, amount: 25.0 })}
                          className="w-full py-2.5 px-3 border-2 border-black font-black text-black bg-white hover:bg-slate-50 uppercase text-xs"
                        >
                          BUY FOR ₹25
                        </button>
                      </div>
                    </div>

                    {/* Pack 2 */}
                    <div className="border-4 border-black p-5 text-center flex flex-col justify-between bg-[#f4f2ed] shadow-[4px_4px_0px_rgba(0,0,0,1)] relative">
                      <span className="absolute top-0 right-1/2 translate-x-1/2 -translate-y-1/2 px-3 py-1 border-2 border-black text-[9px] font-black uppercase tracking-wider bg-white text-black">
                        +100 EXTRA FREE
                      </span>
                      <div>
                        <h4 className="font-black text-black text-sm uppercase">Standard Pack</h4>
                        <p className="text-[10px] font-bold text-slate-500 mt-1">₹0.21 per page value</p>
                        <div className="mt-4 text-4xl font-black text-black">600</div>
                        <p className="text-[9px] font-black uppercase tracking-wider mt-0.5">Pages (500 + 100 Free)</p>
                      </div>
                      <div className="mt-6">
                        <button
                          onClick={() => setCheckoutSession({ planName: 'Standard Pack', pages: 500, amount: 125.0 })}
                          className="w-full py-2.5 px-3 border-2 border-black font-black text-black bg-white hover:bg-slate-50 uppercase text-xs shadow-[2px_2px_0px_rgba(0,0,0,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0px_rgba(0,0,0,1)] transition-all"
                        >
                          BUY FOR ₹125
                        </button>
                      </div>
                    </div>

                    {/* Pack 3 */}
                    <div className="border-4 border-black p-5 text-center flex flex-col justify-between bg-[#ffd615] shadow-[6px_6px_0px_rgba(0,0,0,1)] relative border-black">
                      <span className="absolute top-0 right-1/2 translate-x-1/2 -translate-y-1/2 px-3 py-1 border-2 border-black text-[9px] font-black uppercase tracking-wider bg-black text-[#3affaa]">
                        +250 EXTRA FREE
                      </span>
                      <div>
                        <h4 className="font-black text-black text-sm uppercase">Business Pack</h4>
                        <p className="text-[10px] font-bold text-slate-600 mt-1">₹0.20 per page value</p>
                        <div className="mt-4 text-4xl font-black text-black">1250</div>
                        <p className="text-[9px] font-black uppercase tracking-wider mt-0.5">Pages (1000 + 250 Free)</p>
                      </div>
                      <div className="mt-6">
                        <button
                          onClick={() => setCheckoutSession({ planName: 'Business Pack', pages: 1000, amount: 250.0 })}
                          className="w-full py-2.5 px-3 border-2 border-black font-black text-black bg-white hover:bg-slate-50 uppercase text-xs shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[4px_4px_0px_rgba(0,0,0,1)] transition-all"
                        >
                          BUY FOR ₹250
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Promo Code Redemption Card */}
                <div className="bg-white border-4 border-black shadow-[8px_8px_0px_rgba(0,0,0,1)] p-6 mt-6">
                  <h4 className="text-md font-black text-black uppercase mb-1">Redeem Promo Code</h4>
                  <p className="text-xs font-bold text-slate-500 mb-4">Enter a promo code below to claim free page credits (once in your lifetime per user account).</p>
                  
                  <div className="flex space-x-2">
                    <input
                      type="text"
                      placeholder="e.g. SHEETBUDDY50"
                      value={promoCode}
                      onChange={(e) => setPromoCode(e.target.value)}
                      className="flex-1 px-3 py-2.5 border-2 border-black text-sm font-bold bg-white focus:outline-none focus:bg-yellow-50"
                    />
                    <button
                      onClick={handleClaimPromoCode}
                      disabled={redeemLoading || !promoCode.trim()}
                      className="px-6 py-2.5 border-2 border-black font-black bg-[#ffd615] text-xs uppercase shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:bg-yellow-400 active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0px_rgba(0,0,0,1)] transition-all"
                    >
                      {redeemLoading ? 'REDEEMING...' : 'REDEEM CODE'}
                    </button>
                  </div>
                  
                  {redeemStatusMsg && (
                    <div className="mt-4 p-3 border-2 border-black text-xs font-black text-black uppercase bg-[#3fecff] shadow-[2px_2px_0px_rgba(0,0,0,1)]">
                      {redeemStatusMsg}
                    </div>
                  )}
                </div>
              </div>

              {/* Wallet Ledger */}
              <div className="bg-white border-4 border-black shadow-[8px_8px_0px_rgba(0,0,0,1)] p-6 flex flex-col">
                <h3 className="text-md font-black text-black border-b-2 border-black pb-3 mb-4 uppercase">Wallet Activity Log</h3>
                
                {walletTransactions.length === 0 ? (
                  <p className="text-slate-400 text-xs py-4 text-center font-bold">No transactions found.</p>
                ) : (
                  <div className="space-y-4 max-h-[350px] overflow-y-auto pr-1">
                    {walletTransactions.map((tx) => (
                      <div key={tx.id} className="flex justify-between items-start text-xs border-b border-slate-100 pb-2">
                        <div>
                          <div className="flex items-center">
                            <p className="font-bold text-black uppercase">{tx.description || tx.type}</p>
                            {tx.type === 'PURCHASE' && (
                              <span className={`inline-block ml-2 px-1.5 py-0.5 text-[8px] font-black uppercase border border-black ${tx.status === 'APPROVED' || tx.status === 'COMPLETED' ? 'bg-[#3affaa] text-black' : tx.status === 'REJECTED' ? 'bg-[#ff5757] text-white' : 'bg-[#ffd615] text-black'}`}>
                                {tx.status}
                              </span>
                            )}
                          </div>
                          <p className="text-slate-400 mt-0.5">{formatDisplayDate(tx.created_at, false)}</p>
                        </div>
                        <div className="text-right">
                          <p className={`font-black text-sm ${tx.pages_purchased > 0 ? 'text-emerald-500' : 'text-[#ff4b3f]'}`}>
                            {tx.pages_purchased > 0 ? `+${tx.pages_purchased}` : tx.pages_purchased}
                          </p>
                          {tx.amount_in_inr > 0 && <p className="text-[10px] font-bold text-slate-500">₹{tx.amount_in_inr}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>
          )}

          {/* --- TAB 5: ADMIN CONSOLE --- */}
          {activeTab === 'admin' && user.is_admin && (
            <div className="space-y-8 max-w-6xl mx-auto">
              
              {/* Analytics Header Grid */}
              <div className="bg-[#ffd615] border-4 border-black shadow-[6px_6px_0px_rgba(0,0,0,1)] p-6">
                <div className="flex items-center space-x-3 mb-4 border-b-2 border-black pb-3">
                  <img src="/symbol_mark.svg" alt="Admin" className="w-10 h-10 border-2 border-black bg-black shadow-[2px_2px_0px_rgba(0,0,0,1)] flex-shrink-0" />
                  <div>
                    <h3 className="text-xl font-black text-black uppercase">Sheet Buddy Global System Overview</h3>
                    <p className="text-xs font-bold text-black opacity-80">Administrative Management Dashboard</p>
                  </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="bg-white p-4 border-2 border-black shadow-[3px_3px_0px_rgba(0,0,0,1)]">
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Total Users Registered</p>
                    <p className="text-2xl font-black text-black mt-1">{adminStats?.total_users || 0}</p>
                  </div>
                  
                  <div className="bg-white p-4 border-2 border-black shadow-[3px_3px_0px_rgba(0,0,0,1)]">
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Total processed conversions</p>
                    <p className="text-2xl font-black text-black mt-1">{adminStats?.total_conversions || 0}</p>
                  </div>
                  
                  <div className="bg-white p-4 border-2 border-black shadow-[3px_3px_0px_rgba(0,0,0,1)]">
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Global Credits Issued</p>
                    <p className="text-2xl font-black text-black mt-1">{adminStats?.total_credits || 0}</p>
                  </div>
                  
                  <div className="bg-white p-4 border-2 border-black shadow-[3px_3px_0px_rgba(0,0,0,1)]">
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Pending Support Queries</p>
                    <p className="text-2xl font-black text-black mt-1">{adminStats?.pending_queries || 0}</p>
                  </div>
                </div>
              </div>

              {/* Admin Actions Bar */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                
                {/* Create Promo Code Card */}
                <div className="bg-white border-4 border-black shadow-[8px_8px_0px_rgba(0,0,0,1)] p-6 space-y-4">
                  <h4 className="text-md font-black text-black uppercase border-b-2 border-black pb-2">Generate Promo Code</h4>
                  <form onSubmit={handleCreatePromoCode} className="space-y-3">
                    <div>
                      <label className="block text-[10px] font-black text-black uppercase mb-1">Code Name</label>
                      <input
                        type="text"
                        placeholder="e.g. VIPBONUS50"
                        required
                        value={adminNewPromoCode}
                        onChange={(e) => setAdminNewPromoCode(e.target.value.toUpperCase())}
                        className="w-full px-3 py-2 border-2 border-black text-xs font-bold uppercase bg-white focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-black uppercase mb-1">Page Credits Awarded</label>
                      <input
                        type="number"
                        required
                        min={1}
                        value={adminNewPromoCredits}
                        onChange={(e) => setAdminNewPromoCredits(e.target.value)}
                        className="w-full px-3 py-2 border-2 border-black text-xs font-bold bg-white focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-black uppercase mb-1">Lifetime Usage Limit</label>
                      <input
                        type="number"
                        required
                        min={1}
                        value={adminNewPromoMaxUses}
                        onChange={(e) => setAdminNewPromoMaxUses(e.target.value)}
                        className="w-full px-3 py-2 border-2 border-black text-xs font-bold bg-white focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-black uppercase mb-1">Expires After (Days)</label>
                      <input
                        type="number"
                        required
                        min={1}
                        value={adminNewPromoDays}
                        onChange={(e) => setAdminNewPromoDays(e.target.value)}
                        className="w-full px-3 py-2 border-2 border-black text-xs font-bold bg-white focus:outline-none"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={adminPromoLoading}
                      className="w-full py-2.5 px-4 border-2 border-black font-black text-white bg-black hover:bg-zinc-800 uppercase shadow-[2px_2px_0px_rgba(0,0,0,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0px_rgba(0,0,0,1)] transition-all text-xs disabled:opacity-50"
                    >
                      {adminPromoLoading ? 'Generating...' : 'Issue Promo Code'}
                    </button>
                  </form>
                  {adminPromoStatus && (
                    <div className="bg-[#3fecff] text-black p-3 border-2 border-black font-black text-xs shadow-[2px_2px_0px_rgba(0,0,0,1)] uppercase">
                      {adminPromoStatus}
                    </div>
                  )}
                </div>

                {/* Promo Codes History List */}
                <div className="bg-white border-4 border-black shadow-[8px_8px_0px_rgba(0,0,0,1)] p-6 space-y-4 md:col-span-2 flex flex-col justify-between">
                  <div>
                    <h4 className="text-md font-black text-black uppercase border-b-2 border-black pb-2">Active Promo Codes</h4>
                    <div className="overflow-x-auto max-h-[280px]">
                      {adminPromoCodes.length === 0 ? (
                        <p className="text-slate-400 text-xs py-4 text-center font-bold">No promo codes generated yet.</p>
                      ) : (
                        <table className="min-w-full divide-y divide-black border-2 border-black text-left">
                          <thead className="bg-slate-100 text-[9px] font-black text-black uppercase tracking-wider border-b border-black">
                            <tr>
                              <th className="px-3 py-2 border-r border-black">Code</th>
                              <th className="px-3 py-2 border-r border-black text-center">Credits</th>
                              <th className="px-3 py-2 border-r border-black text-center">Used / Max</th>
                              <th className="px-3 py-2 border-r border-black">Expires At</th>
                              <th className="px-3 py-2 text-center">Action</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-black text-xs font-bold text-black">
                            {adminPromoCodes.map((p) => (
                              <tr key={p.id} className="hover:bg-slate-50">
                                <td className="px-3 py-2 border-r border-black font-mono font-black">{p.code}</td>
                                <td className="px-3 py-2 border-r border-black text-center text-emerald-600 font-black">+{p.page_credits}</td>
                                <td className="px-3 py-2 border-r border-black text-center">{p.times_used} / {p.max_uses}</td>
                                <td className="px-3 py-2 border-r border-black text-[10px] whitespace-nowrap">{formatDisplayDate(p.expires_at, false)}</td>
                                <td className="px-3 py-2 text-center">
                                  <button
                                    onClick={() => handleDeletePromoCode(p.id)}
                                    className="text-[10px] font-black text-[#ff4b3f] hover:underline uppercase"
                                  >
                                    Delete
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                </div>

              </div>

              {/* Create New User Card */}
              <div className="bg-white border-4 border-black shadow-[8px_8px_0px_rgba(0,0,0,1)] p-6 space-y-4">
                <h4 className="text-md font-black text-black uppercase border-b-2 border-black pb-2">Create New Client Account</h4>
                <p className="text-xs font-bold text-slate-500">Since open self-registration is disabled, administrators provision accounts directly for clients here.</p>
                <form onSubmit={handleAdminCreateUser} className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-end">
                  <div>
                    <label className="block text-xs font-black text-black uppercase mb-1">Email Address</label>
                    <input
                      type="email"
                      required
                      placeholder="client@example.com"
                      value={adminNewUserEmail}
                      onChange={(e) => setAdminNewUserEmail(e.target.value)}
                      className="w-full px-3 py-2 border-2 border-black text-xs font-bold bg-white focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-black text-black uppercase mb-1">Password</label>
                    <input
                      type="text"
                      required
                      placeholder="Initial password"
                      value={adminNewUserPassword}
                      onChange={(e) => setAdminNewUserPassword(e.target.value)}
                      className="w-full px-3 py-2 border-2 border-black text-xs font-bold bg-white focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-black text-black uppercase mb-1">Initial Page Credits</label>
                    <input
                      type="number"
                      required
                      min={0}
                      value={adminNewUserCredits}
                      onChange={(e) => setAdminNewUserCredits(e.target.value)}
                      className="w-full px-3 py-2 border-2 border-black text-xs font-bold bg-white focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-black text-black uppercase mb-1 text-center">Is Admin?</label>
                    <div className="flex justify-center items-center h-[38px] border-2 border-black bg-slate-50">
                      <input
                        type="checkbox"
                        checked={adminNewUserIsAdmin}
                        onChange={(e) => setAdminNewUserIsAdmin(e.target.checked)}
                        className="w-4 h-4 border-2 border-black focus:ring-0 cursor-pointer accent-black"
                      />
                    </div>
                  </div>

                  <div>
                    <button
                      type="submit"
                      disabled={adminNewUserLoading}
                      className="w-full py-2.5 px-4 border-2 border-black font-black text-white bg-black hover:bg-zinc-800 uppercase shadow-[2px_2px_0px_rgba(0,0,0,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0px_rgba(0,0,0,1)] transition-all text-xs disabled:opacity-50"
                    >
                      {adminNewUserLoading ? 'Creating...' : 'Create Account'}
                    </button>
                  </div>
                </form>

                {adminNewUserError && (
                  <div className="bg-[#ff5757] text-white p-3 border-2 border-black font-bold text-xs">
                    ERROR: {adminNewUserError}
                  </div>
                )}

                {adminNewUserSuccess && (
                  <div className="bg-[#25D366] text-white p-3 border-2 border-black font-bold text-xs">
                    SUCCESS: {adminNewUserSuccess}
                  </div>
                )}
              </div>

              {/* Manage Users Card */}
              <div className="bg-white border-4 border-black shadow-[8px_8px_0px_rgba(0,0,0,1)] p-6 space-y-4">
                <h4 className="text-md font-black text-black uppercase border-b-2 border-black pb-2">Manage User Profiles & Wallets</h4>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-black border-2 border-black">
                    <thead className="bg-slate-100 text-[10px] font-black text-black uppercase tracking-wider border-b-2 border-black">
                      <tr>
                        <th className="px-4 py-3 text-left border-r border-black">Email</th>
                        <th className="px-4 py-3 text-center border-r border-black">Balance</th>
                        <th className="px-4 py-3 text-center border-r border-black">Conversions</th>
                        <th className="px-4 py-3 text-center border-r border-black">Admin Role</th>
                        <th className="px-4 py-3 text-center">Adjust Credits</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-black text-xs font-bold text-black">
                      {adminUsers.map((u) => (
                        <tr key={u.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3 border-r border-black truncate max-w-xs">{u.email}</td>
                          <td className="px-4 py-3 border-r border-black text-center">{u.page_credits}</td>
                          <td className="px-4 py-3 border-r border-black text-center">{u.conversion_count}</td>
                          <td className="px-4 py-3 border-r border-black text-center">
                            <button
                              onClick={() => handleToggleAdmin(u.id)}
                              className={`px-3 py-1.5 border-2 border-black text-[10px] font-black uppercase tracking-wide transition-all shadow-[1px_1px_0px_rgba(0,0,0,1)] ${u.is_admin ? 'bg-[#ffd615] text-black' : 'bg-white hover:bg-slate-100'}`}
                            >
                              {u.is_admin ? 'ADMIN ✓' : 'USER'}
                            </button>
                          </td>
                          <td className="px-4 py-3 text-center flex items-center justify-center space-x-2">
                            <input
                              type="number"
                              placeholder="e.g. 50 or -20"
                              value={creditAdjustmentInputs[u.id] || ''}
                              onChange={(e) => setCreditAdjustmentInputs(prev => ({ ...prev, [u.id]: e.target.value }))}
                              className="w-24 px-2 py-1 border-2 border-black text-xs font-mono font-bold bg-white focus:outline-none"
                            />
                            <button
                              onClick={() => handleAdjustCredits(u.id)}
                              className="px-3 py-1.5 border-2 border-black text-[10px] font-black bg-[#3fecff] hover:bg-cyan-300 uppercase shadow-[1px_1px_0px_rgba(0,0,0,1)]"
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
              <div className="bg-white border-4 border-black shadow-[8px_8px_0px_rgba(0,0,0,1)] p-6 space-y-4">
                <h4 className="text-md font-black text-black uppercase border-b-2 border-black pb-2">Global System Conversion Log</h4>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-black border-2 border-black">
                    <thead className="bg-slate-100 text-[10px] font-black text-black uppercase tracking-wider border-b-2 border-black">
                      <tr>
                        <th className="px-4 py-3 text-left border-r border-black">Date</th>
                        <th className="px-4 py-3 text-left border-r border-black">User Email</th>
                        <th className="px-4 py-3 text-left border-r border-black">Bank Name</th>
                        <th className="px-4 py-3 text-center border-r border-black">Pages</th>
                        <th className="px-4 py-3 text-center border-r border-black">Transactions</th>
                        <th className="px-4 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-black text-xs font-bold text-black">
                      {adminConversions.map((conv) => (
                        <tr key={conv.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3 border-r border-black whitespace-nowrap">{parseUtcDate(conv.created_at).toLocaleString()}</td>
                          <td className="px-4 py-3 border-r border-black truncate max-w-xs">{conv.user_email}</td>
                          <td className="px-4 py-3 border-r border-black font-black uppercase">{conv.bank_name}</td>
                          <td className="px-4 py-3 border-r border-black text-center">{conv.pages_count}</td>
                          <td className="px-4 py-3 border-r border-black text-center">{conv.transactions_count}</td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => handleDownloadCachedXml(conv.id, conv.bank_name, conv.statement_period)}
                              className="px-3 py-1.5 border-2 border-black text-[10px] font-black bg-[#3fecff] hover:bg-cyan-300 uppercase shadow-[1px_1px_0px_rgba(0,0,0,1)]"
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
              <div className="bg-white border-4 border-black shadow-[8px_8px_0px_rgba(0,0,0,1)] p-6 space-y-4">
                <h4 className="text-md font-black text-black uppercase border-b-2 border-black pb-2">Global Payments Received Log</h4>
                <div className="overflow-x-auto">
                  {adminPayments.length === 0 ? (
                    <p className="text-slate-500 font-bold text-sm py-4 text-center">No payment entries found.</p>
                  ) : (
                    <table className="min-w-full divide-y divide-black border-2 border-black">
                      <thead className="bg-slate-100 text-[10px] font-black text-black uppercase tracking-wider border-b-2 border-black">
                        <tr>
                          <th className="px-4 py-3 text-left border-r border-black">Date</th>
                          <th className="px-4 py-3 text-left border-r border-black">User Email</th>
                          <th className="px-4 py-3 text-center border-r border-black">Pages Purchased</th>
                          <th className="px-4 py-3 text-center border-r border-black">Amount Paid</th>
                          <th className="px-4 py-3 text-left border-r border-black">Description</th>
                          <th className="px-4 py-3 text-center border-r border-black">Status</th>
                          <th className="px-4 py-3 text-center">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-black text-xs font-bold text-black">
                        {adminPayments.map((pay) => (
                          <tr key={pay.id} className="hover:bg-slate-50">
                            <td className="px-4 py-3 border-r border-black whitespace-nowrap">{formatDisplayDate(pay.created_at)}</td>
                            <td className="px-4 py-3 border-r border-black truncate max-w-xs">{pay.user_email}</td>
                            <td className="px-4 py-3 border-r border-black text-center text-emerald-600 font-black">+{pay.pages_purchased}</td>
                            <td className="px-4 py-3 border-r border-black text-center font-black">₹{pay.amount_in_inr.toFixed(2)}</td>
                            <td className="px-4 py-3 border-r border-black truncate max-w-xs">{pay.description || 'UPI Credit Purchase'}</td>
                            <td className="px-4 py-3 border-r border-black text-center whitespace-nowrap">
                              <span className={`px-2 py-0.5 border border-black font-black uppercase text-[9px] ${pay.status === 'APPROVED' || pay.status === 'COMPLETED' ? 'bg-[#3affaa] text-black' : pay.status === 'REJECTED' ? 'bg-[#ff5757] text-white' : 'bg-[#ffd615] text-black'}`}>
                                {pay.status}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-center whitespace-nowrap space-x-1">
                              {pay.status === 'PENDING' ? (
                                <>
                                  <button
                                    onClick={() => handleApprovePayment(pay.id)}
                                    className="px-2.5 py-1 border-2 border-black font-black text-black bg-[#3affaa] hover:bg-emerald-400 text-[10px] uppercase shadow-[1px_1px_0px_rgba(0,0,0,1)] active:translate-x-[0.5px] active:translate-y-[0.5px] active:shadow-[0.5px_0.5px_0px_rgba(0,0,0,1)] transition-all"
                                  >
                                    Approve
                                  </button>
                                  <button
                                    onClick={() => handleRejectPayment(pay.id)}
                                    className="px-2.5 py-1 border-2 border-black font-black text-white bg-[#ff5757] hover:bg-red-600 text-[10px] uppercase shadow-[1px_1px_0px_rgba(0,0,0,1)] active:translate-x-[0.5px] active:translate-y-[0.5px] active:shadow-[0.5px_0.5px_0px_rgba(0,0,0,1)] transition-all"
                                  >
                                    Reject
                                  </button>
                                </>
                              ) : (
                                <span className="text-[10px] text-slate-400 uppercase font-black">PROCESSED</span>
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
              <div className="bg-white border-4 border-black shadow-[8px_8px_0px_rgba(0,0,0,1)] p-6 space-y-4">
                <h4 className="text-md font-black text-black uppercase border-b-2 border-black pb-2">User Support Queries</h4>
                <div className="overflow-x-auto">
                  {adminQueries.length === 0 ? (
                    <p className="text-slate-500 font-bold text-sm py-4 text-center">No support queries found.</p>
                  ) : (
                    <table className="min-w-full divide-y divide-black border-2 border-black">
                      <thead className="bg-slate-100 text-[10px] font-black text-black uppercase tracking-wider border-b-2 border-black">
                        <tr>
                          <th className="px-4 py-3 text-left border-r border-black">Date</th>
                          <th className="px-4 py-3 text-left border-r border-black">User Email</th>
                          <th className="px-4 py-3 text-left border-r border-black">WhatsApp Number</th>
                          <th className="px-4 py-3 text-left border-r border-black">Subject</th>
                          <th className="px-4 py-3 text-left">Description</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-black text-xs font-bold text-black">
                        {adminQueries.map((query) => (
                          <tr key={query.id} className="hover:bg-slate-50">
                            <td className="px-4 py-3 border-r border-black whitespace-nowrap">{formatDisplayDate(query.created_at)}</td>
                            <td className="px-4 py-3 border-r border-black truncate max-w-[200px]">{query.user_email}</td>
                            <td className="px-4 py-3 border-r border-black whitespace-nowrap">
                              {query.whatsapp_number ? (
                                <a 
                                  href={`https://wa.me/${query.whatsapp_number.replace(/\D/g, '')}`}
                                  target="_blank" 
                                  rel="noreferrer"
                                  className="text-emerald-600 hover:underline font-black"
                                >
                                  {query.whatsapp_number}
                                </a>
                              ) : (
                                <span className="text-slate-400 font-normal">None Provided</span>
                              )}
                            </td>
                            <td className="px-4 py-3 border-r border-black truncate max-w-[200px]">{query.subject}</td>
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
                <div className="bg-white border-4 border-black shadow-[8px_8px_0px_rgba(0,0,0,1)] p-6 space-y-4 lg:col-span-2">
                  <h4 className="text-md font-black text-black uppercase border-b-2 border-black pb-2">Promo Codes Directory</h4>
                  <div className="overflow-x-auto">
                    {adminPromoCodes.length === 0 ? (
                      <p className="text-slate-500 font-bold text-sm py-4 text-center">No promo codes registered.</p>
                    ) : (
                      <table className="min-w-full divide-y divide-black border-2 border-black text-xs">
                        <thead className="bg-slate-100 font-black text-black uppercase border-b border-black">
                          <tr>
                            <th className="px-3 py-2 text-left border-r border-black">Promo Code</th>
                            <th className="px-3 py-2 text-center border-r border-black">Credits</th>
                            <th className="px-3 py-2 text-left border-r border-black">Expiry Type</th>
                            <th className="px-3 py-2 text-left border-r border-black">Expires At</th>
                            <th className="px-3 py-2 text-center border-r border-black">Status</th>
                            <th className="px-3 py-2 text-center">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-black font-bold text-black">
                          {adminPromoCodes.map((promo) => (
                            <tr key={promo.id} className="hover:bg-slate-50">
                              <td className="px-3 py-2.5 border-r border-black font-black uppercase text-slate-800">{promo.code}</td>
                              <td className="px-3 py-2.5 border-r border-black text-center text-emerald-600 font-black">+{promo.credits}</td>
                              <td className="px-3 py-2.5 border-r border-black truncate text-[10px]">
                                {promo.type === 'UNIVERSAL_ONCE' && 'One-time Universal'}
                                {promo.type === 'PER_USER_ONCE' && 'One-time per User'}
                                {promo.type === 'TIME_BASED' && 'Time-based'}
                              </td>
                              <td className="px-3 py-2.5 border-r border-black text-slate-500 font-normal">
                                {promo.expires_at ? formatDisplayDate(promo.expires_at) : 'Never'}
                              </td>
                              <td className="px-3 py-2.5 border-r border-black text-center">
                                <span className={`px-1.5 py-0.5 border border-black text-[9px] font-black uppercase ${promo.is_active ? 'bg-[#3affaa] text-black' : 'bg-[#ff5757] text-white'}`}>
                                  {promo.is_active ? 'Active' : 'Inactive'}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-center">
                                <button
                                  onClick={() => handleTogglePromoCode(promo.id)}
                                  className={`px-2 py-0.5 border border-black font-black text-[10px] uppercase shadow-[1px_1px_0px_rgba(0,0,0,1)] active:translate-x-[0.5px] active:translate-y-[0.5px] active:shadow-[0px_0px_0px_rgba(0,0,0,1)] transition-all ${promo.is_active ? 'bg-white text-black hover:bg-slate-100' : 'bg-[#3affaa] text-black hover:bg-emerald-400'}`}
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
                <div className="bg-white border-4 border-black shadow-[8px_8px_0px_rgba(0,0,0,1)] p-6 space-y-4">
                  <h4 className="text-md font-black text-black uppercase border-b-2 border-black pb-2">Generate Promo Code</h4>
                  <form onSubmit={handleCreatePromoCode} className="space-y-4">
                    <div>
                      <label className="block text-[10px] font-black text-black uppercase mb-1">Code String</label>
                      <input
                        type="text"
                        required
                        value={promoFormCode}
                        onChange={(e) => setPromoFormCode(e.target.value.toUpperCase())}
                        placeholder="e.g. WELCOME100"
                        className="w-full px-3 py-2 border-2 border-black text-xs font-bold focus:outline-none bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-black uppercase mb-1">Credits Awarded</label>
                      <input
                        type="number"
                        required
                        value={promoFormCredits}
                        onChange={(e) => setPromoFormCredits(e.target.value)}
                        placeholder="50"
                        className="w-full px-3 py-2 border-2 border-black text-xs font-bold focus:outline-none bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-black uppercase mb-1">Expiry Type</label>
                      <select
                        value={promoFormType}
                        onChange={(e) => setPromoFormType(e.target.value)}
                        className="w-full px-3 py-2 border-2 border-black text-xs font-black bg-white focus:outline-none"
                      >
                        <option value="UNIVERSAL_ONCE">One-time Universal</option>
                        <option value="PER_USER_ONCE">One-time per User</option>
                        <option value="TIME_BASED">Time-based</option>
                      </select>
                    </div>

                    {promoFormType === 'TIME_BASED' && (
                      <div>
                        <label className="block text-[10px] font-black text-black uppercase mb-1">Expires At</label>
                        <input
                          type="datetime-local"
                          required
                          value={promoFormExpiresAt}
                          onChange={(e) => setPromoFormExpiresAt(e.target.value)}
                          className="w-full px-3 py-2 border-2 border-black text-xs font-bold focus:outline-none bg-white"
                        />
                      </div>
                    )}

                    {promoFormError && (
                      <div className="bg-[#ff5757] text-white p-2 border-2 border-black font-bold text-[10px] uppercase">
                        ERROR: {promoFormError}
                      </div>
                    )}

                    <button
                      type="submit"
                      className="w-full py-2.5 px-4 border-2 border-black font-black text-black bg-[#ffd615] hover:bg-yellow-400 uppercase shadow-[2px_2px_0px_rgba(0,0,0,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0px_rgba(0,0,0,1)] transition-all text-xs"
                    >
                      GENERATE CODE
                    </button>
                  </form>
                </div>
              </div>

              {/* Bank configurations manager */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                
                {/* Left side: list of supported formats */}
                <div className="bg-white border-4 border-black shadow-[8px_8px_0px_rgba(0,0,0,1)] p-6 space-y-4 lg:col-span-2">
                  <h4 className="text-md font-black text-black uppercase border-b-2 border-black pb-2">Supported Banks & Parsers List</h4>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-black border-2 border-black text-xs">
                      <thead className="bg-slate-100 font-black text-black uppercase tracking-wider border-b-2 border-black">
                        <tr>
                          <th className="px-3 py-2 text-left border-r border-black">Name</th>
                          <th className="px-3 py-2 text-center border-r border-black">Type</th>
                          <th className="px-3 py-2 text-left border-r border-black">Match Patterns</th>
                          <th className="px-3 py-2 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-black font-bold text-black">
                        {adminBanks.map((bank) => (
                          <tr key={bank.id} className="hover:bg-slate-50">
                            <td className="px-3 py-2 border-r border-black font-black uppercase">{bank.name}</td>
                            <td className="px-3 py-2 border-r border-black text-center">
                              <span className={`px-2 py-0.5 border border-black font-black text-[9px] ${bank.parser_type === 'NATIVE' ? 'bg-[#ffd615]' : bank.parser_type === 'SIMULATOR' ? 'bg-cyan-200' : 'bg-emerald-200'}`}>
                                {bank.parser_type}
                              </span>
                            </td>
                            <td className="px-3 py-2 border-r border-black font-mono">{bank.match_patterns}</td>
                            <td className="px-3 py-2 text-right space-x-1.5 whitespace-nowrap">
                              <button
                                onClick={() => handleSelectEditBank(bank)}
                                className="px-2 py-1 border-2 border-black font-black bg-white hover:bg-slate-100 uppercase text-[9px] shadow-[1px_1px_0px_rgba(0,0,0,1)]"
                              >
                                EDIT
                              </button>
                              <button
                                onClick={() => handleDeleteBankConfig(bank.id)}
                                className="px-2 py-1 border-2 border-black font-black bg-white hover:bg-[#ff5757] hover:text-white uppercase text-[9px] shadow-[1px_1px_0px_rgba(0,0,0,1)]"
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
                <div className="bg-white border-4 border-black shadow-[8px_8px_0px_rgba(0,0,0,1)] p-6 space-y-4">
                  <h4 className="text-md font-black text-black uppercase border-b-2 border-black pb-2">
                    {selectedBankConfig ? "Edit Bank Config" : "Add Bank Format"}
                  </h4>
                  
                  <form onSubmit={handleSaveBankConfig} className="space-y-4 text-xs">
                    <div>
                      <label className="block font-black text-black uppercase mb-1">Unique Bank Key</label>
                      <input
                        type="text"
                        placeholder="e.g. hdfc"
                        required
                        disabled={selectedBankConfig !== null}
                        value={bankFormKey}
                        onChange={(e) => setBankFormKey(e.target.value)}
                        className="w-full px-3 py-2 border-2 border-black font-bold bg-white focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block font-black text-black uppercase mb-1">Bank Name</label>
                      <input
                        type="text"
                        placeholder="e.g. HDFC Bank"
                        required
                        value={bankFormName}
                        onChange={(e) => setBankFormName(e.target.value)}
                        className="w-full px-3 py-2 border-2 border-black font-bold bg-white focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block font-black text-black uppercase mb-1">Match Patterns (comma-separated)</label>
                      <input
                        type="text"
                        placeholder="e.g. HDFC, HDFCBANK"
                        required
                        value={bankFormPatterns}
                        onChange={(e) => setBankFormPatterns(e.target.value)}
                        className="w-full px-3 py-2 border-2 border-black font-bold bg-white focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block font-black text-black uppercase mb-1">Parser Type</label>
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
                        className="w-full px-3 py-2 border-2 border-black font-bold bg-white focus:outline-none"
                      >
                        <option value="SIMULATOR">SIMULATOR</option>
                        <option value="RULE_BASED">RULE_BASED (COLUMN MAPPING)</option>
                        <option value="NATIVE">NATIVE PYTHON PARSER</option>
                      </select>
                    </div>

                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="block font-black text-black uppercase">Configuration JSON File</label>
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
                        className="w-full px-3 py-2 border-2 border-black font-mono font-bold bg-white focus:outline-none"
                      />
                    </div>

                    {bankFormError && (
                      <div className="bg-[#ff5757] text-white p-2.5 border-2 border-black font-bold text-[10px] uppercase">
                        ERROR: {bankFormError}
                      </div>
                    )}

                    <div className="pt-2 space-y-2">
                      <button
                        type="submit"
                        className="w-full py-2.5 px-4 border-2 border-black font-black text-black bg-[#3affaa] hover:bg-emerald-400 uppercase shadow-[2px_2px_0px_rgba(0,0,0,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0px_rgba(0,0,0,1)] transition-all"
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
                          className="w-full py-2 border-2 border-black font-black bg-white hover:bg-slate-100 uppercase text-center"
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
            <div className="space-y-6 max-w-2xl mx-auto bg-white p-8 border-4 border-black shadow-[8px_8px_0px_rgba(0,0,0,1)]">
              <div className="flex items-center space-x-4 mb-2 border-b-2 border-black pb-3">
                <img src="/social_square.svg" alt="Support" className="w-14 h-14 border-2 border-black shadow-[2px_2px_0px_rgba(0,0,0,1)] flex-shrink-0" />
                <div>
                  <h3 className="text-xl font-black text-black uppercase">Support & Assistance</h3>
                  <p className="text-xs font-bold text-slate-600">Technical help, statement format requests & custom Tally ledgers</p>
                </div>
              </div>
              <p className="text-xs font-bold text-slate-700 leading-relaxed">
                Facing an issue with statement conversions, missing credits, or custom bank configurations? Let us know! Raise a ticket below or connect with the administrator directly via WhatsApp.
              </p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                <div className="border-2 border-black p-4 bg-slate-50 flex flex-col justify-between">
                  <div>
                    <h4 className="font-black text-black uppercase text-sm mb-1">WhatsApp Chat Support</h4>
                    <p className="text-[10px] font-bold text-slate-500 leading-relaxed mb-4">
                      Get instant resolutions and share statement files or screenshots with the admin directly on WhatsApp.
                    </p>
                  </div>
                  <a
                    href="https://wa.me/919204915729?text=Hello%20Sheet%20Buddy%20Support!%20I%20have%20an%20issue%20with..."
                    target="_blank"
                    rel="noreferrer"
                    className="w-full text-center py-2.5 px-4 border-2 border-black font-black text-white bg-[#25D366] hover:bg-emerald-600 uppercase shadow-[2px_2px_0px_rgba(0,0,0,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0px_rgba(0,0,0,1)] transition-all flex items-center justify-center space-x-2 text-xs"
                  >
                    <span>Chat on WhatsApp</span>
                  </a>
                </div>

                <div className="border-2 border-black p-4 bg-slate-50 flex flex-col justify-between">
                  <div>
                    <h4 className="font-black text-black uppercase text-sm mb-1">Email Support</h4>
                    <p className="text-[10px] font-bold text-slate-500 leading-relaxed mb-4">
                      For detailed inquiries, you can send an email with your attachments directly to our helpdesk.
                    </p>
                  </div>
                  <a
                    href="mailto:sheetbuddyorg@gmail.com?subject=Sheet%20Buddy%20Inquiry"
                    className="w-full text-center py-2.5 px-4 border-2 border-black font-black text-black bg-[#ffd615] hover:bg-yellow-400 uppercase shadow-[2px_2px_0px_rgba(0,0,0,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0px_rgba(0,0,0,1)] transition-all text-xs"
                  >
                    Email Admin
                  </a>
                </div>
              </div>

              <div className="border-2 border-black p-6 bg-white pt-4">
                <h4 className="font-black text-black uppercase text-sm mb-2 border-b border-black pb-1">Raise a Support Query</h4>
                <form 
                  onSubmit={handleSupportQuerySubmit}
                  className="space-y-4"
                >
                  <div>
                    <label className="block text-[10px] font-black text-black uppercase mb-1">Subject</label>
                    <input
                      type="text"
                      required
                      value={supportSubject}
                      onChange={(e) => setSupportSubject(e.target.value)}
                      placeholder="e.g. Credit balance not updated / BOB Statement parsing failed"
                      className="w-full px-3 py-2 border-2 border-black font-bold focus:outline-none bg-white text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-black uppercase mb-1">WhatsApp Number (Optional)</label>
                    <input
                      type="text"
                      value={supportWhatsapp}
                      onChange={(e) => setSupportWhatsapp(e.target.value)}
                      placeholder="e.g. +91 98765 43210"
                      className="w-full px-3 py-2 border-2 border-black font-bold focus:outline-none bg-white text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-black uppercase mb-1">Describe your Issue</label>
                    <textarea
                      rows="4"
                      required
                      value={supportDescription}
                      onChange={(e) => setSupportDescription(e.target.value)}
                      placeholder="Please provide details about your issue, statement file type, or payment details..."
                      className="w-full px-3 py-2 border-2 border-black font-bold focus:outline-none bg-white text-xs"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={supportLoading}
                    className="w-full py-2.5 px-4 border-2 border-black font-black text-white bg-black hover:bg-zinc-800 uppercase shadow-[2px_2px_0px_rgba(0,0,0,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0px_rgba(0,0,0,1)] transition-all text-xs disabled:opacity-50"
                  >
                    {supportLoading ? "SUBMITTING..." : "Submit Support Ticket"}
                  </button>
                </form>
              </div>
            </div>
          )}



          {/* --- TAB 7: PROFILE SECURITY PAGE --- */}
          {activeTab === 'settings' && (
            <div className="space-y-6 max-w-md mx-auto bg-white p-8 border-4 border-black shadow-[8px_8px_0px_rgba(0,0,0,1)]">
              <div className="flex items-center space-x-3 mb-2 border-b-2 border-black pb-2">
                <img src="/app_icon_yellow.svg" alt="Profile" className="w-8 h-8 border-2 border-black" />
                <h3 className="text-xl font-black text-black uppercase">Profile Security</h3>
              </div>
              
              <div className="space-y-4">
                <div className="border-2 border-black p-4 bg-slate-50">
                  <span className="block text-[8px] font-black text-slate-500 uppercase tracking-widest">Logged In Email</span>
                  <span className="block font-black text-black text-sm">{user.email}</span>
                </div>

                <div className="border-2 border-black p-4 bg-slate-50">
                  <span className="block text-[8px] font-black text-slate-500 uppercase tracking-widest">Available Page Credits</span>
                  <span className="block font-black text-black text-lg">{user.page_credits} Credits</span>
                </div>
              </div>

              <div className="border-2 border-black p-6 bg-white pt-4">
                <h4 className="font-black text-black uppercase text-sm mb-4 border-b border-black pb-1">Change Account Password</h4>
                
                <form onSubmit={handleProfileChangePassword} className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-black text-black uppercase mb-1">Current Password</label>
                    <input
                      type="password"
                      required
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="Enter current password"
                      className="w-full px-3 py-2 border-2 border-black font-bold focus:outline-none bg-white text-xs"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-[10px] font-black text-black uppercase mb-1">New Password</label>
                    <input
                      type="password"
                      required
                      value={profileNewPassword}
                      onChange={(e) => setProfileNewPassword(e.target.value)}
                      placeholder="Enter new password"
                      className="w-full px-3 py-2 border-2 border-black font-bold focus:outline-none bg-white text-xs"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-black uppercase mb-1">Confirm New Password</label>
                    <input
                      type="password"
                      required
                      value={profileConfirmNewPassword}
                      onChange={(e) => setProfileConfirmNewPassword(e.target.value)}
                      placeholder="Confirm new password"
                      className="w-full px-3 py-2 border-2 border-black font-bold focus:outline-none bg-white text-xs"
                    />
                  </div>

                  {profileErrorMsg && (
                    <div className="bg-[#ff5757] text-white p-3 border-2 border-black font-bold text-xs">
                      ERROR: {profileErrorMsg}
                    </div>
                  )}

                  {profileSuccessMsg && (
                    <div className="bg-[#25D366] text-white p-3 border-2 border-black font-bold text-xs">
                      SUCCESS: {profileSuccessMsg}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={profileLoading}
                    className="w-full py-2.5 px-4 border-2 border-black font-black text-white bg-black hover:bg-zinc-800 uppercase shadow-[2px_2px_0px_rgba(0,0,0,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0px_rgba(0,0,0,1)] transition-all text-xs disabled:opacity-50"
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
              <div className="bg-white border-4 border-black shadow-[10px_10px_0px_rgba(0,0,0,1)] max-w-xl w-full p-6 space-y-5">
                {(() => {
                  const reviewList = allTransactions.filter(t => t.requires_review);
                  const currentItem = reviewList[currentReviewIdx];

                  if (!currentItem) {
                    return (
                      <div className="text-center py-6 space-y-4">
                        <span className="text-4xl">🎉</span>
                        <h3 className="text-lg font-black uppercase text-black">All Issues Resolved!</h3>
                        <p className="text-xs font-bold text-slate-600">Every transaction has been reviewed and verified for Tally export.</p>
                        <button
                          onClick={() => setReviewModalOpen(false)}
                          className="px-6 py-2 bg-[#ffd615] border-2 border-black font-black text-xs uppercase shadow-[2px_2px_0px_rgba(0,0,0,1)]"
                        >
                          BACK TO STATEMENT
                        </button>
                      </div>
                    );
                  }

                  const originalIdx = allTransactions.findIndex(t => t.id === currentItem.id);

                  return (
                    <>
                      <div className="flex justify-between items-center bg-[#ff5757] text-white p-3 border-2 border-black shadow-[2px_2px_0px_rgba(0,0,0,1)]">
                        <div>
                          <span className="text-[10px] font-black uppercase tracking-wider block">DIAGNOSTIC ISSUE RESOLUTION STEPPER</span>
                          <h3 className="text-sm font-black uppercase">Issue {currentReviewIdx + 1} of {reviewList.length}</h3>
                        </div>
                        <button
                          onClick={() => setReviewModalOpen(false)}
                          className="text-white font-black text-sm px-2 py-0.5 border border-white hover:bg-white hover:text-black"
                        >
                          ✕ ESC
                        </button>
                      </div>

                      {/* Issue Explanation */}
                      <div className="bg-amber-50 border-2 border-black p-3 text-xs font-bold text-amber-950 space-y-1">
                        <span className="font-black uppercase block text-[10px] text-amber-900">Flagged Reasons:</span>
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
                      <div className="bg-slate-50 border-2 border-black p-4 space-y-3 text-xs">
                        <div className="grid grid-cols-2 gap-2 font-mono">
                          <div>
                            <span className="text-[9px] font-black text-slate-500 uppercase block">Txn Date</span>
                            <span className="font-bold text-black">{currentItem.txn_date}</span>
                          </div>
                          <div>
                            <span className="text-[9px] font-black text-slate-500 uppercase block">Amount</span>
                            <span className={`font-black ${currentItem.debit ? 'text-[#ff4b3f]' : 'text-emerald-600'}`}>
                              {currentItem.debit ? `Debit: ₹${Number(currentItem.debit).toFixed(2)}` : `Credit: ₹${Number(currentItem.credit).toFixed(2)}`}
                            </span>
                          </div>
                        </div>

                        <div>
                          <label className="block text-[10px] font-black text-black uppercase mb-1">Edit Narration</label>
                          <input
                            type="text"
                            value={editedNarrations[originalIdx] !== undefined ? editedNarrations[originalIdx] : currentItem.narration}
                            onChange={(e) => handleNarrationEdit(originalIdx, e.target.value)}
                            className="w-full px-2.5 py-1.5 border-2 border-black text-xs font-mono font-bold bg-white focus:outline-none focus:bg-yellow-50"
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] font-black text-black uppercase mb-1">Assign Counter Ledger</label>
                          <input
                            type="text"
                            value={editedLedgers[originalIdx] !== undefined ? editedLedgers[originalIdx] : (currentItem.assigned_ledger || counterLedgerName)}
                            onChange={(e) => handleLedgerEdit(originalIdx, e.target.value)}
                            className="w-full px-2.5 py-1.5 border-2 border-black text-xs font-bold bg-white focus:outline-none focus:bg-yellow-50"
                          />
                        </div>
                      </div>

                      {/* Stepper Buttons */}
                      <div className="flex items-center justify-between pt-2">
                        <div className="flex space-x-2">
                          <button
                            disabled={currentReviewIdx === 0}
                            onClick={() => setCurrentReviewIdx(prev => Math.max(0, prev - 1))}
                            className="px-3 py-1.5 border-2 border-black font-black text-xs bg-white hover:bg-slate-100 disabled:opacity-40 uppercase"
                          >
                            ← PREV
                          </button>
                          <button
                            disabled={currentReviewIdx >= reviewList.length - 1}
                            onClick={() => setCurrentReviewIdx(prev => Math.min(reviewList.length - 1, prev + 1))}
                            className="px-3 py-1.5 border-2 border-black font-black text-xs bg-white hover:bg-slate-100 disabled:opacity-40 uppercase"
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
                          className="px-4 py-2 border-2 border-black font-black text-xs bg-[#3affaa] hover:bg-emerald-400 shadow-[2px_2px_0px_rgba(0,0,0,1)] uppercase"
                        >
                          ACCEPT & RESOLVE ✓
                        </button>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          )}

          {/* --- Custom CSV Column Mapping Modal --- */}
          {mappingModalOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 overflow-y-auto">
              <div className="bg-white border-4 border-black shadow-[10px_10px_0px_rgba(0,0,0,1)] max-w-2xl w-full p-6 space-y-5 my-8">
                {/* Modal Header */}
                <div className="flex justify-between items-center bg-[#ffd615] p-3 border-2 border-black shadow-[2px_2px_0px_rgba(0,0,0,1)]">
                  <div className="flex items-center space-x-2">
                    <span className="text-base font-black">⚙</span>
                    <h3 className="text-xs font-black uppercase text-black">
                      {editingMappingId ? 'Edit CSV Column Mapping Template' : 'New Custom CSV Column Mapping Template'}
                    </h3>
                  </div>
                  <button
                    onClick={() => setMappingModalOpen(false)}
                    className="text-black font-black text-sm px-2 py-0.5 border border-black hover:bg-black hover:text-white"
                  >
                    ✕
                  </button>
                </div>

                {/* Auto-Detect Helper */}
                <div className="p-3 bg-slate-100 border-2 border-black space-y-2">
                  <div className="text-xs font-black uppercase text-black">
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
                    className="w-full text-xs font-bold border border-black bg-white p-1"
                  />
                  {detectedHeaders.length > 0 && (
                    <div className="text-[11px] font-black text-green-700">
                      ✓ Detected {detectedHeaders.length} columns: {detectedHeaders.slice(0, 8).join(', ')}{detectedHeaders.length > 8 ? '...' : ''}
                    </div>
                  )}
                </div>

                {/* Form */}
                <form onSubmit={handleSaveMapping} className="space-y-4 text-xs">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-black text-black uppercase mb-1">
                        Template Name *
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. HDFC Bank Statement CSV"
                        value={mapFormName}
                        onChange={(e) => setMapFormName(e.target.value)}
                        className="w-full px-3 py-2 border-2 border-black font-bold focus:outline-none focus:bg-yellow-50"
                      />
                    </div>
                    <div>
                      <label className="block font-black text-black uppercase mb-1">
                        Description / Notes
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Columns for SAP/Zoho/Tally"
                        value={mapFormDesc}
                        onChange={(e) => setMapFormDesc(e.target.value)}
                        className="w-full px-3 py-2 border-2 border-black font-bold focus:outline-none focus:bg-yellow-50"
                      />
                    </div>
                  </div>

                  <div className="border-t-2 border-black pt-3">
                    <div className="font-black uppercase text-black mb-2 text-xs">Date & Voucher Details</div>
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
                          className="w-full px-2.5 py-1.5 border-2 border-black font-bold"
                        />
                      </div>
                      <div>
                        <label className="block font-bold text-slate-700 uppercase mb-1 text-[11px]">
                          Date Format
                        </label>
                        <select
                          value={mapFormDateFmt}
                          onChange={(e) => setMapFormDateFmt(e.target.value)}
                          className="w-full px-2 py-1.5 border-2 border-black font-bold bg-white"
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
                          className="w-full px-2.5 py-1.5 border-2 border-black font-bold"
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
                          className="w-full px-2.5 py-1.5 border-2 border-black font-bold"
                        />
                      </div>
                      <div>
                        <label className="block font-bold text-slate-700 uppercase mb-1 text-[11px]">
                          Default Voucher Type (fallback)
                        </label>
                        <select
                          value={mapFormDefVtype}
                          onChange={(e) => setMapFormDefVtype(e.target.value)}
                          className="w-full px-2 py-1.5 border-2 border-black font-bold bg-white"
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

                  <div className="border-t-2 border-black pt-3">
                    <div className="font-black uppercase text-black mb-2 text-xs">Double-Entry Ledgers</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="p-2.5 bg-red-50 border border-black space-y-2">
                        <label className="block font-black text-red-900 uppercase text-[11px]">
                          Debit Ledger Column
                        </label>
                        <input
                          type="text"
                          value={mapFormDrCol}
                          onChange={(e) => setMapFormDrCol(e.target.value)}
                          list="detected-headers-list"
                          placeholder="e.g. Debit Ledger / Expense"
                          className="w-full px-2.5 py-1.5 border-2 border-black font-bold bg-white"
                        />
                        <label className="block font-bold text-slate-600 uppercase text-[10px]">
                          Fallback Debit Ledger Name (if empty)
                        </label>
                        <input
                          type="text"
                          value={mapFormDefDr}
                          onChange={(e) => setMapFormDefDr(e.target.value)}
                          placeholder="e.g. General Expenses"
                          className="w-full px-2 py-1 border border-black font-bold bg-white"
                        />
                      </div>

                      <div className="p-2.5 bg-green-50 border border-black space-y-2">
                        <label className="block font-black text-green-900 uppercase text-[11px]">
                          Credit Ledger Column
                        </label>
                        <input
                          type="text"
                          value={mapFormCrCol}
                          onChange={(e) => setMapFormCrCol(e.target.value)}
                          list="detected-headers-list"
                          placeholder="e.g. Credit Ledger / Bank"
                          className="w-full px-2.5 py-1.5 border-2 border-black font-bold bg-white"
                        />
                        <label className="block font-bold text-slate-600 uppercase text-[10px]">
                          Fallback Credit Ledger Name (if empty)
                        </label>
                        <input
                          type="text"
                          value={mapFormDefCr}
                          onChange={(e) => setMapFormDefCr(e.target.value)}
                          placeholder="e.g. HDFC Bank Account"
                          className="w-full px-2 py-1 border border-black font-bold bg-white"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="border-t-2 border-black pt-3">
                    <div className="font-black uppercase text-black mb-2 text-xs">Amount & Narration Mapping</div>
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
                          className="w-full px-2.5 py-1.5 border-2 border-black font-bold"
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
                          className="w-full px-2.5 py-1.5 border-2 border-black font-bold"
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
                          className="w-full px-2.5 py-1.5 border-2 border-black font-bold"
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
                          className="w-full px-2.5 py-1.5 border-2 border-black font-bold"
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
                          className="w-full px-2.5 py-1.5 border-2 border-black font-bold"
                        />
                      </div>
                    </div>
                  </div>

                  <datalist id="detected-headers-list">
                    {detectedHeaders.map((h, i) => (
                      <option key={i} value={h} />
                    ))}
                  </datalist>

                  <div className="flex items-center justify-end space-x-3 pt-3 border-t-2 border-black">
                    <button
                      type="button"
                      onClick={() => setMappingModalOpen(false)}
                      className="px-4 py-2 border-2 border-black font-black uppercase text-xs hover:bg-slate-100"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-6 py-2 bg-[#ffd615] text-black border-2 border-black font-black uppercase text-xs shadow-[3px_3px_0px_rgba(0,0,0,1)] hover:bg-yellow-400"
                    >
                      {editingMappingId ? 'Update Mapping Template' : 'Save Mapping Template'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* --- Keyboard Shortcuts Helper Modal --- */}
          {shortcutsModalOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
              <div className="bg-white border-4 border-black shadow-[10px_10px_0px_rgba(0,0,0,1)] max-w-md w-full p-6 space-y-4">
                <div className="flex justify-between items-center bg-[#ffd615] p-3 border-2 border-black shadow-[2px_2px_0px_rgba(0,0,0,1)]">
                  <h3 className="text-sm font-black uppercase text-black">⌨️ Keyboard Shortcuts</h3>
                  <button
                    onClick={() => setShortcutsModalOpen(false)}
                    className="text-black font-black text-sm px-2 py-0.5 border border-black hover:bg-black hover:text-white"
                  >
                    ✕
                  </button>
                </div>

                <div className="divide-y divide-black border-2 border-black text-xs font-bold">
                  <div className="flex justify-between p-2.5 bg-slate-50">
                    <span>Search Transactions / History</span>
                    <kbd className="px-2 py-0.5 bg-white border border-black font-mono font-black text-[11px] shadow-[1px_1px_0px_rgba(0,0,0,1)]">Ctrl + F</kbd>
                  </div>
                  <div className="flex justify-between p-2.5 bg-white">
                    <span>Undo Narration Edit</span>
                    <kbd className="px-2 py-0.5 bg-white border border-black font-mono font-black text-[11px] shadow-[1px_1px_0px_rgba(0,0,0,1)]">Ctrl + Z</kbd>
                  </div>
                  <div className="flex justify-between p-2.5 bg-slate-50">
                    <span>Close Open Dialog / Modal</span>
                    <kbd className="px-2 py-0.5 bg-white border border-black font-mono font-black text-[11px] shadow-[1px_1px_0px_rgba(0,0,0,1)]">Esc</kbd>
                  </div>
                  <div className="flex justify-between p-2.5 bg-white">
                    <span>Navigate Between Fields</span>
                    <kbd className="px-2 py-0.5 bg-white border border-black font-mono font-black text-[11px] shadow-[1px_1px_0px_rgba(0,0,0,1)]">Tab / Shift + Tab</kbd>
                  </div>
                </div>

                <button
                  onClick={() => setShortcutsModalOpen(false)}
                  className="w-full py-2 bg-black text-white border-2 border-black font-black text-xs uppercase shadow-[2px_2px_0px_rgba(0,0,0,1)]"
                >
                  GOT IT
                </button>
              </div>
            </div>
          )}
          
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t-4 border-black py-6 text-center text-xs font-bold text-black mt-auto space-y-4">
        {/* Contact CTA */}
        <div className="flex flex-col sm:flex-row items-center justify-center space-y-2 sm:space-y-0 sm:space-x-3 pb-2 border-b border-slate-100 max-w-lg mx-auto">
          <span>To know more, book demo or pricing contact us:</span>
          <div className="flex items-center space-x-3">
            {/* WhatsApp Link */}
            <a
              href="https://wa.me/919204915729?text=Hello!%20I'd%20like%20to%20know%20more,%20book%20a%20demo,%20or%20discuss%20pricing%20for%20Sheet%20Buddy."
              target="_blank"
              rel="noopener noreferrer"
              className="p-1 border-2 border-black bg-[#25D366] hover:bg-green-500 text-white rounded-none shadow-[2px_2px_0px_rgba(0,0,0,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0px_rgba(0,0,0,1)] transition-all flex items-center justify-center w-7 h-7"
              title="Contact on WhatsApp"
            >
              <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                <path d="M17.472 14.382c-.022-.079-.116-.123-.27-.2c-.155-.077-.915-.452-1.056-.502c-.142-.053-.247-.077-.35.077c-.104.154-.4.502-.49.603c-.09.1-.18.11-.33.037c-.152-.074-.64-.236-1.22-.756c-.45-.4-.754-.896-.838-1.042c-.085-.145-.01-.223.067-.3c.068-.07.155-.18.23-.27c.077-.09.104-.15.155-.25c.05-.1.025-.19-.012-.265c-.038-.076-.35-.85-.48-1.164c-.127-.31-.257-.267-.35-.272c-.09-.004-.19-.004-.29-.004c-.1-.004-.263.038-.4.19c-.138.15-.527.513-.527 1.253s.54 1.455.614 1.555c.077.1 1.06 1.622 2.57 2.27c.36.155.64.248.86.315c.36.115.69.098.95.06c.29-.044.9-.368 1.03-.722c.13-.356.13-.663.09-.723M12 2C6.477 2 2 6.477 2 12c0 2.01.524 3.9 1.524 5.56L2 22l4.632-1.216C8.204 21.464 9.99 22 12 22c5.523 0 10-4.477 10-10S17.523 2 12 2z"/>
              </svg>
            </a>
            {/* Email Link */}
            <a
              href="mailto:sheetbuddyorg@gmail.com?subject=Sheet%20Buddy%20Demo%20and%20Pricing%20Inquiry"
              className="p-1 border-2 border-black bg-[#3b82f6] hover:bg-blue-500 text-white rounded-none shadow-[2px_2px_0px_rgba(0,0,0,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0px_rgba(0,0,0,1)] transition-all flex items-center justify-center w-7 h-7"
              title="Send an Email"
            >
              <svg className="w-4 h-4 fill-none stroke-current" viewBox="0 0 24 24" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </a>
          </div>
        </div>

        <div className="flex items-center justify-center space-x-2 pt-2">
          <img src="/symbol_mark.svg" alt="Sheet Buddy" className="w-5 h-5 border border-black bg-black inline-block" />
          <span className="font-black uppercase tracking-tight">Sheet Buddy</span>
          <span className="text-slate-400 font-normal">|</span>
          <span className="text-slate-600 font-bold">A Tally Supporting Tool • Since 2026</span>
        </div>

        <p className="text-slate-600 font-bold">
          Build with ❤️ by{" "}
          <a
            href="https://www.instagram.com/verx_mysterio?igsi=MzliODFvcWt0emhn"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:no-underline text-black font-black"
          >
            verx_mysterio
          </a>
        </p>
      </footer>

    </div>
  );
}
