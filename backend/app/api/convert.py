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
    ClientResponse
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
    pages_count = int(payload.get("pages_count", 0))
    file_fingerprint = payload.get("file_fingerprint")
    client_id = payload.get("client_id")
    edited_narrations = payload.get("edited_narrations")
    
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
            t_date = date.fromisoformat(tx_dict["txn_date"]) if isinstance(tx_dict["txn_date"], str) else tx_dict["txn_date"]
            v_date = date.fromisoformat(tx_dict.get("val_date", tx_dict["txn_date"])) if tx_dict.get("val_date") else t_date
            
            reconstructed_txs.append(StandardTransaction(
                id=tx_dict.get("id", str(uuid.uuid4())),
                txn_date=t_date,
                val_date=v_date,
                narration=tx_dict.get("narration", ""),
                ref_no=tx_dict.get("ref_no") or tx_dict.get("utr"),
                utr=tx_dict.get("utr"),
                cheque_number=tx_dict.get("cheque_number"),
                debit=tx_dict.get("debit"),
                credit=tx_dict.get("credit"),
                balance=float(tx_dict.get("balance", 0.0)),
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
        cached_xml=xml_content
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
    return db.query(Client).filter(Client.user_id == current_user.id).all()

@router.post("/clients", response_model=ClientResponse)
def create_client(
    client_data: ClientCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    client = Client(
        user_id=current_user.id,
        name=client_data.name,
        pan=client_data.pan,
        gstin=client_data.gstin,
        email=client_data.email,
        phone=client_data.phone,
        notes=client_data.notes
    )
    db.add(client)
    db.commit()
    db.refresh(client)
    return client

@router.get("/history", response_model=List[ConversionResponse])
def get_conversion_history(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    return db.query(Conversion).filter(
        Conversion.user_id == current_user.id
    ).order_by(Conversion.created_at.desc()).all()

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
        # Fallback to file check
        cache_filepath = os.path.join(settings.XML_CACHE_DIR, f"{conversion_id}.xml")
        if os.path.exists(cache_filepath):
            with open(cache_filepath, "r", encoding="utf-8") as f:
                xml_content = f.read()
        else:
            raise HTTPException(status_code=404, detail="Conversion record or cached XML not found.")
    else:
        xml_content = conversion.cached_xml
        
    filename = f"Tally_Vouchers_{conversion.bank_name.replace(' ', '_')}.xml"
    return Response(
        content=xml_content,
        media_type="application/xml",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )
