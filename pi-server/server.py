import datetime
import dateutil.parser
from flask import Flask, request, jsonify
from flask_cors import CORS
from config import PORT
from db import get_db, init_db
from auth import check_password, generate_token, token_required, check_password as check_hash

app = Flask(__name__)
CORS(app)

# Initialize DB
with app.app_context():
    init_db()

@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        "status": "ok",
        "timestamp": datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
    })

@app.route('/auth/login', methods=['POST'])
def login():
    data = request.get_json()
    if not data or not data.get('username') or not data.get('password'):
        return jsonify({'error': 'Missing credentials'}), 400
        
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM accounts WHERE username = ?", (data['username'],))
    user = cursor.fetchone()
    conn.close()
    
    if not user or not check_password(data['password'], user['password_hash']):
        return jsonify({'error': 'Invalid username or password'}), 401
        
    token = generate_token(user['username'])
    return jsonify({
        'token': token,
        'display_name': user['display_name']
    })

@app.route('/readings/latest', methods=['GET'])
@token_required
def get_latest_reading(current_user):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM readings ORDER BY timestamp DESC LIMIT 1")
    row = cursor.fetchone()
    conn.close()
    
    res = {"pond_name": "Test Pond 1", "reading": None}
    if row:
        res["reading"] = {
            "timestamp": row['timestamp'],
            "ph": row['ph'],
            "temperature_c": row['temperature_c'],
            "dissolved_oxygen_mg_l": row['dissolved_oxygen_mg_l']
        }
    return jsonify(res)

@app.route('/readings', methods=['GET'])
@token_required
def get_readings(current_user):
    limit = request.args.get('limit', default=50, type=int)
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM readings ORDER BY timestamp DESC LIMIT ?", (limit,))
    rows = cursor.fetchall()
    conn.close()
    
    readings = []
    for r in rows:
        readings.append({
            "timestamp": r['timestamp'],
            "ph": r['ph'],
            "temperature_c": r['temperature_c'],
            "dissolved_oxygen_mg_l": r['dissolved_oxygen_mg_l']
        })
    return jsonify({"readings": readings})

@app.route('/alerts', methods=['GET'])
@token_required
def get_alerts(current_user):
    limit = request.args.get('limit', default=50, type=int)
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM alerts ORDER BY timestamp DESC LIMIT ?", (limit,))
    rows = cursor.fetchall()
    conn.close()
    
    alerts = []
    for r in rows:
        alerts.append({
            "timestamp": r['timestamp'],
            "parameter": r['parameter'],
            "value": r['value'],
            "threshold": r['threshold'],
            "status": r['status'],
            "message": r['message']
        })
    return jsonify({"alerts": alerts})

@app.route('/thresholds', methods=['GET'])
@token_required
def get_thresholds(current_user):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM thresholds")
    rows = cursor.fetchall()
    conn.close()
    
    res = {"approved": False, "ph": {}, "temperature": {}, "dissolved_oxygen": {}}
    if rows:
        res["approved"] = bool(rows[0]['approved'])
        for r in rows:
            res[r['parameter']] = {
                "safe_min": r['safe_min'],
                "safe_max": r['safe_max'],
                "warn_min": r['warn_min'],
                "warn_max": r['warn_max']
            }
    return jsonify(res)

def verify_esp32_key(request):
    api_key = request.headers.get('X-API-Key')
    if not api_key:
        return False
        
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT key_hash FROM esp32_keys")
    rows = cursor.fetchall()
    conn.close()
    
    for row in rows:
        if check_hash(api_key, row['key_hash']):
            return True
    return False

@app.route('/esp32/readings', methods=['POST'])
def esp32_readings():
    if not verify_esp32_key(request):
        return jsonify({"error": "Unauthorized API Key"}), 401
        
    data = request.get_json()
    if not data or not data.get('timestamp'):
        return jsonify({"error": "Missing timestamp"}), 400
        
    try:
        dateutil.parser.isoparse(data['timestamp'])
    except ValueError:
        return jsonify({"error": "Invalid timestamp format. Must be ISO-8601"}), 400

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO readings (timestamp, ph, temperature_c, dissolved_oxygen_mg_l)
        VALUES (?, ?, ?, ?)
    ''', (
        data['timestamp'],
        data.get('ph'),
        data.get('temperature_c'),
        data.get('dissolved_oxygen_mg_l')
    ))
    conn.commit()
    conn.close()
    
    return jsonify({"message": "Reading created"}), 201

@app.route('/esp32/alerts', methods=['POST'])
def esp32_alerts():
    if not verify_esp32_key(request):
        return jsonify({"error": "Unauthorized API Key"}), 401
        
    data = request.get_json()
    if not data or not data.get('timestamp') or not data.get('parameter') or not data.get('status'):
        return jsonify({"error": "Missing required fields"}), 400
        
    if data['status'] not in ['warning', 'unsafe']:
        return jsonify({"error": "Invalid status value"}), 400
        
    try:
        dateutil.parser.isoparse(data['timestamp'])
    except ValueError:
        return jsonify({"error": "Invalid timestamp format. Must be ISO-8601"}), 400

    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute('''
            INSERT INTO alerts (timestamp, parameter, value, threshold, status, message)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', (
            data['timestamp'],
            data['parameter'],
            data.get('value'),
            data.get('threshold'),
            data['status'],
            data.get('message')
        ))
        conn.commit()
    except Exception as e:
        conn.close()
        return jsonify({"error": str(e)}), 400
    conn.close()
    
    return jsonify({"message": "Alert created"}), 201

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=PORT)
