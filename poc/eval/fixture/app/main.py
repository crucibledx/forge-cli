from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="orders-service")

ORDERS: dict[int, dict] = {}


class OrderIn(BaseModel):
    sku: str
    quantity: int


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/orders", status_code=201)
def create_order(order: OrderIn) -> dict:
    order_id = len(ORDERS) + 1
    ORDERS[order_id] = {"id": order_id, **order.model_dump()}
    return ORDERS[order_id]


@app.get("/orders/{order_id}")
def get_order(order_id: int) -> dict:
    if order_id not in ORDERS:
        raise HTTPException(status_code=404, detail="order not found")
    return ORDERS[order_id]
