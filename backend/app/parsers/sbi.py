import re
from datetime import datetime, date
from pypdf import PdfReader
from typing import List, Tuple, Any
from .base import BankParser, StandardTransaction, StatementMetadata, reconcile_statement_and_transactions

class SBIParser(BankParser):
    def parse(self, pdf_path_or_bytes: Any) -> Tuple[StatementMetadata, List[StandardTransaction]]:
        reader = PdfReader(pdf_path_or_bytes)
        pages_count = len(reader.pages)
        
        # 1. Parse Metadata from the first page text
        first_page_text = reader.pages[0].extract_text()
        
        account_name = None
        account_number = None
        branch = None
        statement_period = None
        opening_balance = 0.0
        
        # Extract metadata fields supporting both styles
        name_match = re.search(r'(?:Account Name|Account Holder Name)\s*:?\s*([^\n]+)', first_page_text)
        if name_match:
            account_name = name_match.group(1).strip()
        else:
            for line in first_page_text.split('\n'):
                if line.startswith("Mr.") or line.startswith("M/S") or line.startswith("Mrs."):
                    account_name = line.strip()
                    break
                    
        num_match = re.search(r'(?:Account Number|Account No)\s*:?\s*(\d+)', first_page_text)
        if num_match:
            account_number = num_match.group(1).strip()
            
        branch_match = re.search(r'STATE BANK OF INDIA\s*\n\s*([^\n]+)', first_page_text, re.IGNORECASE)
        if branch_match:
            branch = branch_match.group(1).strip()
        else:
            branch_match = re.search(r'(?:Branch|Branch Code)\s*:?\s*([^\n]+)', first_page_text, re.IGNORECASE)
            if branch_match:
                branch = branch_match.group(1).strip()
                
        period_match = re.search(r'(?:Account Statement from|Statement From)\s*:?\s*(.*)', first_page_text, re.IGNORECASE)
        if period_match:
            statement_period = period_match.group(1).strip()
        else:
            period_match = re.search(r'from\s*(\S+\s+to\s+\S+)', first_page_text, re.IGNORECASE)
            if period_match:
                statement_period = period_match.group(1).strip()
                
        # 2. Extract and group all physical layout elements from PDF
        date_pat = re.compile(r'^\d{2}[/-]\d{2}[/-]\d{4}$')
        transactions: List[StandardTransaction] = []
        current_tx = None
        
        all_elements = []
        for p_idx, page in enumerate(reader.pages):
            page_els = []
            def visitor(text, cm, tm, font_dict, font_size):
                val = text.strip()
                if val:
                    page_els.append({'x': tm[4], 'y': tm[5], 'text': val, 'page': p_idx+1})
            page.extract_text(visitor_text=visitor)
            
            # Group elements on the same row (y-coordinate within tolerance of 2.5 points)
            y_groups = {}
            for el in page_els:
                found = False
                for g_y in y_groups:
                    if abs(g_y - el['y']) <= 2.5:
                        y_groups[g_y].append(el)
                        found = True
                        break
                if not found:
                    y_groups[el['y']] = [el]
                    
            # Sort y-coordinate descending
            sorted_y = sorted(y_groups.keys(), reverse=True)
            for y in sorted_y:
                row_el = sorted(y_groups[y], key=lambda e: e['x'])
                all_elements.append(row_el)
                
        # 3. Iterate through rows to reconstruct transactions
        for row_el in all_elements:
            # Check if this row marks the start of a transaction
            is_start = False
            if len(row_el) >= 2:
                val0 = row_el[0]['text']
                val1 = row_el[1]['text']
                if date_pat.match(val0) and date_pat.match(val1):
                    is_start = True
                    
            if is_start:
                # Save previous transaction
                if current_tx:
                    transactions.append(self._finalize_transaction(current_tx))
                
                # Start new transaction row
                current_tx = {
                    'txn_date': row_el[0]['text'],
                    'val_date': row_el[1]['text'],
                    'desc_lines': [],
                    'ref_lines': [],
                    'branch_code': None,
                    'amount_val': None,
                    'balance_val': None,
                    'is_debit': False,
                    'is_credit': False,
                    'page': row_el[0].get('page', 1)
                }
                remaining = row_el[2:]
            else:
                remaining = row_el
                
            if current_tx is not None:
                has_end_marker = any('END OF STATEMENT' in t['text'].upper() or 'CLOSING BALANCE' in t['text'].upper() for t in remaining)
                if has_end_marker:
                    transactions.append(self._finalize_transaction(current_tx))
                    current_tx = None
                    continue
                    
                if not is_start:
                    has_balance_token = any(re.search(r'[\d,]+\.\d{2}(?:CR|DR)$', t['text'], re.IGNORECASE) for t in remaining)
                    if has_balance_token:
                        continue
                        
                has_header_text = any(t['text'] in ['Description', 'Txn Date', 'Balance', 'Debit', 'Credit', 'Branch', 'Code', 'No.'] for t in remaining)
                has_summary_text = any('Opening Balance' in t['text'] or 'Statement from' in t['text'] or 'computer generated' in t['text'] or 'Page no.' in t['text'] for t in remaining)
                
                if not (has_header_text or has_summary_text):
                    for el in remaining:
                        x = el['text']
                        x_coord = el['x']
                        
                        # Categorize elements based on x-coordinates
                        is_valid_amount = x.strip() and x.strip() != '-'
                        
                        if x_coord >= 490:
                            current_tx['balance_val'] = x
                        elif 350 <= x_coord < 415:
                            if is_valid_amount:
                                current_tx['amount_val'] = x
                                current_tx['is_debit'] = True
                        elif 415 <= x_coord < 490:
                            if is_valid_amount:
                                current_tx['amount_val'] = x
                                current_tx['is_credit'] = True
                        elif 300 <= x_coord < 350:
                            current_tx['branch_code'] = x
                        elif 210 <= x_coord < 300:
                            current_tx['ref_lines'].append(x)
                        elif 130 <= x_coord < 210:
                            current_tx['desc_lines'].append(x)
                            
        # Save last transaction
        if current_tx:
            transactions.append(self._finalize_transaction(current_tx))
            
        if transactions:
            opening_balance = transactions[0].balance - ((transactions[0].credit or 0.0) - (transactions[0].debit or 0.0))
            closing_balance = transactions[-1].balance
        else:
            opening_balance = 0.0
            closing_balance = 0.0
            
        is_reconciled, discrepancy, transactions = reconcile_statement_and_transactions(
            opening_balance=opening_balance,
            transactions=transactions,
            closing_balance=closing_balance
        )
        
        metadata = StatementMetadata(
            bank_name="State Bank of India",
            account_name=account_name,
            account_number=account_number,
            branch=branch,
            statement_period=statement_period,
            opening_balance=opening_balance,
            closing_balance=closing_balance,
            pages_count=pages_count,
            transactions_count=len(transactions),
            is_reconciled=is_reconciled,
            reconciliation_discrepancy=discrepancy,
            detected_bank="State Bank of India",
            parser_name="SBIParser",
            review_queue_count=sum(1 for t in transactions if t.requires_review),
            duplicate_count=sum(1 for t in transactions if t.is_duplicate),
            high_confidence_count=sum(1 for t in transactions if t.confidence_grade == "HIGH")
        )
        
        return metadata, transactions
        
    def _finalize_transaction(self, tx: dict) -> StandardTransaction:
        desc_narr = ''.join(tx['desc_lines'])
        ref_narr = '\n'.join(tx['ref_lines'])
        
        if ref_narr:
            narration = desc_narr + ' & ' + ref_narr
        else:
            narration = desc_narr
            
        txn_date_str = tx['txn_date']
        for fmt in ["%d-%m-%Y", "%d/%m/%Y"]:
            try:
                txn_date_obj = datetime.strptime(txn_date_str, fmt).date()
                break
            except Exception:
                continue
        else:
            txn_date_obj = date.today()
            
        val_date_str = tx['val_date']
        for fmt in ["%d-%m-%Y", "%d/%m/%Y"]:
            try:
                val_date_obj = datetime.strptime(val_date_str, fmt).date()
                break
            except Exception:
                continue
        else:
            val_date_obj = date.today()
            
        # Clean amount string safely
        amount_clean = tx['amount_val'].replace(',', '').strip() if tx['amount_val'] else '0'
        if not amount_clean or amount_clean == '-' or amount_clean.isspace():
            amount = 0.0
        else:
            try:
                amount = float(amount_clean)
            except ValueError:
                amount = 0.0
        debit = amount if tx['is_debit'] else None
        credit = amount if tx['is_credit'] else None
        
        # Clean balance string safely
        balance_clean = tx['balance_val'].replace(',', '').replace('CR', '').replace('DR', '').replace('Cr', '').replace('Dr', '').strip() if tx['balance_val'] else '0'
        if not balance_clean or balance_clean == '-' or balance_clean.isspace():
            balance = 0.0
        else:
            try:
                balance = float(balance_clean)
            except ValueError:
                balance = 0.0
        
        return StandardTransaction(
            txn_date=txn_date_obj,
            val_date=val_date_obj,
            narration=narration,
            ref_no=ref_narr if ref_narr else None,
            debit=debit,
            credit=credit,
            balance=balance,
            branch_code=tx['branch_code'],
            page_number=tx.get('page', 1),
            parser_name="SBIParser"
        )
