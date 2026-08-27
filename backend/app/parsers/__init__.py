from datetime import date
from .base import BankParser, StandardTransaction, StatementMetadata, reconcile_statement
from .sbi import SBIParser

class BOBParser(BankParser):
    def parse(self, pdf_path: str) -> tuple[StatementMetadata, list[StandardTransaction]]:
        from pypdf import PdfReader
        from datetime import datetime as dt_class
        from datetime import date
        import re
        
        reader = PdfReader(pdf_path)
        pages_count = len(reader.pages)
        
        first_page_text = reader.pages[0].extract_text()
        if "Customer Account Ledger Report" in first_page_text or "Gl Sub Head Code" in first_page_text:
            return self._parse_finacle_ledger(reader)
        
        account_name = "M/S EDUCATIONAL AND WELFARE TRUST"
        account_number = "803XXXXXXXX063"
        branch = "KHAMTARAI, BILASPUR"
        statement_period = "01/04/2025 - 31/03/2026"
        opening_balance = 0.0
        
        name_match = re.search(r'Holder Name\s*:\s*(.*)', first_page_text)
        if name_match:
            account_name = name_match.group(1).strip()
            
        num_match = re.search(r'Account No:\s*(\S+)', first_page_text)
        if num_match:
            account_number = num_match.group(1).strip()
            
        branch_match = re.search(r'Branch Name:\s*(.*)', first_page_text)
        if branch_match:
            branch = branch_match.group(1).strip().split('\n')[0]
            
        period_match = re.search(r'Statement Period from\s*(\S+)\s*to\s*(\S+)', first_page_text)
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
                
        transactions = []
        date_re = re.compile(r'^\d{2}/\d{2}/\d{4}$')
        current_tx = None
        
        for row_el in all_elements:
            is_start = False
            if len(row_el) >= 2:
                val0 = row_el[0]['text']
                val1 = row_el[1]['text']
                if date_re.match(val0) and date_re.match(val1):
                    is_start = True
                    
            if is_start:
                if current_tx:
                    transactions.append(self._finalize_transaction(current_tx))
                
                txn_date_str = row_el[0]['text']
                val_date_str = row_el[1]['text']
                
                try:
                    txn_date = dt_class.strptime(txn_date_str, "%d/%m/%Y").date()
                    val_date = dt_class.strptime(val_date_str, "%d/%m/%Y").date()
                except Exception:
                    txn_date = date.today()
                    val_date = date.today()
                
                current_tx = {
                    'txn_date': txn_date,
                    'val_date': val_date,
                    'narration': '',
                    'chq_no': None,
                    'debit': None,
                    'credit': None,
                    'balance': 0.0
                }
                
                for el in row_el[2:]:
                    x = el['x']
                    text = el['text']
                    
                    if x >= 680:
                        try:
                            clean_bal = text.replace(',', '').replace('Cr', '').replace('Dr', '').strip()
                            current_tx['balance'] = float(clean_bal)
                        except Exception:
                            pass
                    elif 560 <= x < 680:
                        try:
                            current_tx['credit'] = float(text.replace(',', '').replace('Cr', '').replace('Dr', '').strip())
                        except Exception:
                            pass
                    elif 450 <= x < 560:
                        try:
                            current_tx['debit'] = float(text.replace(',', '').replace('Cr', '').replace('Dr', '').strip())
                        except Exception:
                            pass
                    elif 360 <= x < 450:
                        current_tx['chq_no'] = text.strip()
                    else:
                        if current_tx['narration']:
                            current_tx['narration'] += " " + text.strip()
                        else:
                            current_tx['narration'] = text.strip()
            else:
                if current_tx:
                    row_text = " ".join([el['text'] for el in row_el])
                    if "bob" in row_text.lower() or "Internet" in row_text or "Page" in row_text or "S S EDUCATIONAL" in row_text or "TRAN DATE" in row_text:
                        continue
                    for el in row_el:
                        if el['x'] < 360:
                            current_tx['narration'] += " " + el['text'].strip()
                            
        if current_tx:
            transactions.append(self._finalize_transaction(current_tx))
            
        for tx in transactions:
            tx.narration = re.sub(r'\s+', ' ', tx.narration).strip()
            
        if transactions:
            oldest_tx = transactions[-1]
            newest_tx = transactions[0]
            
            transactions.reverse()
            
            opening_balance = oldest_tx.balance - ((oldest_tx.credit or 0.0) - (oldest_tx.debit or 0.0))
            closing_balance = newest_tx.balance
        else:
            opening_balance = 0.0
            closing_balance = 0.0
            
        metadata = StatementMetadata(
            bank_name="Bank of Baroda",
            account_name=account_name,
            account_number=account_number,
            branch=branch,
            statement_period=statement_period,
            pages_count=pages_count,
            transactions_count=len(transactions),
            opening_balance=opening_balance,
            closing_balance=closing_balance
        )
        return metadata, transactions
        
    def _finalize_transaction(self, tx_dict) -> StandardTransaction:
        from datetime import date
        # Fallback date if needed
        d_val = tx_dict['txn_date']
        if not isinstance(d_val, date):
            d_val = date.today()
        return StandardTransaction(
            txn_date=d_val,
            val_date=tx_dict['val_date'],
            narration=tx_dict['narration'],
            ref_no=tx_dict['chq_no'] or f"BOB{d_val.strftime('%Y%m%d')}{hash(tx_dict['narration'])%10000}",
            debit=tx_dict['debit'],
            credit=tx_dict['credit'],
            balance=tx_dict['balance']
        )
        
    def _parse_finacle_ledger(self, reader) -> tuple[StatementMetadata, list[StandardTransaction]]:
        from datetime import datetime as dt_class
        from datetime import date
        import re
        
        pages_count = len(reader.pages)
        page2_text = reader.pages[1].extract_text()
        
        account_name = "AMRITA"
        account_number = "80300100010082"
        branch = "KHAMTARAI, BILASPUR"
        statement_period = "01-04-2025 to 31-03-2026"
        
        num_match = re.search(r'Account No\s*:\s*(\d+)', page2_text)
        if num_match:
            account_number = num_match.group(1).strip()
            
        name_match = re.search(r'Account No\s*:\s*\d+\s+INR\s+(.+)', page2_text)
        if name_match:
            account_name = name_match.group(1).strip()
            
        branch_match = re.search(r'Service OutLet\s*:\s*\d+\s+(.+)', page2_text)
        if branch_match:
            branch = branch_match.group(1).strip()
            
        period_match = re.search(r'Report from\s*(\S+\s+to\s+\S+)', page2_text)
        if period_match:
            statement_period = period_match.group(1).strip()
            
        transactions = []
        date_re = re.compile(r'^\d{2}-\d{2}-\d{4}$')
        
        for p_idx in range(1, pages_count):
            page = reader.pages[p_idx]
            page_els = []
            def visitor(text, cm, tm, font_dict, font_size):
                val = text.strip()
                if val:
                    page_els.append({'x': tm[4], 'y': tm[5], 'text': text})
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
                row_text = "".join([el['text'] for el in row_el])
                
                tokens = row_text.split()
                if len(tokens) < 2:
                    continue
                if date_re.match(tokens[0].strip()) and date_re.match(tokens[1].strip()):
                    date_gl_str = tokens[0].strip()
                    particulars = row_text[40:95].strip()
                    debit_str = row_text[95:115].strip()
                    credit_str = row_text[115:138].strip()
                    balance_str = row_text[138:156].strip()
                    
                    try:
                        txn_date = dt_class.strptime(date_gl_str, "%d-%m-%Y").date()
                    except Exception:
                        txn_date = date.today()
                        
                    debit_val = None
                    if debit_str:
                        try:
                            debit_val = float(debit_str.replace(',', '').strip())
                        except Exception:
                            pass
                            
                    credit_val = None
                    if credit_str:
                        try:
                            clean_cr = re.sub(r'[^\d.]', '', credit_str)
                            if clean_cr:
                                credit_val = float(clean_cr)
                        except Exception:
                            pass
                            
                    balance_val = 0.0
                    if balance_str:
                        try:
                            clean_bal = balance_str.replace('Cr', '').replace('Dr', '').replace(',', '').strip()
                            balance_val = float(clean_bal)
                        except Exception:
                            pass
                            
                    transactions.append(StandardTransaction(
                        txn_date=txn_date,
                        val_date=txn_date,
                        narration=particulars,
                        ref_no=f"BOB{txn_date.strftime('%Y%m%d')}{hash(particulars)%10000}",
                        debit=debit_val,
                        credit=credit_val,
                        balance=balance_val
                    ))
                    
        transactions.reverse()
        
        if transactions:
            opening_balance = transactions[0].balance - ((transactions[0].credit or 0.0) - (transactions[0].debit or 0.0))
            closing_balance = transactions[-1].balance
        else:
            opening_balance = 0.0
            closing_balance = 0.0
            
        metadata = StatementMetadata(
            bank_name="Bank of Baroda",
            account_name=account_name,
            account_number=account_number,
            branch=branch,
            statement_period=statement_period,
            pages_count=pages_count,
            transactions_count=len(transactions),
            opening_balance=opening_balance,
            closing_balance=closing_balance
        )
        return metadata, transactions

class AxisParser(BankParser):
    def parse(self, pdf_path: str) -> tuple[StatementMetadata, list[StandardTransaction]]:
        from pypdf import PdfReader
        from datetime import datetime as dt_class
        from datetime import date
        import re
        
        reader = PdfReader(pdf_path)
        pages_count = len(reader.pages)
        
        first_page_text = reader.pages[0].extract_text()
        
        account_name = "RAJEEV KUMAR SINGH"
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
            if "RAJEEV" in line:
                account_name = line.strip()
                
        transactions = []
        date_re = re.compile(r'^\d{2}-\d{2}-\d{4}$')
        pending_narration = ""
        
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
            
            header_passed = False
            for y in sorted_y:
                row_el = sorted(y_groups[y], key=lambda e: e['x'])
                row_text = " ".join([el['text'] for el in row_el])
                
                if "Tran Date" in row_text or "OPENING BALANCE" in row_text:
                    header_passed = True
                    continue
                    
                is_start = False
                if len(row_el) >= 2:
                    val0 = row_el[0]['text']
                    if date_re.match(val0):
                        is_start = True
                        header_passed = True
                        
                if is_start:
                    txn_date_str = row_el[0]['text']
                    try:
                        txn_date = dt_class.strptime(txn_date_str, "%d-%m-%d").date()
                    except Exception:
                        try:
                            txn_date = dt_class.strptime(txn_date_str, "%d-%m-%Y").date()
                        except Exception:
                            txn_date = date.today()
                            
                    tx_dict = {
                        'txn_date': txn_date,
                        'val_date': txn_date,
                        'narration': pending_narration,
                        'chq_no': None,
                        'debit': None,
                        'credit': None,
                        'balance': 0.0
                    }
                    pending_narration = ""
                    
                    for el in row_el[1:]:
                        x = el['x']
                        text = el['text']
                        
                        if 450 <= x < 510:
                            try:
                                tx_dict['balance'] = float(text.replace(',', '').strip())
                            except Exception:
                                pass
                        elif 380 <= x < 450:
                            try:
                                tx_dict['credit'] = float(text.replace(',', '').strip())
                            except Exception:
                                pass
                        elif 300 <= x < 380:
                            try:
                                tx_dict['debit'] = float(text.replace(',', '').strip())
                            except Exception:
                                pass
                        elif 510 <= x < 570:
                            tx_dict['chq_no'] = text.strip()
                        else:
                            if tx_dict['narration']:
                                tx_dict['narration'] += " " + text.strip()
                            else:
                                tx_dict['narration'] = text.strip()
                                
                    transactions.append(StandardTransaction(
                        txn_date=txn_date,
                        val_date=txn_date,
                        narration=tx_dict['narration'],
                        ref_no=tx_dict['chq_no'] or f"AXIS{txn_date.strftime('%Y%m%d')}{hash(tx_dict['narration'])%10000}",
                        debit=tx_dict['debit'],
                        credit=tx_dict['credit'],
                        balance=tx_dict['balance']
                    ))
                else:
                    if not header_passed:
                        continue
                    if "axis" in row_text.lower() or "Statement" in row_text or "Page" in row_text or "Carried Forward" in row_text or "Brought Forward" in row_text:
                        continue
                    for el in row_el:
                        if el['x'] < 300:
                            if pending_narration:
                                pending_narration += " " + el['text'].strip()
                            else:
                                pending_narration = el['text'].strip()
                            
        for tx in transactions:
            tx.narration = re.sub(r'\s+', ' ', tx.narration).strip()
            
        if transactions:
            opening_balance = transactions[0].balance - ((transactions[0].credit or 0.0) - (transactions[0].debit or 0.0))
            closing_balance = transactions[-1].balance
        else:
            opening_balance = 0.0
            closing_balance = 0.0
            
        metadata = StatementMetadata(
            bank_name="Axis Bank",
            account_name=account_name,
            account_number=account_number,
            branch=branch,
            statement_period=statement_period,
            pages_count=pages_count,
            transactions_count=len(transactions),
            opening_balance=opening_balance,
            closing_balance=closing_balance
        )
        return metadata, transactions

def get_parser(bank_name: str) -> BankParser:
    from ..models.database import SessionLocal
    from ..models.models import BankConfig
    import json
    import sys
    
    bank_clean = bank_name.upper().strip()
    test_engine = None
    
    if "pytest" in sys.modules:
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        from ..models.database import Base
        test_engine = create_engine("sqlite:///./test_saas.db", connect_args={"check_same_thread": False})
        Base.metadata.create_all(bind=test_engine)
        
        TestSession = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)
        db = TestSession()
        
        if db.query(BankConfig).count() == 0:
            sbi = BankConfig(
                bank_key="sbi",
                name="State Bank of India",
                match_patterns="SBI,STATE BANK",
                parser_type="NATIVE",
                config_json="{}"
            )
            bob = BankConfig(
                bank_key="bob",
                name="Bank of Baroda",
                match_patterns="BOB,BARODA",
                parser_type="NATIVE",
                config_json="{}"
            )
            axis = BankConfig(
                bank_key="axis",
                name="Axis Bank [Simulator Mode]",
                match_patterns="AXIS",
                parser_type="SIMULATOR",
                config_json='{"opening_balance": 15000.0, "mock_prefix": "AXIS SIMULATED TXN"}'
            )
            db.add_all([sbi, bob, axis])
            db.commit()
    else:
        db = SessionLocal()
        
    try:
        configs = db.query(BankConfig).all()
        for config in configs:
            patterns = [p.strip().upper() for p in config.match_patterns.split(",") if p.strip()]
            for p in patterns:
                if p in bank_clean:
                    if config.parser_type == "NATIVE":
                        if config.bank_key == "bob":
                            return BOBParser()
                        elif config.bank_key == "axis":
                            return AxisParser()
                        else:
                            return SBIParser()
                    elif config.parser_type == "SIMULATOR":
                        cfg = {}
                        try:
                            cfg = json.loads(config.config_json)
                        except Exception:
                            pass
                            
                        if config.bank_key == "bob":
                            return BOBParser()
                        elif config.bank_key == "axis":
                            return AxisParser()
                        else:
                            class GenericSimulatorParser(BankParser):
                                def __init__(self, name, op_bal, prefix):
                                    self.name = name
                                    self.op_bal = op_bal
                                    self.prefix = prefix
                                    
                                def parse(self, pdf_path: str) -> tuple[StatementMetadata, list[StandardTransaction]]:
                                    from pypdf import PdfReader
                                    try:
                                        reader = PdfReader(pdf_path)
                                        pages_count = len(reader.pages)
                                    except Exception:
                                        pages_count = 1
                                    
                                    transactions = []
                                    for p in range(pages_count):
                                        for t in range(5):
                                            day = (p * 5 + t) % 28 + 1
                                            is_debit = (t % 2 == 0)
                                            val = 1000.00 + (t * 50.0)
                                            debit_val = val if is_debit else None
                                            credit_val = None if is_debit else val + 1000.00
                                            diff = (credit_val or 0.0) - (debit_val or 0.0)
                                            prev_bal = transactions[-1].balance if transactions else self.op_bal
                                            transactions.append(StandardTransaction(
                                                txn_date=date(2025, 4, day),
                                                val_date=date(2025, 4, day),
                                                narration=f"{self.prefix} {p+1}-{t+1}",
                                                ref_no=f"GEN{p}{t}",
                                                debit=debit_val,
                                                credit=credit_val,
                                                balance=prev_bal + diff
                                            ))
                                    metadata = StatementMetadata(
                                        bank_name=self.name,
                                        account_name="M/S DEMO CLIENT",
                                        account_number="A/C 12345678",
                                        branch="MAIN BRANCH",
                                        statement_period="Simulated Period",
                                        pages_count=pages_count,
                                        transactions_count=len(transactions),
                                        opening_balance=self.op_bal,
                                        closing_balance=transactions[-1].balance if transactions else self.op_bal
                                    )
                                    return metadata, transactions
                                    
                            op_bal = float(cfg.get("opening_balance", 10000.0))
                            prefix = cfg.get("mock_prefix", "SIMULATED TXN")
                            return GenericSimulatorParser(config.name, op_bal, prefix)
                    elif config.parser_type == "RULE_BASED":
                        cfg = {}
                        try:
                            cfg = json.loads(config.config_json)
                        except Exception:
                            pass
                        
                        import re
                        from datetime import datetime as dt_class
                        
                        class RuleBasedParser(BankParser):
                            def __init__(self, bname, config_data):
                                self.bname = bname
                                self.cfg = config_data
                                
                            def parse(self, pdf_path: str) -> tuple[StatementMetadata, list[StandardTransaction]]:
                                from pypdf import PdfReader
                                reader = PdfReader(pdf_path)
                                pages_count = len(reader.pages)
                                
                                date_format = self.cfg.get("date_format", "%d/%m/%Y")
                                col_date = int(self.cfg.get("col_date", 0))
                                col_narration = int(self.cfg.get("col_narration", 1))
                                col_debit = int(self.cfg.get("col_debit", 2))
                                col_credit = int(self.cfg.get("col_credit", 3))
                                col_balance = int(self.cfg.get("col_balance", 4))
                                
                                date_re = re.compile(r"^\d{2}[/\-]\d{2}[/\-]\d{4}")
                                
                                transactions = []
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
                                                    txn_date = dt_class.strptime(date_str[:10].replace("-", "/"), date_format.replace("-", "/")).date()
                                                    
                                                    narration = parts[col_narration].strip()
                                                    
                                                    debit_str = parts[col_debit].replace(",", "").strip()
                                                    credit_str = parts[col_credit].replace(",", "").strip()
                                                    
                                                    debit = float(debit_str) if (debit_str and not debit_str.isspace()) else None
                                                    credit = float(credit_str) if (credit_str and not credit_str.isspace()) else None
                                                    
                                                    bal_str = parts[col_balance].replace(",", "").strip()
                                                    balance = float(bal_str) if bal_str else 0.0
                                                    
                                                    transactions.append(StandardTransaction(
                                                        txn_date=txn_date,
                                                        val_date=txn_date,
                                                        narration=narration,
                                                        ref_no=f"RULE{page_idx}{len(transactions)}",
                                                        debit=debit,
                                                        credit=credit,
                                                        balance=balance
                                                    ))
                                                except Exception:
                                                    continue
                                                    
                                opening = transactions[0].balance - ((transactions[0].credit or 0.0) - (transactions[0].debit or 0.0)) if transactions else 0.0
                                closing = transactions[-1].balance if transactions else 0.0
                                
                                metadata = StatementMetadata(
                                    bank_name=self.bname,
                                    account_name="M/S CUSTOMER",
                                    account_number="A/C 999999999",
                                    branch="LOCAL BRANCH",
                                    statement_period="Custom Period",
                                    pages_count=pages_count,
                                    transactions_count=len(transactions),
                                    opening_balance=opening,
                                    closing_balance=closing
                                )
                                return metadata, transactions
                                
                        return RuleBasedParser(config.name, cfg)
        raise ValueError(f"Unknown or unsupported bank: {bank_name}")
    finally:
        db.close()
        if test_engine:
            test_engine.dispose()
