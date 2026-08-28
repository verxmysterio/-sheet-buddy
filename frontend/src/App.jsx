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

export default function App() {
  // --- Auth State ---
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [user, setUser] = useState(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
  const [activeTab, setActiveTab] = useState('convert'); // 'convert' | 'history' | 'wallet' | 'easter' | 'settings'

  // --- Upload / Convert State ---
  const [bankName, setBankName] = useState('');
  const [supportedBanks, setSupportedBanks] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [parsedSummary, setParsedSummary] = useState(null);
  
  // --- Custom Tally Overrides ---
  const [tallyLedgerName, setTallyLedgerName] = useState('');
  const [counterLedgerName, setCounterLedgerName] = useState('Suspense');
  const [creditVoucherType, setCreditVoucherType] = useState('Receipt');
  const [debitVoucherType, setDebitVoucherType] = useState('Payment');
  const [editedNarrations, setEditedNarrations] = useState({}); // idx -> customized narration text
  
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
    } else {
      localStorage.removeItem('token');
      setUser(null);
    }
  }, [token]);

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
          setBankName(prev => prev || data[0].name);
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
        body: JSON.stringify({ email, password })
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
        const initialNarrs = {};
        data.transactions_preview.forEach((tx, index) => {
          initialNarrs[index] = tx.narration;
        });
        setEditedNarrations(initialNarrs);
      }
    } catch (err) {
      setUploadError('Network error. Failed to parse statement PDF.');
    } finally {
      setUploadLoading(false);
    }
  };

  const handleNarrationEdit = (idx, newText) => {
    setEditedNarrations(prev => ({
      ...prev,
      [idx]: newText
    }));
  };

  const handleExecuteConversion = async () => {
    if (!tallyLedgerName.trim()) {
      setExecuteError('Please enter the bank ledger name exactly as it exists in Tally.');
      return;
    }
    if (!counterLedgerName.trim()) {
      setExecuteError('Please enter a valid counter ledger name (e.g. Suspense).');
      return;
    }

    setExecuteLoading(true);
    setExecuteError('');

    const formData = new FormData();
    formData.append('temp_file_id', parsedSummary.temp_file_id);
    formData.append('tally_bank_ledger_name', tallyLedgerName);
    formData.append('bank_name', bankName);
    formData.append('counter_ledger_name', counterLedgerName);
    formData.append('credit_voucher_type', creditVoucherType);
    formData.append('debit_voucher_type', debitVoucherType);
    formData.append('edited_narrations', JSON.stringify(editedNarrations));

    try {
      const res = await fetch('/api/convert/execute', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });

      if (!res.ok) {
        const data = await res.json();
        setExecuteError(data.detail || 'Conversion execution failed.');
      } else {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Tally_Import_${bankName.replace(/ /g, '_')}_Statement.xml`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        
        setParsedSummary(null);
        setSelectedFile(null);
        setTallyLedgerName('');
        setCounterLedgerName('Suspense');
        setEditedNarrations({});
        
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

  // Filter history list based on search bar query
  const filteredHistory = conversionsHistory.filter(conv => {
    const q = historySearch.toLowerCase();
    return conv.bank_name.toLowerCase().includes(q) || 
           (conv.statement_period && conv.statement_period.toLowerCase().includes(q)) ||
           (conv.account_number && conv.account_number.toLowerCase().includes(q));
  });

  // --- Auth View ---
  if (!token || !user) {
    return (
      <div className="flex-1 flex flex-col justify-center py-12 px-4 bg-[#f4f2ed] min-h-screen">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <div className="flex justify-center text-black">
            <svg className="w-20 h-20 bg-[#ffd615] border-4 border-black p-2 shadow-[4px_4px_0px_rgba(0,0,0,1)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h2 className="mt-6 text-center text-4xl font-black text-black tracking-tight uppercase">
            Sheet Buddy
          </h2>
          <p className="mt-2 text-center text-sm text-black border-2 border-black bg-white inline-block px-3 py-1 mx-auto shadow-[2px_2px_0px_rgba(0,0,0,1)] font-bold uppercase">
            Statement PDF to Tally XML SaaS
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
        </div>
      </div>
    );
  }

  // --- Main Brutalist Header Navigation Dashboard View ---
  return (
    <div className="min-h-screen flex flex-col bg-[#f4f2ed]">
      
      {/* Top Header containing Navigation Menu, Logo, and User stats */}
      <header className="bg-white border-b-4 border-black flex flex-col md:flex-row items-stretch md:items-center justify-between shadow-[0px_4px_0px_rgba(0,0,0,0.05)] sticky top-0 z-50">
        
        {/* Left: Brand Logo & Mobile hamburger toggle */}
        <div className="h-16 flex items-center justify-between px-6 border-b-4 md:border-b-0 md:border-r-4 border-black bg-[#ffd615] flex-shrink-0">
          <div className="flex items-center">
            <svg className="w-7 h-7 text-black mr-2 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="font-black text-black text-lg tracking-tight uppercase">Sheet Buddy</span>
          </div>

          {/* Hamburger Icon button for mobile screen */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-1 border-2 border-black bg-white hover:bg-slate-100 text-black focus:outline-none"
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

        {/* Collapsible Area: active on mobile screen when mobileMenuOpen is true */}
        <div className={`${mobileMenuOpen ? 'flex' : 'hidden'} md:flex flex-col md:flex-row flex-1 items-stretch md:items-center justify-between`}>
          {/* Center: Navigation Menu inside Header */}
          <nav className="flex flex-col md:flex-row items-stretch md:items-center px-6 py-4 md:py-0 md:space-x-3 space-y-2 md:space-y-0 flex-1 justify-start md:justify-center border-b-2 md:border-b-0 border-black">
            <button
              onClick={() => { setActiveTab('convert'); setExecuteError(''); setMobileMenuOpen(false); }}
              className={`flex items-center justify-center px-4 py-2 text-xs font-black border-2 border-black transition-all ${activeTab === 'convert' ? 'bg-[#ffd615] text-black shadow-[2px_2px_0px_rgba(0,0,0,1)] -translate-y-[1px]' : 'bg-white hover:bg-slate-50'}`}
            >
              CONVERT PDF
            </button>
            <button
              onClick={() => { setActiveTab('history'); setExecuteError(''); setMobileMenuOpen(false); }}
              className={`flex items-center justify-center px-4 py-2 text-xs font-black border-2 border-black transition-all ${activeTab === 'history' ? 'bg-[#ffd615] text-black shadow-[2px_2px_0px_rgba(0,0,0,1)] -translate-y-[1px]' : 'bg-white hover:bg-slate-50'}`}
            >
              HISTORY ARCHIVE
            </button>
            <button
              onClick={() => { setActiveTab('wallet'); setExecuteError(''); setMobileMenuOpen(false); }}
              className={`flex items-center justify-center px-4 py-2 text-xs font-black border-2 border-black transition-all ${activeTab === 'wallet' ? 'bg-[#ffd615] text-black shadow-[2px_2px_0px_rgba(0,0,0,1)] -translate-y-[1px]' : 'bg-white hover:bg-slate-50'}`}
            >
              BUY CREDITS
            </button>
            <button
              onClick={() => { setActiveTab('support'); setExecuteError(''); setMobileMenuOpen(false); }}
              className={`flex items-center justify-center px-4 py-2 text-xs font-black border-2 border-black transition-all ${activeTab === 'support' ? 'bg-[#ffd615] text-black shadow-[2px_2px_0px_rgba(0,0,0,1)] -translate-y-[1px]' : 'bg-white hover:bg-slate-50'}`}
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
              className={`flex items-center justify-center px-4 py-2 text-xs font-black border-2 border-black transition-all ${activeTab === 'settings' ? 'bg-[#ffd615] text-black shadow-[2px_2px_0px_rgba(0,0,0,1)] -translate-y-[1px]' : 'bg-white hover:bg-slate-50'}`}
            >
              PROFILE SECURITY
            </button>
            {user.is_admin && (
              <button
                onClick={() => { setActiveTab('admin'); setExecuteError(''); setMobileMenuOpen(false); }}
                className={`flex items-center justify-center px-4 py-2 text-xs font-black border-2 border-black transition-all ${activeTab === 'admin' ? 'bg-[#ffd615] text-black shadow-[2px_2px_0px_rgba(0,0,0,1)] -translate-y-[1px]' : 'bg-white hover:bg-slate-50'}`}
              >
                ADMIN CONSOLE
              </button>
            )}
          </nav>

          {/* Right: User Credits status and logout in header */}
          <div className="flex items-center justify-between md:justify-end px-6 py-4 md:py-0 space-x-4 border-t-2 md:border-t-0 md:border-l-4 border-black bg-slate-50 flex-shrink-0">
            <div className="text-left md:text-right py-1">
              <span className="block text-[8px] font-black text-slate-500 uppercase tracking-widest">{user.email}</span>
              <div className="flex items-center space-x-1.5 mt-0.5 justify-start md:justify-end">
                <span className="text-sm font-black text-black">{user.page_credits}</span>
                <span className="text-[10px] font-bold text-slate-600">Credits</span>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="px-3 py-1.5 border-2 border-black font-black text-xs text-black bg-white hover:bg-[#ff5757] hover:text-white transition-colors"
            >
              LOGOUT
            </button>
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
          <div className="space-y-8">
            
            {/* UPLOAD FORM */}
            {!parsedSummary && (
              <div className="bg-white border-4 border-black shadow-[8px_8px_0px_rgba(0,0,0,1)] p-6 max-w-2xl mx-auto">
                <div className="flex items-center space-x-3 mb-6 bg-[#ffd615] p-3 border-2 border-black shadow-[2px_2px_0px_rgba(0,0,0,1)]">
                  <div className="p-1 bg-white border-2 border-black text-black">
                    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-lg font-black text-black uppercase">Import PDF Statement</h2>
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
                        <option key={b.bank_key} value={b.name}>{b.name}</option>
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
                      <div className="space-y-2 text-center">
                        <svg className="mx-auto h-12 w-12 text-black" stroke="currentColor" fill="none" viewBox="0 0 48 48">
                          <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
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
              <div className="space-y-8 max-w-5xl mx-auto">
                
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
                      The transaction sum (Opening + Credits - Debits) does not reconcile with the reported Closing Balance. Please check the PDF.
                    </div>
                  </div>
                )}

                {/* Analytics Metric Cards Grid */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="bg-white p-4 border-4 border-black shadow-[4px_4px_0px_rgba(0,0,0,1)] flex flex-col justify-between">
                    <p className="text-[10px] font-black text-black uppercase tracking-wider">Total Transactions</p>
                    <p className="text-3xl font-black text-black mt-1">{parsedSummary.transactions_count}</p>
                    <span className="text-[10px] text-slate-500 font-bold mt-1">{parsedSummary.pages_count} PDF Pages</span>
                  </div>

                  <div className="bg-white p-4 border-4 border-black shadow-[4px_4px_0px_rgba(0,0,0,1)] flex flex-col justify-between">
                    <p className="text-[10px] font-black text-black uppercase tracking-wider">Opening Balance</p>
                    <p className="text-xl font-black text-black mt-1">₹{parsedSummary.opening_balance.toLocaleString('en-IN', {minimumFractionDigits: 2})}</p>
                    <span className="text-[10px] text-slate-500 font-bold mt-1">Start of Period</span>
                  </div>

                  <div className="bg-white p-4 border-4 border-black shadow-[4px_4px_0px_rgba(0,0,0,1)] flex flex-col justify-between">
                    <p className="text-[10px] font-black text-black uppercase tracking-wider">Closing Balance</p>
                    <p className="text-xl font-black text-black mt-1">₹{parsedSummary.closing_balance.toLocaleString('en-IN', {minimumFractionDigits: 2})}</p>
                    <span className="text-[10px] text-slate-500 font-bold mt-1">End of Period</span>
                  </div>

                  <div className="bg-white p-4 border-4 border-black shadow-[4px_4px_0px_rgba(0,0,0,1)] flex flex-col justify-between">
                    <p className="text-[10px] font-black text-black uppercase tracking-wider">Audit Result</p>
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
                    <span className="text-[10px] text-slate-500 font-bold mt-1">Mathematical verify</span>
                  </div>
                </div>

                {/* Interactive Preview Table with inline Narration Editing */}
                {parsedSummary.transactions_preview && parsedSummary.transactions_preview.length > 0 && (
                  <div className="bg-white border-4 border-black shadow-[8px_8px_0px_rgba(0,0,0,1)] overflow-hidden">
                    <div className="px-6 py-4 bg-[#ffd615] border-b-4 border-black flex justify-between items-center">
                      <div>
                        <h4 className="font-black text-black text-sm uppercase">Statement Transactions & Live Narration Editor</h4>
                        <p className="text-xs font-bold text-black opacity-80">You can edit narrations inline below. Customized entries will save directly to Tally XML.</p>
                      </div>
                      <span className="text-xs font-black bg-white border-2 border-black px-2 py-0.5 shadow-[2px_2px_0px_rgba(0,0,0,1)] uppercase">
                        PREVIEW MODE
                      </span>
                    </div>
                    <div className="overflow-x-auto max-h-[380px] overflow-y-auto">
                      <table className="min-w-full divide-y divide-black">
                        <thead className="bg-slate-100 text-[10px] font-black text-black uppercase tracking-wider sticky top-0 border-b-2 border-black bg-slate-100 z-10">
                          <tr>
                            <th className="px-4 py-3 text-left border-r border-black">Date</th>
                            <th className="px-4 py-3 text-left border-r border-black w-2/5">Narration (Double click or type to edit)</th>
                            <th className="px-4 py-3 text-left border-r border-black">Ref No.</th>
                            <th className="px-4 py-3 text-right border-r border-black">Debit (Out)</th>
                            <th className="px-4 py-3 text-right border-r border-black">Credit (In)</th>
                            <th className="px-4 py-3 text-right">Balance</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-black text-xs font-bold text-black">
                          {parsedSummary.transactions_preview.map((tx, idx) => (
                            <tr key={idx} className="hover:bg-yellow-50/20">
                              <td className="px-4 py-2.5 border-r border-black whitespace-nowrap">{tx.txn_date}</td>
                              <td className="px-4 py-2.5 border-r border-black">
                                <input
                                  type="text"
                                  value={editedNarrations[idx] !== undefined ? editedNarrations[idx] : tx.narration}
                                  onChange={(e) => handleNarrationEdit(idx, e.target.value)}
                                  className="w-full px-2 py-1 border-2 border-black font-mono font-bold text-xs bg-white focus:bg-yellow-50 focus:outline-none rounded-none"
                                />
                              </td>
                              <td className="px-4 py-2.5 border-r border-black text-slate-500 font-mono truncate max-w-xs">{tx.ref_no || '-'}</td>
                              <td className="px-4 py-2.5 border-r border-black text-right text-[#ff4b3f]">
                                {tx.debit ? `₹${tx.debit.toFixed(2)}` : ''}
                              </td>
                              <td className="px-4 py-2.5 border-r border-black text-right text-green-600">
                                {tx.credit ? `₹${tx.credit.toFixed(2)}` : ''}
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono text-slate-700">
                                ₹{tx.balance.toFixed(2)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Actions & Settings Panel Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  
                  {/* Left: Customization Settings */}
                  <div className="bg-white border-4 border-black shadow-[6px_6px_0px_rgba(0,0,0,1)] p-6 space-y-4 lg:col-span-2">
                    <h4 className="text-md font-black text-black uppercase border-b-2 border-black pb-2">Tally Integration Settings</h4>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-black text-black uppercase mb-1">Tally Bank Ledger Name</label>
                        <input
                          type="text"
                          placeholder="e.g. State Bank of India"
                          value={tallyLedgerName}
                          onChange={(e) => setTallyLedgerName(e.target.value)}
                          className="w-full px-3 py-2 border-2 border-black text-sm font-bold bg-white focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-black text-black uppercase mb-1">Counter Ledger Name</label>
                        <input
                          type="text"
                          value={counterLedgerName}
                          onChange={(e) => setCounterLedgerName(e.target.value)}
                          className="w-full px-3 py-2 border-2 border-black text-sm font-bold bg-white focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                      <div>
                        <label className="block text-xs font-black text-black uppercase mb-1">Credit Voucher Type</label>
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
                        <label className="block text-xs font-black text-black uppercase mb-1">Debit Voucher Type</label>
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
                        EXCEL EXPORT (FREE)
                      </button>

                      <button
                        onClick={() => {
                          setParsedSummary(null);
                          setTallyLedgerName('');
                          setSelectedFile(null);
                          setEditedNarrations({});
                        }}
                        className="w-full text-center text-xs font-black text-black underline hover:no-underline pt-1 block"
                      >
                        CANCEL & RE-UPLOAD
                      </button>
                    </div>
                  </div>
                </div>



            </div>
          )}
          </div>
        )}

          {/* --- TAB 2: CONVERSION HISTORY --- */}
          {activeTab === 'history' && (
            <div className="bg-white border-4 border-black shadow-[8px_8px_0px_rgba(0,0,0,1)] p-6 space-y-6 max-w-6xl mx-auto">
              
              {/* Header and Search */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center space-y-4 sm:space-y-0 border-b-4 border-black pb-4">
                <div>
                  <h3 className="text-xl font-black text-black uppercase">Conversion History Archive</h3>
                  <p className="text-xs font-bold text-slate-500 mt-1">Re-download processed XML statements from cache free of charge.</p>
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
                          <td className="px-6 py-4 border-r border-black whitespace-nowrap">{parseUtcDate(conv.created_at).toLocaleString()}</td>
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
                  <h3 className="text-xl font-black text-black uppercase mb-1">Buy Credit Vouchers</h3>
                  <p className="text-xs font-bold text-slate-500 mb-6">Purchase page credits directly. Base pricing is **25 paise per page** with bulk volume extra credits. Failed conversions are never charged.</p>
                  
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
                          <p className="text-slate-400 mt-0.5">{parseUtcDate(tx.created_at).toLocaleDateString()}</p>
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
                <h3 className="text-xl font-black text-black uppercase mb-4 border-b-2 border-black pb-2">Sheet Buddy Global System Overview</h3>
                
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
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Simulated Revenue (INR)</p>
                    <p className="text-2xl font-black text-black mt-1">₹{adminStats?.total_revenue?.toFixed(2) || '0.00'}</p>
                  </div>
                </div>
              </div>

              {/* Create User Card */}
              <div className="bg-white border-4 border-black shadow-[8px_8px_0px_rgba(0,0,0,1)] p-6 space-y-4">
                <h4 className="text-md font-black text-black uppercase border-b-2 border-black pb-2">Create New Client Account</h4>
                
                <form onSubmit={handleAdminCreateUser} className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
                  <div>
                    <label className="block text-xs font-black text-black uppercase mb-1">Email Address</label>
                    <input
                      type="email"
                      required
                      placeholder="client@email.com"
                      value={adminNewUserEmail}
                      onChange={(e) => setAdminNewUserEmail(e.target.value)}
                      className="w-full px-3 py-2 border-2 border-black text-xs font-bold bg-white focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-black text-black uppercase mb-1">Initial Password</label>
                    <input
                      type="password"
                      required
                      placeholder="Password"
                      value={adminNewUserPassword}
                      onChange={(e) => setAdminNewUserPassword(e.target.value)}
                      className="w-full px-3 py-2 border-2 border-black text-xs font-bold bg-white focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-black text-black uppercase mb-1">Initial Credits</label>
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
                            <td className="px-4 py-3 border-r border-black whitespace-nowrap">{parseUtcDate(pay.created_at).toLocaleString()}</td>
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
                            <td className="px-4 py-3 border-r border-black whitespace-nowrap">{parseUtcDate(query.created_at).toLocaleString()}</td>
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
                                {promo.expires_at ? parseUtcDate(promo.expires_at).toLocaleString() : 'Never'}
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
              <h3 className="text-xl font-black text-black uppercase mb-2 border-b-2 border-black pb-2">Support & Assistance</h3>
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
              <h3 className="text-xl font-black text-black uppercase mb-2 border-b-2 border-black pb-2">Profile Security</h3>
              
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
          
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t-4 border-black py-4 text-center text-xs font-bold text-black mt-auto">
        <p>© 2026 Sheet Buddy. Designed in Neo-Brutalist Layout. Bank statements are processed and deleted immediately.</p>
      </footer>

    </div>
  );
}
