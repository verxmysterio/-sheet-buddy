import re
from typing import Dict, Any, List, Optional

class BankDetectionResult:
    def __init__(
        self,
        bank_key: str,
        bank_name: str,
        confidence: float,
        format_name: str,
        detection_signals: List[str],
        recommended_action: str = "AUTO_SELECT" # AUTO_SELECT, CONFIRM_WITH_USER, MANUAL_CHOICE
    ):
        self.bank_key = bank_key
        self.bank_name = bank_name
        self.confidence = confidence
        self.format_name = format_name
        self.detection_signals = detection_signals
        self.recommended_action = recommended_action

    def to_dict(self) -> Dict[str, Any]:
        return {
            "bank_key": self.bank_key,
            "bank_name": self.bank_name,
            "confidence": round(self.confidence, 1),
            "format_name": self.format_name,
            "detection_signals": self.detection_signals,
            "recommended_action": self.recommended_action
        }

class AutomaticBankDetector:
    BANK_PROFILES = [
        {
            "key": "sbi",
            "name": "State Bank of India",
            "format": "SBI Retail & Corporate Statement Format",
            "ifsc_prefix": "SBIN",
            "keywords": ["STATE BANK OF INDIA", "SBIN", "SBI", "WWW.ONLINESBI.COM", "SARAL", "INB REF", "SBICARD"],
            "headers": ["Txn Date", "Value Date", "Description", "Ref No./Cheque No.", "Debit", "Credit", "Balance"],
            "weight": 1.0
        },
        {
            "key": "hdfc",
            "name": "HDFC Bank",
            "format": "HDFC SmartStatement & NetBanking Format",
            "ifsc_prefix": "HDFC",
            "keywords": ["HDFC BANK", "HDFCBANK", "WWW.HDFCBANK.COM", "SMARTSTATEMENT", "HDFC BANK LIMITED"],
            "headers": ["Date", "Narration", "Chq./Ref.No.", "Value Dt", "Withdrawal Amt.", "Deposit Amt.", "Closing Balance"],
            "weight": 1.0
        },
        {
            "key": "icici",
            "name": "ICICI Bank",
            "format": "ICICI Corporate & Retail Statement",
            "ifsc_prefix": "ICIC",
            "keywords": ["ICICI BANK", "ICICIBANK", "ICICI BANK LTD", "WWW.ICICIBANK.COM", "INFINITY"],
            "headers": ["Value Date", "Transaction Date", "Cheque Number", "Transaction Remarks", "Debit Amount", "Credit Amount", "Balance (INR)"],
            "weight": 1.0
        },
        {
            "key": "axis",
            "name": "Axis Bank",
            "format": "Axis Bank Account Statement",
            "ifsc_prefix": "UTIB",
            "keywords": ["AXIS BANK", "UTIB", "AXISBANK", "WWW.AXISBANK.COM", "AXIS BANK LIMITED"],
            "headers": ["Tran Date", "CHQNO", "PARTICULARS", "DEBIT", "CREDIT", "BALANCE", "INIT.BR"],
            "weight": 1.0
        },
        {
            "key": "bob",
            "name": "Bank of Baroda",
            "format": "Bank of Baroda Finacle Statement",
            "ifsc_prefix": "BARB",
            "keywords": ["BANK OF BARODA", "BARB", "BOB", "BARODABANK", "FINACLE", "CUSTOMER ACCOUNT LEDGER REPORT"],
            "headers": ["S No", "Date", "Description", "Cheque No", "Withdrawal (Dr)", "Deposit (Cr)", "Balance"],
            "weight": 1.0
        },
        {
            "key": "pnb",
            "name": "Punjab National Bank",
            "format": "PNB Standard Account Statement",
            "ifsc_prefix": "PUNB",
            "keywords": ["PUNJAB NATIONAL BANK", "PNB", "PUNB", "PNB INDIA", "PNBDIGITAL"],
            "headers": ["Txn Date", "Value Date", "Description", "Cheque No", "Withdrawal", "Deposit", "Balance"],
            "weight": 1.0
        },
        {
            "key": "kotak",
            "name": "Kotak Mahindra Bank",
            "format": "Kotak Mahindra Account Statement",
            "ifsc_prefix": "KKBK",
            "keywords": ["KOTAK MAHINDRA BANK", "KOTAK", "KKBK", "KOTAK.COM", "KOTAK BANK"],
            "headers": ["Date", "Narration", "Chq / Ref No", "Withdrawal(Dr) / Deposit(Cr)", "Balance"],
            "weight": 1.0
        },
        {
            "key": "canara",
            "name": "Canara Bank",
            "format": "Canara Bank Statement",
            "ifsc_prefix": "CNRB",
            "keywords": ["CANARA BANK", "CANARA", "CNRB", "CANARABANK.COM"],
            "headers": ["TRANS DATE", "VALUE DATE", "REMARKS", "DEBIT", "CREDIT", "BALANCE"],
            "weight": 1.0
        },
        {
            "key": "indusind",
            "name": "IndusInd Bank",
            "format": "IndusInd Bank Statement",
            "ifsc_prefix": "INDB",
            "keywords": ["INDUSIND BANK", "INDUSIND", "INDB", "INDUSIND.COM"],
            "headers": ["Date", "Description", "Cheque / Ref No", "Debit", "Credit", "Balance"],
            "weight": 1.0
        }
    ]

    @classmethod
    def detect_bank_from_text(cls, extracted_text_samples: List[str]) -> BankDetectionResult:
        """
        Analyzes multi-page text samples and matches against Indian bank profile heuristics.
        """
        combined_text = " ".join(extracted_text_samples[:3]).upper()
        
        scores: Dict[str, float] = {}
        signals: Dict[str, List[str]] = {}
        
        for profile in cls.BANK_PROFILES:
            key = profile["key"]
            scores[key] = 0.0
            signals[key] = []
            
            # 1. Exact IFSC code match (Very strong signal +45 pts)
            ifsc_prefix = profile["ifsc_prefix"]
            if re.search(rf'\b{ifsc_prefix}[A-Z0-9]{{7}}\b', combined_text):
                scores[key] += 45.0
                signals[key].append(f"IFSC Code Prefix matched: {ifsc_prefix}")
                
            # 2. Main Bank Name / Brand Keywords (+15 to +35 pts)
            for kw in profile["keywords"]:
                if kw in combined_text:
                    points = 25.0 if kw == profile["keywords"][0] else 10.0
                    scores[key] += points
                    signals[key].append(f"Keyword matched: {kw}")
                    break
                    
            # 3. Column Header matches (+5 pts each)
            matched_headers = 0
            for header in profile["headers"]:
                if header.upper() in combined_text:
                    matched_headers += 1
            if matched_headers >= 3:
                scores[key] += min(30.0, matched_headers * 6.0)
                signals[key].append(f"{matched_headers} column headers matched")
                
        # Find best candidate
        best_key = max(scores, key=scores.get)
        best_score = scores[best_key]
        
        # Normalize score to 0-100%
        normalized_confidence = min(99.4, max(15.0, best_score))
        
        best_profile = next(p for p in cls.BANK_PROFILES if p["key"] == best_key)
        
        if normalized_confidence >= 80.0:
            recommended_action = "AUTO_SELECT"
        elif normalized_confidence >= 50.0:
            recommended_action = "CONFIRM_WITH_USER"
        else:
            recommended_action = "MANUAL_CHOICE"
            # Fallback to Generic / Simulator if no reliable match
            if normalized_confidence < 30.0:
                return BankDetectionResult(
                    bank_key="rule_based",
                    bank_name="Generic Bank Statement",
                    confidence=35.0,
                    format_name="Generic Rule-Based Column Extractor",
                    detection_signals=["No distinct bank brand signatures detected. Using generic rule-based parser."],
                    recommended_action="CONFIRM_WITH_USER"
                )
                
        return BankDetectionResult(
            bank_key=best_profile["key"],
            bank_name=best_profile["name"],
            confidence=normalized_confidence,
            format_name=best_profile["format"],
            detection_signals=signals[best_key],
            recommended_action=recommended_action
        )
