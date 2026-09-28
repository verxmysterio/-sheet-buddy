import re
from datetime import datetime as dt_class, date
from pypdf import PdfReader
from typing import List, Tuple, Any, Dict
from .base import BankParser, StandardTransaction, StatementMetadata, reconcile_statement_and_transactions

class RuleBasedParser(BankParser):
    def __init__(self, bank_name: str, config_data: Dict[str, Any]):
        self.bank_name = bank_name
        self.cfg = config_data or {}
        
    def parse(self, pdf_path_or_bytes: Any) -> Tuple[StatementMetadata, List[StandardTransaction]]:
        reader = PdfReader(pdf_path_or_bytes)
        pages_count = len(reader.pages)
        
        date_format = self.cfg.get("date_format", "%d/%m/%Y")
        col_date = int(self.cfg.get("col_date", 0))
        col_narration = int(self.cfg.get("col_narration", 1))
        col_debit = int(self.cfg.get("col_debit", 2))
        col_credit = int(self.cfg.get("col_credit", 3))
        col_balance = int(self.cfg.get("col_balance", 4))
        
        date_re = re.compile(r"^\d{2}[/\-]\d{2}[/\-]\d{4}")
        raw_tx_list = []
        
        for page_idx, page in enumerate(reader.pages):
            text_content = page.extract_text() or ""
            lines = text_content.split("\n")
            for line in lines:
                line_clean = line.strip()
                if date_re.match(line_clean):
                    parts = re.split(r'\s{2,}', line_clean)
                    if len(parts) < 3:
                        parts = line_clean.split("\t")
                    if len(parts) < 3:
                        parts = [p for p in line_clean.split(" ") if p.strip()]
                        
                    if len(parts) > max(col_date, col_narration, col_debit, col_credit, col_balance):
                        try:
                            date_str = parts[col_date].strip()
                            clean_d = date_str[:10].replace("-", "/")
                            clean_fmt = date_format.replace("-", "/")
                            txn_date = dt_class.strptime(clean_d, clean_fmt).date()
                            
                            narration = parts[col_narration].strip() if col_narration < len(parts) else "TRANSACTION"
                            
                            debit_str = parts[col_debit].replace(",", "").strip() if col_debit < len(parts) else ""
                            credit_str = parts[col_credit].replace(",", "").strip() if col_credit < len(parts) else ""
                            
                            debit = float(debit_str) if (debit_str and not debit_str.isspace()) else None
                            credit = float(credit_str) if (credit_str and not credit_str.isspace()) else None
                            
                            bal_str = parts[col_balance].replace(",", "").strip() if col_balance < len(parts) else ""
                            balance = float(bal_str) if bal_str else 0.0
                            
                            raw_tx_list.append(StandardTransaction(
                                txn_date=txn_date,
                                val_date=txn_date,
                                narration=narration,
                                debit=debit,
                                credit=credit,
                                balance=balance,
                                page_number=page_idx + 1,
                                parser_name="RuleBasedParser"
                            ))
                        except Exception:
                            continue
                            
        if raw_tx_list:
            first_tx = raw_tx_list[0]
            opening_bal = first_tx.balance - ((first_tx.credit or 0.0) - (first_tx.debit or 0.0))
            closing_bal = raw_tx_list[-1].balance
        else:
            opening_bal = 0.0
            closing_bal = 0.0
            
        is_reconciled, discrepancy, transactions = reconcile_statement_and_transactions(
            opening_balance=opening_bal,
            transactions=raw_tx_list,
            closing_balance=closing_bal
        )
        
        metadata = StatementMetadata(
            bank_name=self.bank_name,
            account_name="M/S CUSTOMER",
            account_number="A/C 999999999",
            branch="LOCAL BRANCH",
            statement_period="Custom Statement Period",
            opening_balance=opening_bal,
            closing_balance=closing_bal,
            total_debits=sum(t.debit or 0.0 for t in transactions),
            total_credits=sum(t.credit or 0.0 for t in transactions),
            pages_count=pages_count,
            transactions_count=len(transactions),
            is_reconciled=is_reconciled,
            reconciliation_discrepancy=discrepancy,
            detected_bank=self.bank_name,
            parser_name="RuleBasedParser",
            review_queue_count=sum(1 for t in transactions if t.requires_review),
            duplicate_count=sum(1 for t in transactions if t.is_duplicate),
            high_confidence_count=sum(1 for t in transactions if t.confidence_grade == "HIGH")
        )
        
        return metadata, transactions
