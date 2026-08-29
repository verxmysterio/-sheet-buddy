import os
import shutil
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.main import app
from app.models.database import Base, get_db
from app.core.config import settings

# Setup a clean in-memory database for testing
SQLALCHEMY_DATABASE_URL = "sqlite:///./test_saas.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = override_get_db

client = TestClient(app)

PDF_PATH = r"c:\Users\aakas\OneDrive\Desktop\credentials\01.pdf"

def create_test_user(email: str, password: str, page_credits: int = 100, is_admin: bool = False):
    from app.core.security import hash_password
    from app.models.models import User, WalletTransaction
    db = TestingSessionLocal()
    try:
        user = db.query(User).filter_by(email=email).first()
        if not user:
            user = User(
                email=email,
                hashed_password=hash_password(password),
                page_credits=page_credits,
                is_admin=is_admin,
                is_verified=True
            )
            db.add(user)
            db.commit()
            db.refresh(user)
            
            tx = WalletTransaction(
                user_id=user.id,
                amount_in_inr=0.0,
                pages_purchased=page_credits,
                type="REFUND",
                description="Test seed credits"
            )
            db.add(tx)
            db.commit()
        return user
    finally:
        db.close()

def setup_module(module):
    # Create tables
    Base.metadata.create_all(bind=engine)
    
    # Seed admin user in test database
    from app.core.security import hash_password
    from app.models.models import User, BankConfig
    db = TestingSessionLocal()
    try:
        admin_user = db.query(User).filter(User.email == "admin@sheetbuddy.com").first()
        if not admin_user:
            admin_user = User(
                email="admin@sheetbuddy.com",
                hashed_password=hash_password("adminpassword"),
                page_credits=99999,
                is_admin=True,
                is_verified=True
            )
            db.add(admin_user)
            db.commit()
            
        # Seed default bank configs
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
                name="Axis Bank",
                match_patterns="AXIS,AXISBANK",
                parser_type="NATIVE",
                config_json="{}"
            )
            db.add_all([sbi, bob, axis])
            db.commit()
    finally:
        db.close()

def teardown_module(module):
    # Drop tables and dispose engine to unlock file on Windows
    Base.metadata.drop_all(bind=engine)
    engine.dispose()
    if os.path.exists("./test_saas.db"):
        os.remove("./test_saas.db")

def test_full_saas_workflow():
    # 1. Pre-seed User directly
    create_test_user("test@example.com", "testpassword", page_credits=100)
    
    # 2. Login
    login_response = client.post("/api/auth/login", json={
        "email": "test@example.com",
        "password": "testpassword"
    })
    assert login_response.status_code == 200
    token = login_response.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    
    # 3. Get profile
    profile_response = client.get("/api/auth/me", headers=headers)
    assert profile_response.status_code == 200
    assert profile_response.json()["page_credits"] == 100
    
    # 4. Upload PDF statement
    assert os.path.exists(PDF_PATH)
    with open(PDF_PATH, "rb") as f:
        upload_response = client.post(
            "/api/convert/upload",
            headers=headers,
            data={"bank_name": "State Bank of India"},
            files={"file": ("01.pdf", f, "application/pdf")}
        )
    assert upload_response.status_code == 200
    upload_data = upload_response.json()
    assert upload_data["bank_name"] == "State Bank of India"
    assert upload_data["pages_count"] == 15
    assert upload_data["transactions_count"] == 227
    assert upload_data["reconciled"] is True
    assert upload_data["is_duplicate"] is False
    
    temp_file_id = upload_data["temp_file_id"]
    file_fingerprint = upload_data["file_fingerprint"]
    
    # 5. Check balance before conversion
    bal_response = client.get("/api/wallet/balance", headers=headers)
    assert bal_response.status_code == 200
    assert bal_response.json()["page_credits"] == 100
    
    # 6. Execute conversion to Tally XML (uses 15 credits)
    exec_response = client.post(
        "/api/convert/execute",
        headers=headers,
        data={
            "temp_file_id": temp_file_id,
            "tally_bank_ledger_name": "SBI Ledger",
            "bank_name": "State Bank of India"
        }
    )
    assert exec_response.status_code == 200
    assert exec_response.headers["content-type"] == "application/xml"
    assert b"ENVELOPE" in exec_response.content
    assert b"Receipt" in exec_response.content
    assert b"Payment" in exec_response.content
    
    # 7. Check balance after conversion (should be 100 - 15 = 85)
    bal_response2 = client.get("/api/wallet/balance", headers=headers)
    assert bal_response2.json()["page_credits"] == 85
    
    # 8. Check duplicate warning on uploading same file again
    with open(PDF_PATH, "rb") as f:
        dup_response = client.post(
            "/api/convert/upload",
            headers=headers,
            data={"bank_name": "State Bank of India"},
            files={"file": ("01.pdf", f, "application/pdf")}
        )
    assert dup_response.status_code == 200
    assert dup_response.json()["is_duplicate"] is True
    
    # Cleanup duplicate temp file
    dup_temp_id = dup_response.json()["temp_file_id"]
    dup_temp_path = os.path.join(settings.TEMP_UPLOAD_DIR, f"{dup_temp_id}.pdf")
    if os.path.exists(dup_temp_path):
        os.remove(dup_temp_path)
        
    # 9. Verify history
    history_response = client.get("/api/convert/history", headers=headers)
    assert history_response.status_code == 200
    history_data = history_response.json()
    assert len(history_data) == 1
    assert history_data[0]["pages_count"] == 15
    assert history_data[0]["status"] == "SUCCESS"
    
    # 9.5. Test downloading cached XML from history
    conversion_id = history_data[0]["id"]
    dl_response = client.get(f"/api/convert/download-xml/{conversion_id}", headers=headers)
    assert dl_response.status_code == 200
    assert dl_response.headers["content-type"] == "application/xml"
    assert b"ENVELOPE" in dl_response.content
    
    # 10. Purchase page credits (₹25 for 100 pages, initially PENDING)
    purchase_response = client.post(
        "/api/wallet/purchase",
        headers=headers,
        json={"pages": 100, "amount": 25.0}
    )
    assert purchase_response.status_code == 200
    tx_id = purchase_response.json()["id"]
    assert purchase_response.json()["status"] == "PENDING"
    
    # 10.5. Login as admin and approve the payment ticket
    admin_login = client.post("/api/auth/login", json={"email": "admin@sheetbuddy.com", "password": "adminpassword"})
    admin_headers = {"Authorization": f"Bearer {admin_login.json()['access_token']}"}
    approve_response = client.post(f"/api/admin/payments/{tx_id}/approve", headers=admin_headers)
    assert approve_response.status_code == 200
    
    # Verify balance is updated now
    bal_response = client.get("/api/wallet/balance", headers=headers)
    assert bal_response.status_code == 200
    assert bal_response.json()["page_credits"] == 185
    
    # Verify wallet transactions list
    tx_list_response = client.get("/api/wallet/transactions", headers=headers)
    assert tx_list_response.status_code == 200
    tx_data = tx_list_response.json()
    assert len(tx_data) == 3  # ONBOARDING (100), CONVERSION DEBIT (-15), PURCHASE (100)
    assert tx_data[0]["pages_purchased"] == 100 # purchase is latest
    assert tx_data[0]["status"] == "APPROVED"
    assert tx_data[1]["pages_purchased"] == -15 # debit
    assert tx_data[2]["pages_purchased"] == 100 # onboarding

def test_conversion_overrides_and_simulators():
    import uuid
    email = f"override_tester_{uuid.uuid4()}@example.com"
    # Pre-seed verified User directly
    create_test_user(email, "mypassword", page_credits=100)
    
    login_res = client.post("/api/auth/login", json={"email": email, "password": "mypassword"})
    headers = {"Authorization": f"Bearer {login_res.json()['access_token']}"}
    
    # Upload test PDF using Axis Bank
    axis_pdf_path = r"c:\Users\aakas\OneDrive\Desktop\credentials\3.pdf"
    with open(axis_pdf_path, "rb") as f:
        up_res = client.post(
            "/api/convert/upload",
            headers=headers,
            data={"bank_name": "Axis Bank"},
            files={"file": ("axis_test.pdf", f, "application/pdf")}
        )
    assert up_res.status_code == 200
    data = up_res.json()
    assert "Axis Bank" in data["bank_name"]
    assert len(data["transactions_preview"]) > 0
    
    # Execute conversion with custom parameters and narration edits
    temp_id = data["temp_file_id"]
    exec_res = client.post(
        "/api/convert/execute",
        headers=headers,
        data={
            "temp_file_id": temp_id,
            "tally_bank_ledger_name": "Axis Bank Account",
            "bank_name": "Axis Bank",
            "counter_ledger_name": "My Custom Counter Ledger",
            "credit_voucher_type": "Sales",
            "debit_voucher_type": "Purchase",
            "edited_narrations": '{"0": "CUSTOM EDITED AXIS NARRATION"}'
        }
    )
    assert exec_res.status_code == 200
    xml_content = exec_res.content
    assert b"My Custom Counter Ledger" in xml_content
    assert b"Sales" in xml_content
    assert b"Purchase" in xml_content
    assert b"CUSTOM EDITED AXIS NARRATION" in xml_content

def test_wallet_pricing_and_redemption():
    import uuid
    email = f"wallet_tester_{uuid.uuid4()}@example.com"
    # Pre-seed verified User directly
    create_test_user(email, "mypassword", page_credits=100)
    
    login_res = client.post("/api/auth/login", json={"email": email, "password": "mypassword"})
    headers = {"Authorization": f"Bearer {login_res.json()['access_token']}"}
    
    # 1. Test pricing volume discounts (25 paise base price with bulk bonuses)
    # Starter pack: 100 pages -> should be ₹25.00
    res_100 = client.post("/api/wallet/purchase", headers=headers, json={"pages": 100, "amount": 25.0})
    assert res_100.status_code == 200
    tx_100_id = res_100.json()["id"]
    
    # Standard pack: 500 pages -> should be ₹125.00 (+200 free)
    res_500 = client.post("/api/wallet/purchase", headers=headers, json={"pages": 500, "amount": 125.0})
    assert res_500.status_code == 200
    tx_500_id = res_500.json()["id"]
    
    # Business pack: 1000 pages -> should be ₹250.00 (+500 free)
    res_1000 = client.post("/api/wallet/purchase", headers=headers, json={"pages": 1000, "amount": 250.0})
    assert res_1000.status_code == 200
    tx_1000_id = res_1000.json()["id"]
    
    # Invalid price check (trying to pay incorrect amount)
    res_invalid = client.post("/api/wallet/purchase", headers=headers, json={"pages": 100, "amount": 100.0})
    assert res_invalid.status_code == 400
    
    # Approve all three purchases as admin
    admin_login = client.post("/api/auth/login", json={"email": "admin@sheetbuddy.com", "password": "adminpassword"})
    admin_headers = {"Authorization": f"Bearer {admin_login.json()['access_token']}"}
    for tx_id in [tx_100_id, tx_500_id, tx_1000_id]:
        approve_res = client.post(f"/api/admin/payments/{tx_id}/approve", headers=admin_headers)
        assert approve_res.status_code == 200
    
    # 2. Test Easter Egg redemption code
    # Submit invalid code
    res_bad_code = client.post("/api/wallet/redeem", headers=headers, json={"code": "INVALID-CODE"})
    assert res_bad_code.status_code == 400
    
    # Submit correct code -> should succeed and add 50 credits
    res_redeem = client.post("/api/wallet/redeem", headers=headers, json={"code": "BUDDY-EASTER-50"})
    assert res_redeem.status_code == 200
    assert res_redeem.json()["page_credits"] == 2100  # 100 (promo) + 100 + 600 + 1250 + 50
    
    # Submit duplicate code -> should fail (once in a lifetime)
    res_dup_redeem = client.post("/api/wallet/redeem", headers=headers, json={"code": "BUDDY-EASTER-50"})
    assert res_dup_redeem.status_code == 400
    assert "already redeemed" in res_dup_redeem.json()["detail"].lower()

def test_admin_endpoints():
    # Login as seeded default admin user
    login_res = client.post("/api/auth/login", json={"email": "admin@sheetbuddy.com", "password": "adminpassword"})
    assert login_res.status_code == 200
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    
    # Check List users
    users_res = client.get("/api/admin/users", headers=headers)
    assert users_res.status_code == 200
    users = users_res.json()
    assert len(users) >= 1
    # Check if admin user is marked is_admin
    admin_record = [u for u in users if u["email"] == "admin@sheetbuddy.com"][0]
    assert admin_record["is_admin"] is True
    
    # Check System Stats
    stats_res = client.get("/api/admin/stats", headers=headers)
    assert stats_res.status_code == 200
    stats = stats_res.json()
    assert "total_users" in stats
    assert "total_conversions" in stats
    assert "total_credits" in stats
    assert "total_revenue" in stats
    
    # Check Global Conversions list
    convs_res = client.get("/api/admin/conversions", headers=headers)
    assert convs_res.status_code == 200
    
    # Check Global Payments list
    payments_res = client.get("/api/admin/payments", headers=headers)
    assert payments_res.status_code == 200
    
    # Test Toggle Admin status of a user
    import uuid
    email = f"user_for_admin_test_{uuid.uuid4()}@example.com"
    create_user_res = client.post(
        "/api/admin/users",
        headers=headers,
        json={
            "email": email,
            "password": "testpassword",
            "page_credits": 100,
            "is_admin": False
        }
    )
    assert create_user_res.status_code == 200
    
    # Fetch that user ID
    all_users = client.get("/api/admin/users", headers=headers).json()
    user_rec = [u for u in all_users if u["email"] == email][0]
    user_id = user_rec["id"]
    assert user_rec["is_admin"] is False
    
    # Toggle to true
    toggle_res1 = client.post(f"/api/admin/users/{user_id}/toggle-admin", headers=headers)
    assert toggle_res1.status_code == 200
    assert toggle_res1.json()["is_admin"] is True
    
    # Toggle back to false
    toggle_res2 = client.post(f"/api/admin/users/{user_id}/toggle-admin", headers=headers)
    assert toggle_res2.status_code == 200
    assert toggle_res2.json()["is_admin"] is False
    
    # Test Adjust Wallet Credits
    adjust_res = client.post(
        f"/api/admin/users/{user_id}/credits",
        headers=headers,
        json={"credits": 250}
    )
    assert adjust_res.status_code == 200
    assert adjust_res.json()["new_credits"] == 350  # 100 (promo) + 250
    
    # Test Supported Bank configurations CRUD
    banks_res = client.get("/api/admin/banks", headers=headers)
    assert banks_res.status_code == 200
    banks = banks_res.json()
    assert len(banks) >= 3  # SBI, BOB, AXIS
    
    # Create new configuration
    new_bank_payload = {
        "bank_key": "testbank",
        "name": "Test Bank PLC",
        "match_patterns": "TESTBANK,TESTINGBANK",
        "parser_type": "SIMULATOR",
        "config_json": '{"opening_balance": 20000.0, "mock_prefix": "MOCK TEST TXN"}'
    }
    create_res = client.post("/api/admin/banks", headers=headers, json=new_bank_payload)
    assert create_res.status_code == 200
    new_bank_id = create_res.json()["id"]
    
    # Update configuration
    new_bank_payload["name"] = "Updated Test Bank PLC"
    update_res = client.put(f"/api/admin/banks/{new_bank_id}", headers=headers, json=new_bank_payload)
    assert update_res.status_code == 200
    assert update_res.json()["name"] == "Updated Test Bank PLC"
    
    # Delete configuration
    del_res = client.delete(f"/api/admin/banks/{new_bank_id}", headers=headers)
    assert del_res.status_code == 200
    
    # Ordinary user try block
    norm_login = client.post("/api/auth/login", json={"email": email, "password": "testpassword"})
    norm_headers = {"Authorization": f"Bearer {norm_login.json()['access_token']}"}
    blocked_res = client.get("/api/admin/users", headers=norm_headers)
    assert blocked_res.status_code == 403

    # Test Support Query creation by user
    query_payload = {
        "subject": "Missing Credit balance",
        "description": "I purchased starter pack but my credits are not showing up.",
        "whatsapp_number": "+91 92049 15729"
    }
    q_create_res = client.post("/api/support/query", headers=norm_headers, json=query_payload)
    assert q_create_res.status_code == 200
    assert q_create_res.json()["subject"] == "Missing Credit balance"
    assert q_create_res.json()["whatsapp_number"] == "+91 92049 15729"

    # Test Support Queries listing by admin
    admin_queries_res = client.get("/api/admin/support-queries", headers=headers)
    assert admin_queries_res.status_code == 200
    queries_list = admin_queries_res.json()
    assert len(queries_list) >= 1
    assert queries_list[0]["subject"] == "Missing Credit balance"
    assert queries_list[0]["whatsapp_number"] == "+91 92049 15729"

    # Test Promo Code creation by admin
    promo_payload = {
        "code": "TESTUNIV",
        "credits": 150,
        "type": "UNIVERSAL_ONCE"
    }
    promo_create_res = client.post("/api/admin/promo-codes", headers=headers, json=promo_payload)
    assert promo_create_res.status_code == 200
    assert promo_create_res.json()["code"] == "TESTUNIV"
    assert promo_create_res.json()["credits"] == 150

    # Test Promo Code listing by admin
    promo_list_res = client.get("/api/admin/promo-codes", headers=headers)
    assert promo_list_res.status_code == 200
    assert len(promo_list_res.json()) >= 1

    # Redeem universal code by user
    redeem_res = client.post("/api/wallet/redeem", headers=norm_headers, json={"code": "TESTUNIV"})
    assert redeem_res.status_code == 200
    assert redeem_res.json()["page_credits"] == 500  # 350 (initial) + 150 (promo)

    # Try duplicate redeem (should fail)
    dup_redeem_res = client.post("/api/wallet/redeem", headers=headers, json={"code": "TESTUNIV"})
    assert dup_redeem_res.status_code == 400

    # Create expired time-based promo code
    expired_payload = {
        "code": "TESTEXPIRED",
        "credits": 200,
        "type": "TIME_BASED",
        "expires_at": "2020-01-01T00:00:00"
    }
    expired_create_res = client.post("/api/admin/promo-codes", headers=headers, json=expired_payload)
    assert expired_create_res.status_code == 200

    # Try redeeming expired code (should fail)
    expired_redeem_res = client.post("/api/wallet/redeem", headers=norm_headers, json={"code": "TESTEXPIRED"})
    assert expired_redeem_res.status_code == 400

def test_excel_to_xml_utility():
    import io
    import openpyxl
    import uuid
    
    # 1. Register a user who has NOT purchased a plan
    unpaid_email = f"unpaid_{uuid.uuid4()}@example.com"
    create_test_user(unpaid_email, "password", page_credits=10, is_admin=False)
    
    unpaid_login = client.post("/api/auth/login", json={"email": unpaid_email, "password": "password"})
    unpaid_headers = {"Authorization": f"Bearer {unpaid_login.json()['access_token']}"}
    
    # Check that download template returns 403 Forbidden
    unpaid_dl_res = client.get("/api/convert/excel-template", headers=unpaid_headers)
    assert unpaid_dl_res.status_code == 403
    
    # 2. Register/Pre-seed a user with a plan purchase
    paid_email = f"paid_{uuid.uuid4()}@example.com"
    user_obj = create_test_user(paid_email, "password", page_credits=100, is_admin=False)
    
    db = TestingSessionLocal()
    from app.models.models import User, WalletTransaction
    user_db = db.query(User).filter_by(email=paid_email).first()
    tx = WalletTransaction(
        user_id=user_db.id,
        amount_in_inr=500.0,
        pages_purchased=100,
        type="PURCHASE",
        status="APPROVED",
        description="Bought starter pack"
    )
    db.add(tx)
    db.commit()
    db.close()
    
    paid_login = client.post("/api/auth/login", json={"email": paid_email, "password": "password"})
    paid_headers = {"Authorization": f"Bearer {paid_login.json()['access_token']}"}
    
    # Check that download template succeeds for paid user
    paid_dl_res = client.get("/api/convert/excel-template", headers=paid_headers)
    assert paid_dl_res.status_code == 200
    assert paid_dl_res.headers["content-type"] == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    
    # Generate a dummy filled-out excel template
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["Date (DD-MM-YYYY)", "Narration", "Reference No", "Debit", "Credit", "Balance"])
    ws.append(["28-08-2026", "Test Excel Receipt", "REF123", "", "1200.50", "1200.50"])
    ws.append(["29-08-2026", "Test Excel Payment", "REF456", "300.00", "", "900.50"])
    
    excel_io = io.BytesIO()
    wb.save(excel_io)
    excel_io.seek(0)
    
    # Upload and convert
    convert_res = client.post(
        "/api/convert/excel-to-xml",
        headers=paid_headers,
        files={"file": ("test.xlsx", excel_io, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        data={
            "bank_ledger_name": "HDFC Bank",
            "counter_ledger_name": "Suspense A/c",
            "credit_voucher_type": "Receipt",
            "debit_voucher_type": "Payment"
        }
    )
    assert convert_res.status_code == 200
    assert convert_res.headers["content-type"] == "application/xml"
    xml_content = convert_res.content.decode("utf-8")
    assert "Test Excel Receipt" in xml_content
    assert "Test Excel Payment" in xml_content
    assert "HDFC Bank" in xml_content
    assert "Suspense A/c" in xml_content





