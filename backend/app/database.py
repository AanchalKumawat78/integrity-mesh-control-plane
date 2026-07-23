import logging
import os

from sqlalchemy import create_engine, text
from sqlalchemy.orm import declarative_base, sessionmaker

logger = logging.getLogger("uvicorn.error")

DEFAULT_DATABASE_URL = "sqlite:///./data/ops_control_secure.db"
DATABASE_URL = os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL).strip() or DEFAULT_DATABASE_URL


def _create_resilient_engine(db_url: str):
    connect_args = {"check_same_thread": False} if db_url.startswith("sqlite") else {}
    try:
        test_engine = create_engine(db_url, connect_args=connect_args)
        if not db_url.startswith("sqlite"):
            with test_engine.connect() as conn:
                conn.execute(text("SELECT 1"))
        return test_engine
    except Exception as exc:
        logger.warning(
            f"Database connection to '{db_url}' failed ({exc}). Falling back to SQLite."
        )
        return create_engine(DEFAULT_DATABASE_URL, connect_args={"check_same_thread": False})


engine = _create_resilient_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

