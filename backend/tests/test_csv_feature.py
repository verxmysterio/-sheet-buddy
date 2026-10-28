import io
import csv
import xml.etree.ElementTree as ET
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.main import app
from app.models.database import Base, get_db
from app.models.models import User, CsvMappingTemplate
from app.core.security import hash_password
from app.services.csv_tally_engine import (
    get_blank_csv_template,
    get_sample_csv_template,
    parse_csv_with_mapping,
    generate_multi_voucher_tally_xml
)
from app.services.xml_generator import validate_tally_xml

# Setup a clean in-memory database for testing
SQLALCHEMY_DATABASE_URL = "sqlite:///./test_csv.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()

client = TestClient(app)

def setup_module(module):
    app.dependency_overrides[get_db] = override_get_db
    Base.metadata.create_all(bind=engine)

def teardown_module(module):
    Base.metadata.drop_all(bind=engine)
    engine.dispose()
    import os
    if os.path.exists("./test_csv.db"):
        try:
            os.remove("./test_csv.db")
        except Exception:
            pass

def create_test_user(email="csv_tester@example.com", password="password123", credits=50):
    db = TestingSessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        if not user:
            user = User(
                email=email,
                hashed_password=hash_password(password),
                page_credits=credits,
                is_admin=False,
                is_verified=True
            )
            db.add(user)
            db.commit()
            db.refresh(user)
        return user
    finally:
        db.close()

def get_auth_headers(email="csv_tester@example.com", password="password123"):
    login_res = client.post("/api/auth/login", json={"email": email, "password": password})
    assert login_res.status_code == 200
    token = login_res.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}

def test_download_templates():
    # 1. Blank Template
    blank_res = client.get("/api/csv/templates/blank")
    assert blank_res.status_code == 200
    assert "Date,Voucher Type,Voucher No,Debit Ledger,Credit Ledger,Amount,Narration,Ref / Cheque No" in blank_res.text
    assert "attachment; filename=SheetBuddy_Blank_Template.csv" in blank_res.headers["Content-Disposition"]

    # 2. Sample Template
    sample_res = client.get("/api/csv/templates/sample")
    assert sample_res.status_code == 200
    assert "Payment" in sample_res.text
    assert "Receipt" in sample_res.text
    assert "Contra" in sample_res.text
    assert "Journal" in sample_res.text
    assert "Office Rent Expenses" in sample_res.text

def test_mapping_template_crud():
    create_test_user("mapping_user@example.com", "pass123")
    headers = get_auth_headers("mapping_user@example.com", "pass123")

    # 1. Create Mapping Template
    payload = {
        "name": "Custom ERP Mapping",
        "description": "Mapping for billing ERP exports",
        "date_column": "Txn Date",
        "date_format": "%d/%m/%Y",
        "voucher_type_column": "Entry Type",
        "default_voucher_type": "Payment",
        "voucher_number_column": "Doc No",
        "debit_ledger_column": "Dr Account",
        "default_debit_ledger": "Office Expenses",
        "credit_ledger_column": "Cr Account",
        "default_credit_ledger": "HDFC Bank",
        "amount_column": "Net Total",
        "narration_column": "Remarks",
        "ref_no_column": "Cheque UTR"
    }
    create_res = client.post("/api/csv/mappings", headers=headers, json=payload)
    assert create_res.status_code == 200
    data = create_res.json()
    assert data["name"] == "Custom ERP Mapping"
    assert data["date_column"] == "Txn Date"
    template_id = data["id"]

    # 2. List Mappings
    list_res = client.get("/api/csv/mappings", headers=headers)
    assert list_res.status_code == 200
    items = list_res.json()
    assert len(items) >= 1
    assert any(i["id"] == template_id for i in items)

    # 3. Get Single Mapping
    get_res = client.get(f"/api/csv/mappings/{template_id}", headers=headers)
    assert get_res.status_code == 200
    assert get_res.json()["name"] == "Custom ERP Mapping"

    # 4. Update Mapping
    update_res = client.put(f"/api/csv/mappings/{template_id}", headers=headers, json={
        "name": "Updated ERP Mapping",
        "default_voucher_type": "Receipt"
    })
    assert update_res.status_code == 200
    assert update_res.json()["name"] == "Updated ERP Mapping"
    assert update_res.json()["default_voucher_type"] == "Receipt"

    # 5. Delete Mapping
    del_res = client.delete(f"/api/csv/mappings/{template_id}", headers=headers)
    assert del_res.status_code == 200
    get_again = client.get(f"/api/csv/mappings/{template_id}", headers=headers)
    assert get_again.status_code == 404

def test_csv_inspect_and_preview():
    create_test_user("preview_user@example.com", "pass123")
    headers = get_auth_headers("preview_user@example.com", "pass123")

    sample_csv = get_sample_csv_template()
    csv_file = ("sample.csv", io.BytesIO(sample_csv.encode("utf-8")), "text/csv")

    # 1. Inspect CSV
    inspect_res = client.post("/api/csv/inspect", headers=headers, files={"file": csv_file})
    assert inspect_res.status_code == 200
    inspect_data = inspect_res.json()
    assert "Date" in inspect_data["headers"]
    assert "Debit Ledger" in inspect_data["headers"]
    assert inspect_data["total_rows"] >= 10

    # 2. Preview Standard CSV
    csv_file2 = ("sample.csv", io.BytesIO(sample_csv.encode("utf-8")), "text/csv")
    preview_res = client.post(
        "/api/csv/preview",
        headers=headers,
        data={"mapping_template_id": "default"},
        files={"file": csv_file2}
    )
    assert preview_res.status_code == 200
    preview_data = preview_res.json()
    assert preview_data["total_vouchers"] >= 10
    assert preview_data["payment_count"] >= 3
    assert preview_data["receipt_count"] >= 3
    assert preview_data["contra_count"] >= 3
    assert preview_data["journal_count"] >= 3
    assert preview_data["invalid_rows_count"] == 0
    assert len(preview_data["vouchers"]) >= 10

def test_custom_csv_mapping_and_conversion():
    create_test_user("convert_user@example.com", "pass123", credits=20)
    headers = get_auth_headers("convert_user@example.com", "pass123")

    # Custom CSV with different column names
    custom_csv = """Txn Date,Entry Type,Vch Ref,Dr Account,Cr Account,Total Amount,Description,Instrument
01/04/2026,Payment,PV-101,Travelling Expenses,Cash,4500.00,Client site travel conveyance,CASH-1
02/04/2026,Receipt,RV-202,HDFC Bank,M/s Surya Builders,65000.00,Consultancy fees received,NEFT-889900
03/04/2026,Contra,CV-303,Cash,HDFC Bank,10000.00,Cash withdrawal from ATM,ATM-10
04/04/2026,Journal,JV-404,Depreciation,Office Furniture,3000.00,Depreciation on chairs and tables,JV-APR-01
"""
    # 1. Save custom template
    template_res = client.post("/api/csv/mappings", headers=headers, json={
        "name": "Custom ERP Headers",
        "date_column": "Txn Date",
        "date_format": "%d/%m/%Y",
        "voucher_type_column": "Entry Type",
        "default_voucher_type": "Payment",
        "voucher_number_column": "Vch Ref",
        "debit_ledger_column": "Dr Account",
        "credit_ledger_column": "Cr Account",
        "amount_column": "Total Amount",
        "narration_column": "Description",
        "ref_no_column": "Instrument"
    })
    assert template_res.status_code == 200
    template_id = template_res.json()["id"]

    # 2. Preview with this template
    csv_file = ("custom.csv", io.BytesIO(custom_csv.encode("utf-8")), "text/csv")
    preview_res = client.post(
        "/api/csv/preview",
        headers=headers,
        data={"mapping_template_id": template_id},
        files={"file": csv_file}
    )
    assert preview_res.status_code == 200
    preview_data = preview_res.json()
    assert preview_data["total_vouchers"] == 4
    assert preview_data["payment_count"] == 1
    assert preview_data["receipt_count"] == 1
    assert preview_data["contra_count"] == 1
    assert preview_data["journal_count"] == 1
    assert preview_data["total_amount"] == 82500.00

    # 3. Convert to Tally XML
    conversion_payload = {
        "mapping_name": "Custom ERP Headers",
        "vouchers": preview_data["vouchers"]
    }
    xml_res = client.post("/api/csv/convert-to-xml", headers=headers, json=conversion_payload)
    assert xml_res.status_code == 200
    assert xml_res.headers["Content-Type"] == "application/xml"
    assert "Tally_Vouchers_Custom_ERP_Headers.xml" in xml_res.headers["Content-Disposition"]
    
    xml_content = xml_res.text
    assert "<ENVELOPE>" in xml_content
    assert 'VCHTYPE="Payment"' in xml_content
    assert 'VCHTYPE="Receipt"' in xml_content
    assert 'VCHTYPE="Contra"' in xml_content
    assert 'VCHTYPE="Journal"' in xml_content
    
    # 4. Comprehensive Tally XML validation
    val_result = validate_tally_xml(xml_content)
    assert val_result["is_valid"] is True
    assert val_result["voucher_count"] == 4
    assert val_result["malformed_count"] == 0

    # 5. Check user credits deducted by 1
    profile = client.get("/api/auth/me", headers=headers).json()
    assert profile["page_credits"] == 19

def test_export_vouchers_to_excel():
    create_test_user("excel_user@example.com", "pass123")
    headers = get_auth_headers("excel_user@example.com", "pass123")

    vouchers = [
        {"row_idx": 1, "date": "2026-04-01", "voucher_type": "Payment", "voucher_number": "P1", "debit_ledger": "Rent", "credit_ledger": "Bank", "amount": 1000.0, "narration": "April Rent", "ref_no": "R123"}
    ]
    res = client.post("/api/csv/export-excel", headers=headers, json={"vouchers": vouchers, "mapping_name": "TestBatch"})
    assert res.status_code == 200
    assert "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" in res.headers["Content-Type"]
    assert len(res.content) > 0
