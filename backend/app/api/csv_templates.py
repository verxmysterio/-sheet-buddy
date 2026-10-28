import io
import uuid
import json
import logging
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status, Response, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import List, Optional, Dict, Any, Tuple
from datetime import datetime, timezone

from ..models.database import get_db
from ..models.models import User, Conversion, WalletTransaction, CsvMappingTemplate
from ..schemas.schemas import (
    CsvMappingTemplateCreate,
    CsvMappingTemplateUpdate,
    CsvMappingTemplateResponse,
    CsvInspectResponse,
    CsvPreviewResponse,
    CsvXmlConversionRequest
)
from ..services.csv_tally_engine import (
    get_blank_csv_template,
    get_sample_csv_template,
    detect_csv_headers_and_samples,
    parse_csv_with_mapping,
    generate_multi_voucher_tally_xml
)
from ..services.xml_generator import validate_tally_xml
from .deps import get_current_user

logger = logging.getLogger("sheetbuddy.csv")
router = APIRouter(prefix="/csv", tags=["CSV Templates & Mapping"])

# In-memory preview cache for uploaded CSVs during preview session
CSV_IN_MEMORY_CACHE: Dict[str, Dict[str, Any]] = {}

@router.get("/templates/blank")
def download_blank_template():
    """
    Downloads a blank standard CSV template with clean headers and documentation row.
    """
    csv_text = get_blank_csv_template()
    return Response(
        content=csv_text,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=SheetBuddy_Blank_Template.csv"}
    )

@router.get("/templates/sample")
def download_sample_template():
    """
    Downloads a rich sample CSV template with pre-filled examples for Payment, Receipt, Contra, Journal, Sales, and Purchase entries.
    """
    csv_text = get_sample_csv_template()
    return Response(
        content=csv_text,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=SheetBuddy_Sample_Vouchers.csv"}
    )

@router.get("/mappings", response_model=List[CsvMappingTemplateResponse])
def get_user_mappings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Returns all saved mapping templates created by the current user.
    """
    return db.query(CsvMappingTemplate).filter(
        CsvMappingTemplate.user_id == current_user.id
    ).order_by(CsvMappingTemplate.created_at.desc()).all()

@router.post("/mappings", response_model=CsvMappingTemplateResponse)
def create_mapping_template(
    template_data: CsvMappingTemplateCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Creates and saves a new custom CSV column mapping template.
    """
    template = CsvMappingTemplate(
        user_id=current_user.id,
        name=template_data.name.strip(),
        description=template_data.description,
        date_column=template_data.date_column.strip(),
        date_format=template_data.date_format.strip(),
        voucher_type_column=template_data.voucher_type_column.strip() if template_data.voucher_type_column else None,
        default_voucher_type=template_data.default_voucher_type.strip(),
        voucher_number_column=template_data.voucher_number_column.strip() if template_data.voucher_number_column else None,
        debit_ledger_column=template_data.debit_ledger_column.strip() if template_data.debit_ledger_column else None,
        default_debit_ledger=template_data.default_debit_ledger.strip() if template_data.default_debit_ledger else None,
        credit_ledger_column=template_data.credit_ledger_column.strip() if template_data.credit_ledger_column else None,
        default_credit_ledger=template_data.default_credit_ledger.strip() if template_data.default_credit_ledger else None,
        amount_column=template_data.amount_column.strip() if template_data.amount_column else None,
        debit_amount_column=template_data.debit_amount_column.strip() if template_data.debit_amount_column else None,
        credit_amount_column=template_data.credit_amount_column.strip() if template_data.credit_amount_column else None,
        narration_column=template_data.narration_column.strip() if template_data.narration_column else None,
        default_narration=template_data.default_narration.strip() if template_data.default_narration else None,
        ref_no_column=template_data.ref_no_column.strip() if template_data.ref_no_column else None,
        is_active=True
    )
    db.add(template)
    db.commit()
    db.refresh(template)
    return template

@router.get("/mappings/{template_id}", response_model=CsvMappingTemplateResponse)
def get_mapping_template(
    template_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Retrieves a single mapping template by ID.
    """
    template = db.query(CsvMappingTemplate).filter(
        CsvMappingTemplate.id == template_id,
        CsvMappingTemplate.user_id == current_user.id
    ).first()
    if not template:
        raise HTTPException(status_code=404, detail="Mapping template not found")
    return template

@router.put("/mappings/{template_id}", response_model=CsvMappingTemplateResponse)
def update_mapping_template(
    template_id: str,
    update_data: CsvMappingTemplateUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Updates an existing mapping template.
    """
    template = db.query(CsvMappingTemplate).filter(
        CsvMappingTemplate.id == template_id,
        CsvMappingTemplate.user_id == current_user.id
    ).first()
    if not template:
        raise HTTPException(status_code=404, detail="Mapping template not found")
        
    for key, value in update_data.model_dump(exclude_unset=True).items():
        setattr(template, key, value)
        
    template.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(template)
    return template

@router.delete("/mappings/{template_id}")
def delete_mapping_template(
    template_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Deletes a mapping template.
    """
    template = db.query(CsvMappingTemplate).filter(
        CsvMappingTemplate.id == template_id,
        CsvMappingTemplate.user_id == current_user.id
    ).first()
    if not template:
        raise HTTPException(status_code=404, detail="Mapping template not found")
        
    db.delete(template)
    db.commit()
    return {"status": "SUCCESS", "message": "Mapping template deleted successfully"}

@router.post("/inspect", response_model=CsvInspectResponse)
async def inspect_csv_file(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user)
):
    """
    Uploads a CSV file to inspect detected column headers and sample data rows.
    """
    if not file.filename.lower().endswith((".csv", ".txt")):
        raise HTTPException(status_code=400, detail="Please upload a valid CSV file.")
        
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")
        
    headers, sample_rows, total_rows = detect_csv_headers_and_samples(content)
    return {
        "headers": headers,
        "sample_rows": sample_rows,
        "total_rows": total_rows
    }

@router.post("/preview", response_model=CsvPreviewResponse)
async def preview_mapped_csv(
    file: UploadFile = File(...),
    mapping_template_id: Optional[str] = Form(None),
    custom_mapping_json: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Parses an uploaded CSV file using either a saved mapping template or ad-hoc custom mapping configuration.
    Returns preview of vouchers, validation issues, and counts for Payment, Receipt, Contra, Journal, etc.
    """
    if not file.filename.lower().endswith((".csv", ".txt")):
        raise HTTPException(status_code=400, detail="Please upload a valid CSV file.")
        
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded CSV file is empty.")
        
    # Determine mapping config
    mapping_dict = {}
    if mapping_template_id and mapping_template_id not in ["default", ""]:
        saved_template = db.query(CsvMappingTemplate).filter(
            CsvMappingTemplate.id == mapping_template_id,
            CsvMappingTemplate.user_id == current_user.id
        ).first()
        if saved_template:
            mapping_dict = {
                "name": saved_template.name,
                "date_column": saved_template.date_column,
                "date_format": saved_template.date_format,
                "voucher_type_column": saved_template.voucher_type_column,
                "default_voucher_type": saved_template.default_voucher_type,
                "voucher_number_column": saved_template.voucher_number_column,
                "debit_ledger_column": saved_template.debit_ledger_column,
                "default_debit_ledger": saved_template.default_debit_ledger,
                "credit_ledger_column": saved_template.credit_ledger_column,
                "default_credit_ledger": saved_template.default_credit_ledger,
                "amount_column": saved_template.amount_column,
                "debit_amount_column": saved_template.debit_amount_column,
                "credit_amount_column": saved_template.credit_amount_column,
                "narration_column": saved_template.narration_column,
                "default_narration": saved_template.default_narration,
                "ref_no_column": saved_template.ref_no_column
            }
            
    if not mapping_dict and custom_mapping_json:
        try:
            mapping_dict = json.loads(custom_mapping_json)
        except Exception:
            pass
            
    # Fallback to standard 1:1 default mapping
    if not mapping_dict:
        mapping_dict = {
            "name": "Standard Sheet Buddy CSV",
            "date_column": "Date",
            "date_format": "%d-%m-%Y",
            "voucher_type_column": "Voucher Type",
            "default_voucher_type": "Payment",
            "voucher_number_column": "Voucher No",
            "debit_ledger_column": "Debit Ledger",
            "credit_ledger_column": "Credit Ledger",
            "amount_column": "Amount",
            "narration_column": "Narration",
            "ref_no_column": "Ref / Cheque No"
        }
        
    preview_result = parse_csv_with_mapping(content, mapping_dict)
    
    # Cache preview result in-memory
    session_key = str(uuid.uuid4())
    CSV_IN_MEMORY_CACHE[session_key] = preview_result
    
    return preview_result


def calculate_csv_credits(transaction_count: int) -> Tuple[int, int, int]:
    """
    Charges 1 credit for every 10 transactions.
    Gives volume discount / roundoff:
    - 1-20 txns: standard (1-10: 1 credit, 11-20: 2 credits)
    - 21-50 txns: 10% roundoff discount
    - 51-100 txns: 15% roundoff discount
    - 101-250 txns: 20% roundoff discount
    - 251+ txns: 25% bulk discount
    Returns (raw_credits, discount_credits, final_credits)
    """
    if transaction_count <= 0:
        return 0, 0, 0
    raw = (transaction_count + 9) // 10
    if transaction_count > 250:
        percent = 25
    elif transaction_count > 100:
        percent = 20
    elif transaction_count > 50:
        percent = 15
    elif transaction_count > 20:
        percent = 10
    else:
        percent = 0
        
    discount = (raw * percent) // 100 if percent > 0 else 0
    final = max(1, raw - discount)
    return raw, discount, final

@router.post("/convert-to-xml")
async def convert_vouchers_to_tally_xml(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Takes validated and/or inline-edited voucher transactions and generates a 100% compliant Tally Prime XML file.
    Deducts 1 page credit for the conversion batch.
    """
    payload = await request.json()
    vouchers_raw = payload.get("vouchers", [])
    mapping_name = payload.get("mapping_name", "CSV Import")
    
    if not vouchers_raw:
        raise HTTPException(status_code=400, detail="No vouchers provided for conversion.")
        
    # Verify user credits: 1 credit per 10 transactions with bulk roundoff discount
    raw_credits, discount_credits, required_credits = calculate_csv_credits(len(vouchers_raw))
    if not current_user.is_admin and current_user.page_credits < required_credits:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=f"Insufficient credits. You need {required_credits} credits to convert {len(vouchers_raw)} vouchers (rate: 1 credit per 10 transactions with {discount_credits} credit discount). Your balance is {current_user.page_credits}."
        )
        
    # Generate XML
    try:
        xml_content = generate_multi_voucher_tally_xml(vouchers_raw)
    except Exception as e:
        logger.error(f"CSV XML generation failed: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate Tally XML: {str(e)}")
        
    validation = validate_tally_xml(xml_content)
    
    # Deduct credit
    balance_before = current_user.page_credits
    if not current_user.is_admin:
        current_user.page_credits -= required_credits
    balance_after = current_user.page_credits
    
    # Record Conversion
    conversion = Conversion(
        user_id=current_user.id,
        bank_name=f"CSV: {mapping_name[:80]}",
        account_number=None,
        statement_period="Batch Import",
        pages_count=required_credits,
        transactions_count=len(vouchers_raw),
        status="SUCCESS",
        file_fingerprint=str(uuid.uuid4()),
        is_reconciled=True,
        opening_balance=0.0,
        closing_balance=sum(float(v.get("amount", 0.0)) for v in vouchers_raw),
        cached_xml=xml_content
    )
    db.add(conversion)
    db.flush()
    
    # Record Wallet Transaction
    wallet_tx = WalletTransaction(
        user_id=current_user.id,
        amount_in_inr=0.0,
        pages_purchased=-required_credits if not current_user.is_admin else 0,
        balance_before=balance_before,
        balance_after=balance_after,
        type="CONVERSION",
        reference_type="CONVERSION_ID",
        reference_id=conversion.id,
        description=f"CSV Voucher Import: {mapping_name} ({len(vouchers_raw)} vouchers, {required_credits} credits charged with {discount_credits} roundoff discount)"
    )
    db.add(wallet_tx)
    db.commit()
    db.refresh(conversion)
    
    filename = f"Tally_Vouchers_{mapping_name.replace(' ', '_')}.xml"
    return Response(
        content=xml_content,
        media_type="application/xml",
        headers={
            "Content-Disposition": f"attachment; filename={filename}",
            "X-Vouchers-Count": str(len(vouchers_raw)),
            "X-Validation-Status": "VALID" if validation["is_valid"] else "WARNING"
        }
    )

@router.post("/export-excel")
async def export_vouchers_to_excel(
    request: Request,
    current_user: User = Depends(get_current_user)
):
    """
    Exports parsed/edited voucher list to an Excel spreadsheet.
    """
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    
    payload = await request.json()
    vouchers = payload.get("vouchers", [])
    mapping_name = payload.get("mapping_name", "Vouchers")
    
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Vouchers"
    
    headers = ["#", "Date", "Voucher Type", "Voucher No", "Debit Ledger", "Credit Ledger", "Amount", "Narration", "Ref / Cheque No"]
    ws.append(headers)
    
    # Header styling
    header_fill = PatternFill(start_color="FFD615", end_color="FFD615", fill_type="solid")
    header_font = Font(name="Segoe UI", size=11, bold=True, color="000000")
    for col_idx in range(1, len(headers) + 1):
        cell = ws.cell(row=1, column=col_idx)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center" if col_idx in [1, 2, 3, 4] else "left", vertical="center")
        
    for idx, vch in enumerate(vouchers):
        ws.append([
            idx + 1,
            vch.get("date", ""),
            vch.get("voucher_type", ""),
            vch.get("voucher_number", ""),
            vch.get("debit_ledger", ""),
            vch.get("credit_ledger", ""),
            float(vch.get("amount") or 0.0),
            vch.get("narration", ""),
            vch.get("ref_no", "")
        ])
        
    # Auto-adjust column widths
    for col in ws.columns:
        max_len = max(len(str(cell.value or '')) for cell in col)
        col_letter = openpyxl.utils.get_column_letter(col[0].column)
        ws.column_dimensions[col_letter].width = max(max_len + 3, 12)
        
    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    
    filename = f"SheetBuddy_{mapping_name.replace(' ', '_')}.xlsx"
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )
