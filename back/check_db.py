from database.db_connection import engine
from sqlalchemy import text

with engine.connect() as conn:
    row = conn.execute(text("SELECT MIN(game_date), MAX(game_date), COUNT(*) FROM games")).fetchone()
    print("MIN:", row[0], "| MAX:", row[1], "| COUNT:", row[2])
