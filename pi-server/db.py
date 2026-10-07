import sqlite3
from config import DB_PATH

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    cursor = conn.cursor()
    
    # accounts
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS accounts (
            id INTEGER PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            display_name TEXT NOT NULL
        )
    ''')
    
    # readings
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS readings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            ph REAL,
            temperature_c REAL,
            dissolved_oxygen_mg_l REAL
        )
    ''')
    
    # alerts
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            parameter TEXT NOT NULL CHECK(parameter IN ('ph','temperature','dissolved_oxygen')),
            value REAL,
            threshold TEXT,
            status TEXT NOT NULL CHECK(status IN ('warning','unsafe')),
            message TEXT
        )
    ''')
    
    # thresholds
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS thresholds (
            parameter TEXT PRIMARY KEY CHECK(parameter IN ('ph','temperature','dissolved_oxygen')),
            safe_min REAL,
            safe_max REAL,
            warn_min REAL,
            warn_max REAL,
            approved INTEGER NOT NULL DEFAULT 0
        )
    ''')
    
    # Initialize thresholds if empty
    cursor.execute("SELECT COUNT(*) FROM thresholds")
    if cursor.fetchone()[0] == 0:
        parameters = ['ph', 'temperature', 'dissolved_oxygen']
        for p in parameters:
            cursor.execute('''
                INSERT INTO thresholds (parameter, safe_min, safe_max, warn_min, warn_max, approved)
                VALUES (?, NULL, NULL, NULL, NULL, 0)
            ''', (p,))
            
    # esp32_keys
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS esp32_keys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key_hash TEXT NOT NULL,
            label TEXT,
            created_at TEXT NOT NULL
        )
    ''')
    
    conn.commit()
    conn.close()

if __name__ == '__main__':
    init_db()
