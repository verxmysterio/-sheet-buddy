from datetime import date
from pypdf import PdfReader
from typing import List, Tuple, Any
from .base import BankParser, StandardTransaction, StatementMetadata, reconcile_statement_and_transactions

class GenericSimulatorParser(BankParser):
    def __init__(self, name: str, op_bal: float = 10000.0, prefix: str = "SIMULATED TXN"):
        self.name = name
        self.op_bal = op_bal
        self.prefix = prefix
        
    def parse(self, pdf_path_or_bytes: Any) -> Tuple[StatementMetadata, List[StandardTransaction]]:
        try:
            reader = PdfReader(pdf_path_or_bytes)
            pages_count = len(reader.pages)
        except Exception:
            pages_count = 1
            
        raw_tx_list = []
        running = self.op_bal
        
        for p in range(pages_count):
            for t in range(5):
                day = (p * 5 + t) % 28 + 1
                is_debit = (t % 2 == 0)
                val = 1000.00 + (t * 50.0)
                debit_val = val if is_debit else None
                credit_val = None if is_debit else val + 1000.00
                diff = (credit_val or 0.0) - (debit_val or 0.0)
                running += diff
                
                raw_tx_list.append(StandardTransaction(
                    txn_date=date(2025, 4, day),
                    val_date=date(2025, 4, day),
                    narration=f"{self.prefix} {p+1}-{t+1} UPI/12345678{p}{t}",
                    ref_no=f"GEN{p}{t}",
                    debit=debit_val,
                    credit=credit_val,
                    balance=running,
                    page_number=p + 1,
                    parser_name="GenericSimulatorParser"
                ))
                
        is_reconciled, discrepancy, transactions = reconcile_statement_and_transactions(
            opening_balance=self.op_bal,
            transactions=raw_tx_list,
            closing_balance=running
        )
        
        metadata = StatementMetadata(
            bank_name=self.name,
            account_name="M/S DEMO CLIENT",
            account_number="A/C 1234567890",
            branch="MAIN BRANCH",
            statement_period="Simulated Period 2025-2026",
            opening_balance=self.op_bal,
            closing_balance=running,
            total_debits=sum(t.debit or 0.0 for t in transactions),
            total_credits=sum(t.credit or 0.0 for t in transactions),
            pages_count=pages_count,
            transactions_count=len(transactions),
            is_reconciled=is_reconciled,
            reconciliation_discrepancy=discrepancy,
            detected_bank=self.name,
            parser_name="GenericSimulatorParser",
            review_queue_count=sum(1 for t in transactions if t.requires_review),
            duplicate_count=sum(1 for t in transactions if t.is_duplicate),
            high_confidence_count=sum(1 for t in transactions if t.confidence_grade == "HIGH")
        )
        
        return metadata, transactions
