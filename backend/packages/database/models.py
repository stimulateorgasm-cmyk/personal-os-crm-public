"""SQLAlchemy models — mirrors current SQLite schema."""
from sqlalchemy import Column, Integer, String, Float, Text, ForeignKey, Index
from sqlalchemy.orm import relationship
from packages.database.db import Base


class Client(Base):
    __tablename__ = "clients"

    id = Column(Integer, primary_key=True, autoincrement=True)
    notion_page_id = Column(String, default="")
    name = Column(String, default="", nullable=False)
    telegram_nick = Column(String, default="")
    telegram_id = Column(String, default="")
    phone = Column(String, default="")
    status = Column(String, default="Контакт")
    source = Column(String, default="")
    last_account = Column(String, default="")
    last_contact = Column(String, default="")
    next_step = Column(String, default="")
    summary = Column(Text, default="")
    follow_up_date = Column(String, default="")
    created_at = Column(String, default="")
    updated_at = Column(String, default="")

    deals = relationship("Deal", back_populates="client")
    tasks = relationship("Task", back_populates="client")
    test_results = relationship("TestResult", back_populates="client")
    notes = relationship("Note", back_populates="client")
    telegram_messages = relationship("TelegramMessage", back_populates="client")


class Deal(Base):
    __tablename__ = "deals"

    id = Column(Integer, primary_key=True, autoincrement=True)
    notion_page_id = Column(String, default="")
    client_id = Column(Integer, ForeignKey("clients.id"))
    title = Column(String, nullable=False)
    status = Column(String, default="Ожидает")
    amount = Column(Float, default=0)
    paid = Column(Float, default=0)
    purchase_date = Column(String, default="")
    created_at = Column(String, default="")
    updated_at = Column(String, default="")

    client = relationship("Client", back_populates="deals")


class TestResult(Base):
    __tablename__ = "test_results"

    id = Column(Integer, primary_key=True, autoincrement=True)
    client_id = Column(Integer, ForeignKey("clients.id"))
    telegram_id = Column(String, default="")
    name = Column(String, default="")
    phone = Column(String, default="")
    age = Column(Integer, nullable=True)
    test_type = Column(String, default="female")
    freedom_score = Column(Integer, default=0)
    sexuality_score = Column(Integer, default=0)
    diagnosis = Column(String, default="")
    utm_source = Column(String, default="")
    answers = Column(Text, default="[]")
    created_at = Column(String, default="")

    client = relationship("Client", back_populates="test_results")


class Task(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    client_id = Column(Integer, ForeignKey("clients.id"))
    title = Column(String, nullable=False)
    type = Column(String, default="follow_up")
    due_date = Column(String, default="")
    status = Column(String, default="pending")
    created_at = Column(String, default="")

    client = relationship("Client", back_populates="tasks")


class Note(Base):
    __tablename__ = "notes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    client_id = Column(Integer, ForeignKey("clients.id"))
    text = Column(Text, nullable=False)
    created_at = Column(String, default="")

    client = relationship("Client", back_populates="notes")


class TelegramMessage(Base):
    __tablename__ = "telegram_messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    client_id = Column(Integer, ForeignKey("clients.id"))
    telegram_id = Column(String, default="")
    sender_type = Column(String, default="client")
    text = Column(Text, default="")
    created_at = Column(String, default="")

    client = relationship("Client", back_populates="telegram_messages")

    __table_args__ = (
        Index("idx_tg_client", "client_id"),
        Index("idx_tg_created", "created_at"),
    )


class MiraSession(Base):
    __tablename__ = "mira_sessions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String, default="Новый чат")
    created_at = Column(String, default="")
    updated_at = Column(String, default="")

    messages = relationship("MiraMessage", back_populates="session")


class MiraMessage(Base):
    __tablename__ = "mira_messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(Integer, ForeignKey("mira_sessions.id"))
    role = Column(String, default="user")
    content = Column(Text, default="")
    created_at = Column(String, default="")

    session = relationship("MiraSession", back_populates="messages")

    __table_args__ = (
        Index("idx_mira_session", "session_id"),
    )


class QuizMeta(Base):
    __tablename__ = "quiz_meta"

    key = Column(String, primary_key=True)
    value = Column(String, nullable=False)


class QuizEvent(Base):
    __tablename__ = "quiz_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    event = Column(String, default="")
    metadata_json = Column("metadata", Text, default="{}")
    created_at = Column(String, default="")


class AdChannel(Base):
    __tablename__ = "ad_channels"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, default="", nullable=False)
    category = Column(String, default="")
    link = Column(String, default="")
    admin_nick = Column(String, default="")
    contact = Column(String, default="")
    price = Column(Float, default=0)
    comment = Column(Text, default="")
    status = Column(String, default="рассматриваю")
    created_at = Column(String, default="")


class AdPurchase(Base):
    __tablename__ = "ad_purchases"

    id = Column(Integer, primary_key=True, autoincrement=True)
    channel_id = Column(Integer, ForeignKey("ad_channels.id"), nullable=True)
    channel_name = Column(String, default="")
    month = Column(String, default="")
    manager = Column(String, default="")
    date = Column(String, default="")
    platform = Column(String, default="telegram")  # telegram | instagram
    price = Column(Float, default=0)
    discount = Column(Float, default=0)
    final_price = Column(Float, default=0)
    growth = Column(Integer, default=0)            # прирост подписчиков
    coverage = Column(Integer, default=0)          # охват
    err = Column(Float, default=0)                 # ERR %
    cpm = Column(Float, default=0)
    link = Column(String, default="")
    status = Column(String, default="оплачено")
    consultations = Column(Integer, default=0)
    clients = Column(Integer, default=0)
    sales_sum = Column(Float, default=0)
    roi = Column(Float, default=0)                 # %
    created_at = Column(String, default="")


class AdPost(Base):
    __tablename__ = "ad_posts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    purchase_id = Column(Integer, ForeignKey("ad_purchases.id"), nullable=True)
    channel = Column(String, default="")
    link = Column(String, default="")
    views = Column(Integer, default=0)
    subscribers_gained = Column(Integer, default=0)
    clicks = Column(Integer, default=0)
    target_action = Column(String, default="")     # тест | личка | чат мероприятия
    created_at = Column(String, default="")
    last_synced_at = Column(String, default="")


class SocialMetric(Base):
    __tablename__ = "social_metrics"

    id = Column(Integer, primary_key=True, autoincrement=True)
    platform = Column(String, default="")
    account = Column(String, default="")
    metric_type = Column(String, default="")       # followers | coverage | views
    value = Column(Integer, default=0)
    date = Column(String, default="")
