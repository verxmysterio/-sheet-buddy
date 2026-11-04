import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.models.database import Base, engine, get_db, SessionLocal
from app.models.models import User, Client, Conversion
from app.core.security import hash_password, create_access_token

@pytest.fixture
def test_client_and_token():
    with TestClient(app) as client:
        if get_db in app.dependency_overrides:
            db_gen = app.dependency_overrides[get_db]()
            db = next(db_gen)
            # Ensure tables in override engine
            bind_engine = db.get_bind()
            Base.metadata.create_all(bind=bind_engine)
        else:
            Base.metadata.create_all(bind=engine)
            db = SessionLocal()

        user_email = "ca_practitioner@sheetbuddy.com"
        user = db.query(User).filter(User.email == user_email).first()
        if not user:
            user = User(
                email=user_email,
                hashed_password=hash_password("capassword123"),
                page_credits=500,
                is_verified=True,
                is_admin=False
            )
            db.add(user)
            db.commit()
            db.refresh(user)
        token = create_access_token({"sub": user.email})
        headers = {"Authorization": f"Bearer {token}"}
        yield client, headers, user.id
        db.close()

def test_clients_crud_and_dossier(test_client_and_token):
    client, headers, user_id = test_client_and_token
    
    # 1. Create client
    create_payload = {
        "name": "Sharma & Sons Traders",
        "pan": "ABCDE1234F",
        "gstin": "07ABCDE1234F1Z5",
        "email": "sharma@traders.com",
        "phone": "+91 9876543210",
        "financial_year": "2024-25",
        "business_type": "Partnership",
        "notes": "Retail electronics distributor"
    }
    res = client.post("/api/convert/clients", json=create_payload, headers=headers)
    assert res.status_code == 200, res.text
    client_data = res.json()
    client_id = client_data["id"]
    assert client_data["name"] == "Sharma & Sons Traders"
    assert client_data["pan"] == "ABCDE1234F"
    assert client_data["financial_year"] == "2024-25"

    # 2. List clients
    res = client.get("/api/convert/clients", headers=headers)
    assert res.status_code == 200
    clients_list = res.json()
    assert any(c["id"] == client_id for c in clients_list)

    # 3. Update client
    update_payload = {
        "notes": "Updated notes - electronics distributor in Delhi",
        "financial_year": "2025-26"
    }
    res = client.put(f"/api/convert/clients/{client_id}", json=update_payload, headers=headers)
    assert res.status_code == 200
    assert res.json()["financial_year"] == "2025-26"

    # 4. Save Cloud XML for this client
    xml_data = {
        "client_id": client_id,
        "bank_name": "State Bank of India",
        "file_name": "Tally_Import_Sharma_SBI_Oct2025.xml",
        "xml_content": "<ENVELOPE><BODY><DATA>Sample Tally Vouchers</DATA></BODY></ENVELOPE>",
        "statement_period": "01-10-2025 to 31-10-2025",
        "transactions_count": 45,
        "pages_count": 3,
        "opening_balance": 10500.0,
        "closing_balance": 98400.0,
        "source_type": "STATEMENT_PDF"
    }
    res = client.post("/api/convert/save-cloud-xml", json=xml_data, headers=headers)
    assert res.status_code == 200, res.text
    conv_id = res.json()["conversion_id"]

    # 5. Get Client Dossier
    res = client.get(f"/api/convert/clients/{client_id}/dossier", headers=headers)
    assert res.status_code == 200
    dossier = res.json()
    assert dossier["client"]["id"] == client_id
    assert dossier["total_statements"] >= 1
    assert dossier["total_vouchers"] >= 45
    assert len(dossier["monthly_matrix"]) == 12
    # October month should show completed
    oct_month = next((m for m in dossier["monthly_matrix"] if m["month"] == "October"), None)
    assert oct_month is not None
    assert oct_month["is_completed"] is True
    assert oct_month["vouchers_count"] == 45

    # 6. Verify Cloud Vault download
    res = client.get(f"/api/convert/download-xml/{conv_id}", headers=headers)
    assert res.status_code == 200
    assert "Sample Tally Vouchers" in res.text
    assert "application/xml" in res.headers["content-type"]

    # 7. Verify History contains client_name and xml_size_kb
    res = client.get("/api/convert/history", headers=headers)
    assert res.status_code == 200
    history = res.json()
    saved_entry = next((h for h in history if h["id"] == conv_id), None)
    assert saved_entry is not None
    assert saved_entry["client_name"] == "Sharma & Sons Traders"
    assert saved_entry["has_xml"] is True
    assert saved_entry["xml_size_kb"] > 0

    # 8. Delete saved XML from Cloud Vault
    res = client.delete(f"/api/convert/history/{conv_id}", headers=headers)
    assert res.status_code == 200

    # 9. Delete client
    res = client.delete(f"/api/convert/clients/{client_id}", headers=headers)
    assert res.status_code == 200
