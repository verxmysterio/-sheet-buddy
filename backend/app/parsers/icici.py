import re
from datetime import datetime, date
from pypdf import PdfReader
from typing import List, Tuple, Any
from .base import BankParser, StandardTransaction, StatementMetadata, reconcile_statement_and_transactions

class ICICIParser(BankParser):
    def parse(self, pdf_path_or_bytes: Any) -> Tuple[StatementMetadata, List[StandardTransaction]]:
        reader = PdfReader(pdf_path_or_bytes)
        pages_count = len(reader.pages)
        
        first_page_text = reader.pages[0].extract_text() or ""
        account_name = "ICICI ACCOUNT HOLDER"
        account_number = None
        branch = None
        statement_period = None
        
        name_match = re.search(r'(?:Account Name|Name)\s*:\s*([^\n]+)', first_page_text, re.IGNORECASE)
        if name_match:
            account_name = name_match.group(1).strip()
            
        num_match = re.search(r'(?:Account No|Account Number)\s*:\s*(\d+)', first_page_text, re.IGNORECASE)
        if num_match:
            account_number = num_match.group(1).strip()
            
        branch_match = re.search(r'(?:Branch|Base Branch)\s*:\s*([^\n]+)', first_page_text, re.IGNORECASE)
        if branch_match:
            branch = branch_match.group(1).strip()
            
        date_re = re.compile(r'^\d{2}[/-]\d{2}[/-]\d{4}')
        raw_tx_list: List[StandardTransaction] = []
        
        for p_idx, page in enumerate(reader.pages):
            text = page.extract_text() or ""
            lines = text.split("\n")
            
            for line in lines:
                line_clean = line.strip()
                if not line_clean:
                    continue
                    
                match = date_re.match(line_clean)
                if match:
                    parts = re.split(r'\s{2,}', line_clean)
                    if len(parts) < 4:
                        parts = [p for p in line_clean.split(" ") if p.strip()]
                        
                    if len(parts) >= 4:
                        try:
                            d_str = parts[0].strip()[:10].replace("-", "/")
                            txn_date = datetime.strptime(d_str, "%d/%m/%Y").date()
                            
                            narration = parts[1].strip() if len(parts) > 1 else "ICICI TRANSACTION"
                            
                            numbers = []
                            for p in parts[2:]:
                                clean_p = p.replace(",", "").replace("Cr", "").replace("Dr", "").replace("CR", "").replace("DR", "").strip()
                                try:
                                    numbers.append(float(clean_p))
                                except ValueError:
                                    pass
                                    
                            debit = None
                            credit = None
                            balance = 0.0
                            
                            if len(numbers) >= 2:
                                balance = numbers[-1]
                                amt = numbers[-2]
                                if "CR" in line_clean.upper() or "CREDIT" in line_clean.upper():
                                    credit = amt
                                else:
                                    debit = amt
                            elif len(numbers) == 1:
                                balance = numbers[0]
                                
                            raw_tx_list.append(StandardTransaction(
                                txn_date=txn_date,
                                val_date=txn_date,
                                narration=narration,
                                debit=debit,
                                credit=credit,
                                balance=balance,
                                page_number=p_idx + 1,
                                parser_name="ICICIParser"
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
            bank_name="ICICI Bank",
            account_name=account_name,
            account_number=account_number,
            branch=branch,
            statement_period=statement_period,
            opening_balance=opening_bal,
            closing_balance=closing_bal,
            total_debits=sum(t.debit or 0.0 for t in transactions),
            total_credits=sum(t.credit or 0.0 for t in transactions),
            pages_count=pages_count,
            transactions_count=len(transactions),
            is_reconciled=is_reconciled,
            reconciliation_discrepancy=discrepancy,
            detected_bank="ICICI Bank",
            parser_name="ICICIParser",
            review_queue_count=sum(1 for t in transactions if t.requires_review),
            duplicate_count=sum(1 for t in transactions if t.is_duplicate),
            high_confidence_count=sum(1 for t in transactions if t.confidence_grade == "HIGH")
        )
        
        return metadata, transactions
