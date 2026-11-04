import io
import json
import uuid
import hashlib
import logging
import os
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status, Request
from fastapi.responses import StreamingResponse, Response
from sqlalchemy.orm import Session
from typing import List, Optional, Dict, Any
from datetime import datetime, date

from ..core.config import settings
from ..models.database import get_db
from ..models.models import User, Conversion, WalletTransaction, LedgerRule, Client, AuditLog
from ..parsers import get_parser, reconcile_statement_and_transactions
from ..parsers.base import StandardTransaction, StatementMetadata
from ..services.document_engine import DocumentEngine
from ..services.bank_detector import AutomaticBankDetector
from ..services.ledger_engine import LedgerRuleEngine
from ..services.xml_generator import generate_tally_xml, validate_tally_xml
from ..services.excel_exporter import export_transactions_to_excel
from ..schemas.schemas import (
    ConversionResponse, 
    LedgerRuleCreate, 
    LedgerRuleResponse, 
    ClientCreate, 
    ClientUpdate,
    ClientResponse,
    SaveCloudXmlRequest
)
from .deps import get_current_user

logger = logging.getLogger("sheetbuddy.convert")
router = APIRouter(prefix="/convert", tags=["Conversion"])

# In-memory cache for previewed statements during conversion flow
IN_MEMORY_PREVIEW_CACHE: Dict[str, Dict[str, Any]] = {}

def calculate_file_hash(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()

@router.get("/banks", response_model=List[dict])
def get_supported_banks(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    from ..models.models import BankConfig
    configs = db.query(BankConfig).all()
    native_list = [
        {"bank_key": "auto", "name": "✨ Auto-Detect Bank (Recommended)", "parser_type": "AUTO"},
        {"bank_key": "sbi", "name": "State Bank of India (SBI)", "parser_type": "NATIVE"},
        {"bank_key": "hdfc", "name": "HDFC Bank", "parser_type": "NATIVE"},
        {"bank_key": "icici", "name": "ICICI Bank", "parser_type": "NATIVE"},
        {"bank_key": "axis", "name": "Axis Bank", "parser_type": "NATIVE"},
        {"bank_key": "bob", "name": "Bank of Baroda (BOB)", "parser_type": "NATIVE"},
        {"bank_key": "pnb", "name": "Punjab National Bank (PNB)", "parser_type": "NATIVE"},
        {"bank_key": "kotak", "name": "Kotak Mahindra Bank", "parser_type": "NATIVE"},
        {"bank_key": "rule_based", "name": "Generic Rule-Based Parser", "parser_type": "RULE_BASED"},
        {"bank_key": "simulator", "name": "Simulator Mock Statement", "parser_type": "SIMULATOR"}
    ]
    db_list = [{"bank_key": c.bank_key, "name": c.name, "parser_type": c.parser_type} for c in configs]
    keys = {item["bank_key"] for item in native_list}
    for item in db_list:
        if item["bank_key"] not in keys:
            native_list.append(item)
    return native_list

@router.post("/upload", response_model=dict)
async def upload_statement(
    bank_name: str = Form("auto"),
    client_id: Optional[str] = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported file format. Please upload a PDF statement."
        )
        
    content = await file.read()
    if not content.startswith(b"%PDF"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The uploaded file is not a valid PDF document."
        )
        
    file_fingerprint = calculate_file_hash(content)
    
    # Check duplicate conversion
    existing_conversion = db.query(Conversion).filter(
        Conversion.user_id == current_user.id,
        Conversion.file_fingerprint == file_fingerprint,
        Conversion.status == "SUCCESS"
    ).first()
    is_duplicate_file = (existing_conversion is not None)
    
    # 2. In-Memory Document Inspection
    inspection = DocumentEngine.inspect(content)
    
    # 3. Automatic Bank Detection
    detection = AutomaticBankDetector.detect_bank_from_text(inspection.page_previews)
    is_auto = (
        not bank_name or
        str(bank_name).strip().lower() in ["auto", "none", "null", "autodetect", "auto-detect"] or
        "auto" in str(bank_name).strip().lower()
    )
    resolved_bank = detection.bank_name if is_auto else bank_name
    
    # 4. In-Memory Statement Parsing
    try:
        parser = get_parser(resolved_bank, db_session=db)
        pdf_stream = io.BytesIO(content)
        metadata, transactions = parser.parse(pdf_stream)
    except Exception as e:
        logger.warning(f"Parsing failed for {resolved_bank}: {e}")
        try:
            from ..parsers.rule_based import RuleBasedParser
            parser = RuleBasedParser(resolved_bank, {})
            metadata, transactions = parser.parse(io.BytesIO(content))
        except Exception as e2:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unable to parse statement with {resolved_bank}. Please check file quality or select a manual bank format."
            )
            
    # 5. Apply User's Custom Ledger Rules
    user_rules = db.query(LedgerRule).filter(
        LedgerRule.user_id == current_user.id,
        LedgerRule.is_active == True
    ).all()
    transactions = LedgerRuleEngine.apply_rules_to_transactions(transactions, user_rules)
    
    # 6. Format Structured Transactions for Review Queue & Preview
    all_transactions_dict = []
    review_issues_count = 0
    duplicate_rows_count = 0
    high_confidence_count = 0
    
    for tx in transactions:
        if tx.requires_review:
            review_issues_count += 1
        if tx.is_duplicate:
            duplicate_rows_count += 1
        if tx.confidence_grade == "HIGH":
            high_confidence_count += 1
            
        all_transactions_dict.append({
            "id": tx.id,
            "txn_date": tx.txn_date.strftime("%Y-%m-%d"),
            "val_date": tx.val_date.strftime("%Y-%m-%d") if tx.val_date else tx.txn_date.strftime("%Y-%m-%d"),
            "narration": tx.narration,
            "ref_no": tx.ref_no,
            "utr": tx.utr,
            "cheque_number": tx.cheque_number,
            "debit": tx.debit,
            "credit": tx.credit,
            "balance": tx.balance,
            "expected_balance": tx.expected_balance,
            "transaction_type": tx.transaction_type,
            "category": tx.category,
            "suggested_ledger": tx.suggested_ledger,
            "assigned_ledger": tx.assigned_ledger,
            "voucher_type": tx.voucher_type,
            "confidence_score": tx.confidence_score,
            "confidence_grade": tx.confidence_grade,
            "reconciliation_status": tx.reconciliation_status,
            "reconciliation_difference": tx.reconciliation_difference,
            "is_duplicate": tx.is_duplicate,
            "duplicate_reason": tx.duplicate_reason,
            "requires_review": tx.requires_review,
            "review_reasons": tx.review_reasons,
            "page_number": tx.page_number
        })
        
    temp_file_id = str(uuid.uuid4())
    
    # Cache parsed transactions in-memory for execute fallback
    IN_MEMORY_PREVIEW_CACHE[temp_file_id] = {
        "metadata": metadata,
        "transactions": transactions,
        "file_fingerprint": file_fingerprint,
        "pages_count": metadata.pages_count
    }
    
    return {
        "temp_file_id": temp_file_id,
        "file_fingerprint": file_fingerprint,
        "bank_name": metadata.bank_name,
        "detected_bank": detection.bank_name,
        "detection_confidence": detection.confidence,
        "detection_signals": detection.detection_signals,
        "format_name": detection.format_name,
        "document_type": inspection.document_type,
        "estimated_quality": inspection.estimated_quality,
        "account_name": metadata.account_name,
        "account_number": metadata.account_number,
        "branch": metadata.branch,
        "statement_period": metadata.statement_period,
        "pages_count": metadata.pages_count,
        "transactions_count": len(transactions),
        "opening_balance": metadata.opening_balance,
        "closing_balance": metadata.closing_balance,
        "total_debits": sum(t.debit or 0.0 for t in transactions),
        "total_credits": sum(t.credit or 0.0 for t in transactions),
        "reconciled": metadata.is_reconciled,
        "is_reconciled": metadata.is_reconciled,
        "reconciliation_discrepancy": metadata.reconciliation_discrepancy,
        "is_duplicate": is_duplicate_file,
        "review_queue_count": review_issues_count,
        "duplicate_count": duplicate_rows_count,
        "high_confidence_count": high_confidence_count,
        "transactions_preview": all_transactions_dict[:25],
        "all_transactions": all_transactions_dict
    }

@router.post("/upload-multiple", response_model=dict)
async def upload_multiple_statements(
    bank_name: str = Form("auto"),
    files: List[UploadFile] = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if not files:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No PDF files provided.")

    combined_txs = []
    total_pages = 0
    first_metadata = None
    last_metadata = None
    all_periods = []
    
    user_rules = db.query(LedgerRule).filter(
        LedgerRule.user_id == current_user.id,
        LedgerRule.is_active == True
    ).all()

    for f in files:
        content = await f.read()
        if not content.startswith(b"%PDF"):
            continue
            
        inspection = DocumentEngine.inspect(content)
        detection = AutomaticBankDetector.detect_bank_from_text(inspection.page_previews)
        is_auto = (
            not bank_name or
            str(bank_name).strip().lower() in ["auto", "none", "null", "autodetect", "auto-detect"] or
            "auto" in str(bank_name).strip().lower()
        )
        resolved_bank = detection.bank_name if (is_auto and detection and detection.bank_name) else (bank_name if not is_auto else "State Bank of India")

        try:
            parser = get_parser(resolved_bank, db_session=db)
            pdf_stream = io.BytesIO(content)
            metadata, txs = parser.parse(pdf_stream)
        except Exception:
            from ..parsers.rule_based import RuleBasedParser
            parser = RuleBasedParser(resolved_bank, {})
            metadata, txs = parser.parse(io.BytesIO(content))

        if not first_metadata:
            first_metadata = metadata
        last_metadata = metadata
        total_pages += metadata.pages_count
        if metadata.statement_period:
            all_periods.append(metadata.statement_period)

        txs = LedgerRuleEngine.apply_rules_to_transactions(txs, user_rules)
        for tx in txs:
            tx.source_file = f.filename
        combined_txs.extend(txs)

    combined_txs = detect_duplicate_transactions(combined_txs)

    all_transactions_dict = []
    review_issues_count = 0
    duplicate_rows_count = 0
    high_confidence_count = 0

    for tx in combined_txs:
        if tx.requires_review:
            review_issues_count += 1
        if tx.is_duplicate:
            duplicate_rows_count += 1
        if tx.confidence_grade == "HIGH":
            high_confidence_count += 1

        tx_dict = tx.to_dict() if hasattr(tx, "to_dict") else {
            "id": getattr(tx, "id", str(uuid.uuid4())),
            "txn_date": tx.txn_date.isoformat() if hasattr(tx.txn_date, "isoformat") else str(tx.txn_date),
            "val_date": tx.val_date.isoformat() if hasattr(tx.val_date, "isoformat") else str(tx.val_date),
            "narration": tx.narration,
            "ref_no": getattr(tx, "ref_no", None),
            "debit": tx.debit,
            "credit": tx.credit,
            "balance": tx.balance,
            "transaction_type": getattr(tx, "transaction_type", "DEBIT" if tx.debit else "CREDIT"),
            "category": getattr(tx, "category", "General"),
            "suggested_ledger": getattr(tx, "suggested_ledger", "Suspense Account"),
            "assigned_ledger": getattr(tx, "assigned_ledger", getattr(tx, "suggested_ledger", "Suspense Account")),
            "voucher_type": getattr(tx, "voucher_type", "Payment" if tx.debit else "Receipt"),
            "requires_review": getattr(tx, "requires_review", False),
            "is_duplicate": getattr(tx, "is_duplicate", False),
            "confidence_grade": getattr(tx, "confidence_grade", "MEDIUM"),
            "source_file": getattr(tx, "source_file", None)
        }
        all_transactions_dict.append(tx_dict)

    temp_id = str(uuid.uuid4())
    IN_MEMORY_PREVIEW_CACHE[temp_id] = {
        "metadata": first_metadata,
        "transactions": combined_txs,
        "pages_count": total_pages,
        "file_fingerprint": f"multi_{len(files)}_{temp_id[:8]}"
    }

    period_str = f"{all_periods[0]} to {all_periods[-1]}" if len(all_periods) > 1 else (first_metadata.statement_period if first_metadata else "Consolidated Statements")
    
    return {
        "temp_file_id": temp_id,
        "file_fingerprint": f"multi_{len(files)}_{temp_id[:8]}",
        "bank_name": first_metadata.bank_name if first_metadata else "Consolidated Bank Statements",
        "account_name": first_metadata.account_name if first_metadata else "Consolidated",
        "account_number": first_metadata.account_number if first_metadata else "Multiple Accounts",
        "branch": first_metadata.branch if first_metadata else "",
        "statement_period": period_str,
        "pages_count": total_pages,
        "transactions_count": len(combined_txs),
        "opening_balance": first_metadata.opening_balance if first_metadata else 0.0,
        "closing_balance": last_metadata.closing_balance if last_metadata else 0.0,
        "total_debits": sum(t.debit or 0.0 for t in combined_txs),
        "total_credits": sum(t.credit or 0.0 for t in combined_txs),
        "reconciled": True,
        "is_reconciled": True,
        "reconciliation_discrepancy": 0.0,
        "is_duplicate": False,
        "review_queue_count": review_issues_count,
        "duplicate_count": duplicate_rows_count,
        "high_confidence_count": high_confidence_count,
        "transactions_preview": all_transactions_dict[:25],
        "all_transactions": all_transactions_dict,
        "multi_file_count": len(files)
    }

@router.post("/execute")
async def execute_conversion(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    content_type = request.headers.get("content-type", "")
    if "application/json" in content_type:
        payload = await request.json()
    else:
        form_data = await request.form()
        payload = dict(form_data)
        
    temp_file_id = payload.get("temp_file_id")
    bank_name = payload.get("bank_name", "Bank Statement")
    tally_bank_ledger_name = payload.get("tally_bank_ledger_name", "").strip()
    counter_ledger_name = payload.get("counter_ledger_name", "Suspense Account")
    credit_voucher_type = payload.get("credit_voucher_type", "Receipt")
    debit_voucher_type = payload.get("debit_voucher_type", "Payment")
    transactions_raw = payload.get("transactions")
    if isinstance(transactions_raw, str):
        try:
            transactions_raw = json.loads(transactions_raw)
        except Exception:
            transactions_raw = None

    pages_count = int(payload.get("pages_count") or 0)
    file_fingerprint = payload.get("file_fingerprint")
    client_id = payload.get("client_id")
    edited_narrations = payload.get("edited_narrations")
    if isinstance(edited_narrations, str):
        try:
            edited_narrations = json.loads(edited_narrations)
        except Exception:
            edited_narrations = None
    
    if not tally_bank_ledger_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please specify your Tally Bank Ledger Name."
        )
        
    cached_entry = IN_MEMORY_PREVIEW_CACHE.get(temp_file_id, {})
    
    if not transactions_raw:
        if cached_entry and "transactions" in cached_entry:
            reconstructed_txs = list(cached_entry["transactions"])
            pages_count = pages_count or cached_entry.get("pages_count", 1)
            file_fingerprint = file_fingerprint or cached_entry.get("file_fingerprint", str(uuid.uuid4()))
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No transactions provided or session expired. Please upload the statement again."
            )
    else:
        reconstructed_txs = []
        for tx_dict in transactions_raw:
            try:
                if isinstance(tx_dict.get("txn_date"), str):
                    try:
                        t_date = date.fromisoformat(tx_dict["txn_date"])
                    except Exception:
                        from ..services.csv_tally_engine import parse_date_safely
                        clean_d = parse_date_safely(tx_dict["txn_date"])
                        t_date = date.fromisoformat(clean_d) if clean_d else date.today()
                elif isinstance(tx_dict.get("txn_date"), date):
                    t_date = tx_dict["txn_date"]
                else:
                    t_date = date.today()
            except Exception:
                t_date = date.today()
                
            v_date = t_date
            if tx_dict.get("val_date"):
                try:
                    if isinstance(tx_dict["val_date"], str):
                        v_date = date.fromisoformat(tx_dict["val_date"])
                    elif isinstance(tx_dict["val_date"], date):
                        v_date = tx_dict["val_date"]
                except Exception:
                    v_date = t_date

            bal_raw = tx_dict.get("balance")
            try:
                bal_flt = float(bal_raw) if bal_raw is not None else 0.0
            except Exception:
                bal_flt = 0.0

            reconstructed_txs.append(StandardTransaction(
                id=str(tx_dict.get("id") or uuid.uuid4()),
                txn_date=t_date,
                val_date=v_date,
                narration=str(tx_dict.get("narration") or "Bank Transaction"),
                ref_no=tx_dict.get("ref_no") or tx_dict.get("utr"),
                utr=tx_dict.get("utr"),
                cheque_number=tx_dict.get("cheque_number"),
                debit=float(tx_dict["debit"]) if tx_dict.get("debit") is not None else None,
                credit=float(tx_dict["credit"]) if tx_dict.get("credit") is not None else None,
                balance=bal_flt,
                transaction_type=tx_dict.get("transaction_type", "DEBIT"),
                assigned_ledger=tx_dict.get("assigned_ledger") or tx_dict.get("suggested_ledger") or counter_ledger_name,
                voucher_type=tx_dict.get("voucher_type") or (debit_voucher_type if tx_dict.get("debit") else credit_voucher_type),
                category=tx_dict.get("category", "General")
            ))
            
    # Apply edited narrations map if provided
    if edited_narrations:
        try:
            narr_map = json.loads(edited_narrations) if isinstance(edited_narrations, str) else edited_narrations
            for idx_str, custom_narr in narr_map.items():
                idx = int(idx_str)
                if 0 <= idx < len(reconstructed_txs):
                    reconstructed_txs[idx].narration = custom_narr
        except Exception as e:
            logger.warning(f"Error applying edited narrations: {e}")
            
    required_credits = max(1, pages_count or 1)
    if current_user.page_credits < required_credits:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=f"Insufficient credits. You need {required_credits} page credits to export this statement. Your current balance is {current_user.page_credits} pages."
        )
        
    try:
        xml_content = generate_tally_xml(
            transactions=reconstructed_txs,
            bank_ledger_name=tally_bank_ledger_name,
            counter_ledger_name=counter_ledger_name,
            credit_voucher_type=credit_voucher_type,
            debit_voucher_type=debit_voucher_type
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"XML generation failed: {str(e)}"
        )
        
    validation = validate_tally_xml(xml_content)
    
    balance_before = current_user.page_credits
    current_user.page_credits -= required_credits
    balance_after = current_user.page_credits
    
    conversion = Conversion(
        user_id=current_user.id,
        client_id=client_id,
        bank_name=bank_name,
        account_number=payload.get("account_number"),
        statement_period=payload.get("statement_period"),
        pages_count=required_credits,
        transactions_count=len(reconstructed_txs),
        status="SUCCESS",
        file_fingerprint=file_fingerprint or str(uuid.uuid4()),
        is_reconciled=payload.get("is_reconciled", True),
        opening_balance=float(payload.get("opening_balance", 0.0)),
        closing_balance=float(payload.get("closing_balance", 0.0)),
        cached_xml=xml_content,
        file_name=f"Tally_Import_{bank_name.replace(' ', '_')}_{len(reconstructed_txs)}_Vouchers.xml",
        source_type="STATEMENT_PDF"
    )
    db.add(conversion)
    db.flush()
    
    wallet_tx = WalletTransaction(
        user_id=current_user.id,
        amount_in_inr=0.0,
        pages_purchased=-required_credits,
        balance_before=balance_before,
        balance_after=balance_after,
        type="CONVERSION",
        reference_type="CONVERSION_ID",
        reference_id=conversion.id,
        description=f"Converted {bank_name} statement ({required_credits} pages)"
    )
    db.add(wallet_tx)
    db.commit()
    db.refresh(conversion)
    
    # Save cache file if directory exists
    try:
        cache_filepath = os.path.join(settings.XML_CACHE_DIR, f"{conversion.id}.xml")
        with open(cache_filepath, "w", encoding="utf-8") as f:
            f.write(xml_content)
    except Exception:
        pass
        
    filename = f"Tally_Vouchers_{bank_name.replace(' ', '_')}.xml"
    return Response(
        content=xml_content,
        media_type="application/xml",
        headers={
            "Content-Disposition": f"attachment; filename={filename}",
            "X-Vouchers-Count": str(validation["voucher_count"]),
            "X-Validation-Status": "VALID" if validation["is_valid"] else "WARNING"
        }
    )

@router.post("/excel")
async def get_excel_export(
    request: Request,
    current_user: User = Depends(get_current_user)
):
    content_type = request.headers.get("content-type", "")
    if "application/json" in content_type:
        payload = await request.json()
    else:
        form_data = await request.form()
        payload = dict(form_data)
        
    bank_name = payload.get("bank_name", "Bank Statement")
    transactions_raw = payload.get("transactions")
    temp_file_id = payload.get("temp_file_id")
    
    reconstructed_txs = []
    if transactions_raw:
        for tx in transactions_raw:
            t_date = date.fromisoformat(tx["txn_date"]) if isinstance(tx["txn_date"], str) else tx["txn_date"]
            v_date = date.fromisoformat(tx.get("val_date", tx["txn_date"])) if tx.get("val_date") else t_date
            reconstructed_txs.append(StandardTransaction(
                id=tx.get("id", str(uuid.uuid4())),
                txn_date=t_date,
                val_date=v_date,
                narration=tx.get("narration", ""),
                ref_no=tx.get("ref_no") or tx.get("utr"),
                utr=tx.get("utr"),
                cheque_number=tx.get("cheque_number"),
                debit=tx.get("debit"),
                credit=tx.get("credit"),
                balance=float(tx.get("balance", 0.0)),
                transaction_type=tx.get("transaction_type", "DEBIT"),
                assigned_ledger=tx.get("assigned_ledger") or tx.get("suggested_ledger"),
                voucher_type=tx.get("voucher_type", "Payment"),
                category=tx.get("category", "General"),
                confidence_score=float(tx.get("confidence_score", 100.0)),
                reconciliation_status=tx.get("reconciliation_status", "PASS"),
                requires_review=bool(tx.get("requires_review", False))
            ))
    elif temp_file_id and temp_file_id in IN_MEMORY_PREVIEW_CACHE:
        reconstructed_txs = list(IN_MEMORY_PREVIEW_CACHE[temp_file_id]["transactions"])
    else:
        raise HTTPException(status_code=400, detail="No transactions to export")
        
    excel_stream = export_transactions_to_excel(
        transactions=reconstructed_txs,
        bank_name=bank_name
    )
    filename = f"SheetBuddy_Reconciliation_{bank_name.replace(' ', '_')}.xlsx"
    return StreamingResponse(
        excel_stream,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@router.get("/rules", response_model=List[LedgerRuleResponse])
def get_ledger_rules(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    return db.query(LedgerRule).filter(LedgerRule.user_id == current_user.id).order_by(LedgerRule.priority.desc()).all()

@router.post("/rules", response_model=LedgerRuleResponse)
def create_ledger_rule(
    rule_data: LedgerRuleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    rule = LedgerRule(
        user_id=current_user.id,
        rule_name=rule_data.rule_name,
        pattern=rule_data.pattern,
        match_type=rule_data.match_type,
        min_amount=rule_data.min_amount,
        max_amount=rule_data.max_amount,
        txn_type=rule_data.txn_type,
        ledger_name=rule_data.ledger_name,
        voucher_type=rule_data.voucher_type,
        category=rule_data.category,
        priority=rule_data.priority
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return rule

@router.delete("/rules/{rule_id}")
def delete_ledger_rule(
    rule_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    rule = db.query(LedgerRule).filter(LedgerRule.id == rule_id, LedgerRule.user_id == current_user.id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    db.delete(rule)
    db.commit()
    return {"status": "SUCCESS", "message": "Rule deleted"}

@router.get("/clients", response_model=List[ClientResponse])
def get_clients(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    clients = db.query(Client).filter(Client.user_id == current_user.id).order_by(Client.created_at.desc()).all()
    results = []
    for c in clients:
        conv_stats = db.query(Conversion).filter(Conversion.client_id == c.id).all()
        conversions_count = len(conv_stats)
        vouchers_count = sum(cv.transactions_count or 0 for cv in conv_stats)
        
        results.append({
            "id": c.id,
            "organization_id": c.organization_id,
            "user_id": c.user_id,
            "name": c.name,
            "pan": c.pan,
            "gstin": c.gstin,
            "email": c.email,
            "phone": c.phone,
            "financial_year": getattr(c, "financial_year", "2024-25") or "2024-25",
            "business_type": getattr(c, "business_type", "Proprietorship") or "Proprietorship",
            "notes": c.notes,
            "status": c.status or "ACTIVE",
            "conversions_count": conversions_count,
            "vouchers_count": vouchers_count,
            "created_at": c.created_at
        })
    return results

@router.post("/clients", response_model=ClientResponse)
def create_client(
    client_data: ClientCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    client = Client(
        user_id=current_user.id,
        name=client_data.name.strip(),
        pan=client_data.pan.strip().upper() if client_data.pan else None,
        gstin=client_data.gstin.strip().upper() if client_data.gstin else None,
        email=client_data.email.strip() if client_data.email else None,
        phone=client_data.phone.strip() if client_data.phone else None,
        financial_year=client_data.financial_year or "2024-25",
        business_type=client_data.business_type or "Proprietorship",
        notes=client_data.notes
    )
    db.add(client)
    db.commit()
    db.refresh(client)
    return {
        "id": client.id,
        "organization_id": client.organization_id,
        "user_id": client.user_id,
        "name": client.name,
        "pan": client.pan,
        "gstin": client.gstin,
        "email": client.email,
        "phone": client.phone,
        "financial_year": client.financial_year,
        "business_type": client.business_type,
        "notes": client.notes,
        "status": client.status,
        "conversions_count": 0,
        "vouchers_count": 0,
        "created_at": client.created_at
    }

@router.put("/clients/{client_id}", response_model=ClientResponse)
def update_client(
    client_id: str,
    client_data: ClientUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    client = db.query(Client).filter(Client.id == client_id, Client.user_id == current_user.id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found.")
    
    if client_data.name is not None:
        client.name = client_data.name.strip()
    if client_data.pan is not None:
        client.pan = client_data.pan.strip().upper() if client_data.pan else None
    if client_data.gstin is not None:
        client.gstin = client_data.gstin.strip().upper() if client_data.gstin else None
    if client_data.email is not None:
        client.email = client_data.email.strip() if client_data.email else None
    if client_data.phone is not None:
        client.phone = client_data.phone.strip() if client_data.phone else None
    if client_data.financial_year is not None:
        client.financial_year = client_data.financial_year
    if client_data.business_type is not None:
        client.business_type = client_data.business_type
    if client_data.status is not None:
        client.status = client_data.status
    if client_data.notes is not None:
        client.notes = client_data.notes

    db.commit()
    db.refresh(client)

    conv_stats = db.query(Conversion).filter(Conversion.client_id == client.id).all()
    return {
        "id": client.id,
        "organization_id": client.organization_id,
        "user_id": client.user_id,
        "name": client.name,
        "pan": client.pan,
        "gstin": client.gstin,
        "email": client.email,
        "phone": client.phone,
        "financial_year": client.financial_year,
        "business_type": client.business_type,
        "notes": client.notes,
        "status": client.status,
        "conversions_count": len(conv_stats),
        "vouchers_count": sum(cv.transactions_count or 0 for cv in conv_stats),
        "created_at": client.created_at
    }

@router.delete("/clients/{client_id}")
def delete_client(
    client_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    client = db.query(Client).filter(Client.id == client_id, Client.user_id == current_user.id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found.")
    
    db.query(Conversion).filter(Conversion.client_id == client_id).update({"client_id": None})
    db.delete(client)
    db.commit()
    return {"status": "SUCCESS", "message": f"Client '{client.name}' deleted successfully."}

@router.get("/clients/{client_id}/dossier")
def get_client_dossier(
    client_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    client = db.query(Client).filter(Client.id == client_id, Client.user_id == current_user.id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found.")
        
    conversions = db.query(Conversion).filter(
        Conversion.client_id == client_id,
        Conversion.user_id == current_user.id
    ).order_by(Conversion.created_at.desc()).all()
    
    total_vouchers = sum(c.transactions_count or 0 for c in conversions)
    bank_set = set()
    for c in conversions:
        if c.bank_name:
            bank_label = c.bank_name
            if c.account_number:
                bank_label += f" ({c.account_number})"
            bank_set.add(bank_label)
            
    fy = getattr(client, "financial_year", "2024-25") or "2024-25"
    start_year = int(fy.split("-")[0]) if "-" in fy else 2024
    end_year = start_year + 1
    
    fy_months = [
        {"month": "April", "short": "Apr", "month_num": 4, "year": start_year},
        {"month": "May", "short": "May", "month_num": 5, "year": start_year},
        {"month": "June", "short": "Jun", "month_num": 6, "year": start_year},
        {"month": "July", "short": "Jul", "month_num": 7, "year": start_year},
        {"month": "August", "short": "Aug", "month_num": 8, "year": start_year},
        {"month": "September", "short": "Sep", "month_num": 9, "year": start_year},
        {"month": "October", "short": "Oct", "month_num": 10, "year": start_year},
        {"month": "November", "short": "Nov", "month_num": 11, "year": start_year},
        {"month": "December", "short": "Dec", "month_num": 12, "year": start_year},
        {"month": "January", "short": "Jan", "month_num": 1, "year": end_year},
        {"month": "February", "short": "Feb", "month_num": 2, "year": end_year},
        {"month": "March", "short": "Mar", "month_num": 3, "year": end_year},
    ]
    
    monthly_matrix = []
    for m in fy_months:
        matched_conversions = []
        for c in conversions:
            period_str = (c.statement_period or "").lower()
            month_name = m["month"].lower()
            month_short = m["short"].lower()
            month_num_str = f"{m['month_num']:02d}"
            if (month_name in period_str or 
                month_short in period_str or 
                f"-{month_num_str}-" in period_str or 
                f"/{month_num_str}/" in period_str or
                (c.created_at and c.created_at.month == m["month_num"] and c.created_at.year == m["year"])):
                matched_conversions.append(c)
                
        is_completed = len(matched_conversions) > 0
        v_count = sum(cv.transactions_count or 0 for cv in matched_conversions)
        banks = list(set(cv.bank_name for cv in matched_conversions))
        
        monthly_matrix.append({
            "month": m["month"],
            "short": m["short"],
            "year": m["year"],
            "is_completed": is_completed,
            "vouchers_count": v_count,
            "banks": banks,
            "conversions_count": len(matched_conversions),
            "latest_conversion_id": matched_conversions[0].id if matched_conversions else None
        })
        
    return {
        "client": {
            "id": client.id,
            "name": client.name,
            "pan": client.pan,
            "gstin": client.gstin,
            "email": client.email,
            "phone": client.phone,
            "financial_year": fy,
            "business_type": getattr(client, "business_type", "Proprietorship"),
            "status": client.status,
            "notes": client.notes
        },
        "total_statements": len(conversions),
        "total_vouchers": total_vouchers,
        "bank_accounts": list(bank_set),
        "monthly_matrix": monthly_matrix,
        "conversions": [
            {
                "id": c.id,
                "bank_name": c.bank_name,
                "account_number": c.account_number,
                "statement_period": c.statement_period,
                "pages_count": c.pages_count,
                "transactions_count": c.transactions_count,
                "file_name": getattr(c, "file_name", None) or f"Tally_Import_{c.bank_name.replace(' ', '_')}.xml",
                "source_type": getattr(c, "source_type", "STATEMENT_PDF") or "STATEMENT_PDF",
                "xml_size_kb": round(len((c.cached_xml or "").encode('utf-8')) / 1024, 1) if c.cached_xml else 0.0,
                "created_at": c.created_at
            }
            for c in conversions
        ]
    }

@router.post("/save-cloud-xml")
def save_cloud_xml(
    request_data: SaveCloudXmlRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if not request_data.xml_content:
        raise HTTPException(status_code=400, detail="XML content cannot be empty.")
        
    client_name = "Default"
    if request_data.client_id:
        c = db.query(Client).filter(Client.id == request_data.client_id, Client.user_id == current_user.id).first()
        if c:
            client_name = c.name

    file_name = request_data.file_name or f"Tally_{request_data.bank_name.replace(' ', '_')}.xml"
    if not file_name.endswith(".xml"):
        file_name += ".xml"

    conversion = Conversion(
        user_id=current_user.id,
        client_id=request_data.client_id,
        bank_name=request_data.bank_name,
        account_number=None,
        statement_period=request_data.statement_period,
        pages_count=request_data.pages_count or 1,
        transactions_count=request_data.transactions_count or 0,
        status="SUCCESS",
        file_fingerprint=f"vault_{uuid.uuid4().hex[:16]}",
        is_reconciled=True,
        opening_balance=request_data.opening_balance or 0.0,
        closing_balance=request_data.closing_balance or 0.0,
        cached_xml=request_data.xml_content,
        file_name=file_name,
        source_type=request_data.source_type or "STATEMENT_PDF"
    )
    db.add(conversion)
    db.commit()
    db.refresh(conversion)
    
    return {
        "status": "SUCCESS",
        "conversion_id": conversion.id,
        "file_name": conversion.file_name,
        "download_url": f"/api/convert/download-xml/{conversion.id}",
        "message": "XML file successfully archived in Cloud Vault."
    }

@router.delete("/history/{conversion_id}")
def delete_saved_xml(
    conversion_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    conversion = db.query(Conversion).filter(
        Conversion.id == conversion_id,
        Conversion.user_id == current_user.id
    ).first()
    if not conversion:
        raise HTTPException(status_code=404, detail="Record not found in Cloud Vault.")
    
    db.delete(conversion)
    db.commit()
    return {"status": "SUCCESS", "message": "Record removed from Cloud Vault."}

@router.get("/history", response_model=List[ConversionResponse])
def get_conversion_history(
    client_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(Conversion).filter(Conversion.user_id == current_user.id)
    if client_id:
        query = query.filter(Conversion.client_id == client_id)
        
    conversions = query.order_by(Conversion.created_at.desc()).all()
    results = []
    
    client_cache = {}
    for conv in conversions:
        c_name = None
        if conv.client_id:
            if conv.client_id not in client_cache:
                client_obj = db.query(Client).filter(Client.id == conv.client_id).first()
                client_cache[conv.client_id] = client_obj.name if client_obj else None
            c_name = client_cache[conv.client_id]
            
        xml_len = len(conv.cached_xml.encode('utf-8')) if conv.cached_xml else 0
        xml_size_kb = round(xml_len / 1024, 1)
        
        fallback_filename = f"Tally_Import_{conv.bank_name.replace(' ', '_')}.xml"
        file_name = getattr(conv, "file_name", None) or fallback_filename
        
        results.append({
            "id": conv.id,
            "client_id": conv.client_id,
            "client_name": c_name,
            "bank_name": conv.bank_name,
            "account_number": conv.account_number,
            "statement_period": conv.statement_period,
            "pages_count": conv.pages_count,
            "transactions_count": conv.transactions_count,
            "status": conv.status,
            "is_reconciled": conv.is_reconciled,
            "opening_balance": conv.opening_balance,
            "closing_balance": conv.closing_balance,
            "file_name": file_name,
            "source_type": getattr(conv, "source_type", "STATEMENT_PDF") or "STATEMENT_PDF",
            "has_xml": bool(conv.cached_xml),
            "xml_size_kb": xml_size_kb,
            "created_at": conv.created_at
        })
    return results

@router.get("/download-xml/{conversion_id}")
def download_cached_xml(
    conversion_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    conversion = db.query(Conversion).filter(
        Conversion.id == conversion_id,
        Conversion.user_id == current_user.id
    ).first()
    if not conversion or not conversion.cached_xml:
        cache_filepath = os.path.join(settings.XML_CACHE_DIR, f"{conversion_id}.xml")
        if os.path.exists(cache_filepath):
            with open(cache_filepath, "r", encoding="utf-8") as f:
                xml_content = f.read()
        else:
            raise HTTPException(status_code=404, detail="Conversion record or cached XML not found.")
    else:
        xml_content = conversion.cached_xml
        
    filename = getattr(conversion, "file_name", None) or f"Tally_Vouchers_{conversion.bank_name.replace(' ', '_')}.xml"
    if not filename.endswith(".xml"):
        filename += ".xml"
        
    return Response(
        content=xml_content,
        media_type="application/xml",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Access-Control-Expose-Headers": "Content-Disposition"
        }
    )
