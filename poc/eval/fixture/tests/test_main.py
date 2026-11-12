from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    assert client.get("/health").json() == {"status": "ok"}


def test_create_and_get_order():
    created = client.post("/orders", json={"sku": "A-1", "quantity": 2}).json()
    assert client.get(f"/orders/{created['id']}").json()["sku"] == "A-1"
