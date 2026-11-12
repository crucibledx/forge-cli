import os

import asyncpg

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://localhost/orders")


async def connect() -> asyncpg.Connection:
    return await asyncpg.connect(DATABASE_URL)
