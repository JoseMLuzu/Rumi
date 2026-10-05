import os

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker


DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError(
        "Set DATABASE_URL before starting Flask or seeding the database. "
        "See backend/README.md for the local development commands."
    )
if not DATABASE_URL.startswith("postgresql+psycopg://"):
    raise RuntimeError("DATABASE_URL must use postgresql+psycopg://")

# The engine shares connections; each request gets its own short-lived session.
engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()
