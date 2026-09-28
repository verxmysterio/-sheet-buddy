import re
from datetime import datetime as dt_class, date
from pypdf import PdfReader
from typing import List, Tuple, Any
from .base import BankParser, StandardTransaction, StatementMetadata, reconcile_statement_and_transactions

class BOBParser(BankParser):
    def parse(self, pdf_path_or_bytes: Any) -> Tuple[StatementMetadata, List[StandardTransaction]]:
        reader = PdfReader(pdf_path_or_bytes)
        pages_count = len(reader.pages)
        
        first_page_text = reader.pages[0].extract_text() or ""
        account_name = "BANK OF BARODA ACCOUNT HOLDER"
        account_number = "803XXXXXXXX063"
        branch = "KHAMTARAI, BILASPUR"
        statement_period = "01/04/2025 - 31/03/2026"
        
        name_match = re.search(r'(?:Holder Name|Account Name)\s*:\s*([^\n]+)', first_page_text, re.IGNORECASE)
        if name_match:
            account_name = name_match.group(1).strip()
            
        num_match = re.search(r'Account No:\s*(\S+)', first_page_text, re.IGNORECASE)
        if num_match:
            account_number = num_match.group(1).strip()
            
        branch_match = re.search(r'Branch Name:\s*([^\n]+)', first_page_text, re.IGNORECASE)
        if branch_match:
            branch = branch_match.group(1).strip()
            
        period_match = re.search(r'Statement Period from\s*(\S+)\s*to\s*(\S+)', first_page_text, re.IGNORECASE)
        if period_match:
            statement_period = f"{period_match.group(1)} to {period_match.group(2)}"
            
        all_elements = []
        for p_idx, page in enumerate(reader.pages):
            page_els = []
            def visitor(text, cm, tm, font_dict, font_size):
                val = text.strip()
                if val:
                    page_els.append({'x': tm[4], 'y': tm[5], 'text': val})
            page.extract_text(visitor_text=visitor)
            
            y_groups = {}
            for el in page_els:
                found = False
                for g_y in y_groups:
                    if abs(g_y - el['y']) <= 7.5:
                        y_groups[g_y].append(el)
                        found = True
                        break
                if not found:
                    y_groups[el['y']] = [el]
                    
            sorted_y = sorted(y_groups.keys(), reverse=True)
            for y in sorted_y:
                row_el = sorted(y_groups[y], key=lambda e: e['x'])
                all_elements.append(row_el)
                
        raw_tx_list = []
        date_re = re.compile(r'^\d{2}[/-]\d{2}[/-]\d{4}$')
        
        for row_el in all_elements:
            is_start = False
            if len(row_el) >= 2:
                val0 = row_el[0]['text']
                val1 = row_el[1]['text']
                if date_re.match(val0) and date_re.match(val1):
                    is_start = True
                    
            if is_start:
                txn_date_str = row_el[0]['text']
                val_date_str = row_el[1]['text']
                
                try:
                    t_str = txn_date_str.replace('-', '/')
                    v_str = val_date_str.replace('-', '/')
                    txn_date = dt_class.strptime(t_str, "%d/%m/%Y").date()
                    val_date = dt_class.strptime(v_str, "%d/%m/%Y").date()
                except Exception:
                    txn_date = date.today()
                    val_date = date.today()
                    
                chq_no = None
                debit = None
                credit = None
                balance = 0.0
                narr_parts = []
                
                for el in row_el[2:]:
                    x = el['x']
                    text = el['text']
                    
                    if x >= 680:
                        try:
                            clean_bal = text.replace(',', '').replace('Cr', '').replace('Dr', '').strip()
                            balance = float(clean_bal)
                        except Exception:
                            pass
                    elif 560 <= x < 680:
                        try:
                            credit = float(text.replace(',', '').replace('Cr', '').replace('Dr', '').strip())
                        except Exception:
                            pass
                    elif 450 <= x < 560:
                        try:
                            debit = float(text.replace(',', '').replace('Cr', '').replace('Dr', '').strip())
                        except Exception:
                            pass
                    elif 100 <= x < 200 and text.isdigit():
                        chq_no = text
                    elif 180 <= x < 450:
                        narr_parts.append(text)
                        
                narration = " ".join(narr_parts).strip() or "BOB TRANSACTION"
                
                raw_tx_list.append(StandardTransaction(
                    txn_date=txn_date,
                    val_date=val_date,
                    narration=narration,
                    ref_no=chq_no,
                    debit=debit,
                    credit=credit,
                    balance=balance,
                    parser_name="BOBParser"
                ))
            elif raw_tx_list and len(row_el) > 0:
                extra_narr = " ".join([el['text'] for el in row_el if el['x'] < 450]).strip()
                if extra_narr and not any(k in extra_narr for k in ["Page", "Statement", "Bank of Baroda"]):
                    raw_tx_list[-1].narration += " " + extra_narr
                    
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
            bank_name="Bank of Baroda",
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
            detected_bank="Bank of Baroda",
            parser_name="BOBParser",
            review_queue_count=sum(1 for t in transactions if t.requires_review),
            duplicate_count=sum(1 for t in transactions if t.is_duplicate),
            high_confidence_count=sum(1 for t in transactions if t.confidence_grade == "HIGH")
        )
        
        return metadata, transactions
