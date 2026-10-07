import os

DB_PATH = os.environ.get("DB_PATH", "aqsms.db")
JWT_SECRET = os.environ.get("AQSMS_JWT_SECRET", "dev-secret-key-do-not-use-in-prod")
TOKEN_EXPIRY_HOURS = 24
PORT = 8000

# ESP32 API key must be provided in environment
ESP32_API_KEY = os.environ.get("AQSMS_ESP32_KEY")
