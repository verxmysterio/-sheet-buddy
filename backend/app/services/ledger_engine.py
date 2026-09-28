import re
from typing import List, Optional, Dict, Any
from ..parsers.base import StandardTransaction

class LedgerRuleEngine:
    @staticmethod
    def apply_rules_to_transactions(
        transactions: List[StandardTransaction],
        db_rules: List[Any]
    ) -> List[StandardTransaction]:
        """
        Applies active LedgerRule records from database and updates transactions with matched ledgers,
        voucher types, and categories.
        """
        # Sort rules by priority descending
        active_rules = sorted([r for r in db_rules if r.is_active], key=lambda r: getattr(r, 'priority', 10), reverse=True)
        
        for tx in transactions:
            narration_upper = (tx.narration or "").strip().upper()
            txn_type = tx.transaction_type or ("CREDIT" if (tx.credit and tx.credit > 0) else "DEBIT")
            amount = tx.credit if txn_type == "CREDIT" else (tx.debit or 0.0)
            
            matched = False
            for rule in active_rules:
                # Check Transaction Type condition
                if rule.txn_type and rule.txn_type != "ANY" and rule.txn_type.upper() != txn_type:
                    continue
                    
                # Check Amount Range condition
                if rule.min_amount is not None and amount < rule.min_amount:
                    continue
                if rule.max_amount is not None and amount > rule.max_amount:
                    continue
                    
                # Check Pattern Matching
                pattern_upper = rule.pattern.strip().upper()
                match_type = rule.match_type.upper()
                
                is_match = False
                if match_type == "CONTAINS":
                    is_match = (pattern_upper in narration_upper)
                elif match_type == "STARTS_WITH":
                    is_match = narration_upper.startswith(pattern_upper)
                elif match_type == "ENDS_WITH":
                    is_match = narration_upper.endswith(pattern_upper)
                elif match_type == "EXACT":
                    is_match = (narration_upper == pattern_upper)
                elif match_type == "REGEX":
                    try:
                        is_match = bool(re.search(rule.pattern, tx.narration, re.IGNORECASE))
                    except re.error:
                        is_match = False
                        
                if is_match:
                    tx.suggested_ledger = rule.ledger_name
                    tx.assigned_ledger = rule.ledger_name
                    if rule.voucher_type:
                        tx.voucher_type = rule.voucher_type
                    if rule.category:
                        tx.category = rule.category
                    tx.confidence_score = min(100.0, tx.confidence_score + 10.0)
                    matched = True
                    break
                    
        return transactions
