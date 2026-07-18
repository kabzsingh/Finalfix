/**
 * WashGrid ESP32 Modbus to Cloud Integration
 * 
 * Reads Modbus data from PLC/Device and sends to WashGrid Dashboard
 * Supports multiple meters: Wash Counter, Fresh Water, Chemicals
 * 
 * SETUP:
 * 1. Install libraries:
 *    - ArduinoJSON
 *    - WiFi (built-in)
 *    - HTTPClient (built-in)
 *    - ModbusRTU (jandrassy/ModbusRTU)
 * 
 * 2. Configure WiFi & Modbus settings below
 * 3. Get DEVICE_KEY from Admin panel → Site → ESP32 Keys
 * 4. Upload to ESP32
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <ModbusRTU.h>
#include <time.h>

// ============= CONFIGURATION =============

// WiFi Settings
const char* WIFI_SSID = "your_ssid";
const char* WIFI_PASS = "your_password";

// Device Settings
const char* DEVICE_KEY = "your_device_key_from_admin_panel";
const char* SERVER_URL = "https://auto.washdashboard.workers.dev/api/public/ingest";

// Modbus Serial Settings (RS485)
#define RS485_RX_PIN 16  // ESP32 GPIO16 → RS485 RO
#define RS485_TX_PIN 17  // ESP32 GPIO17 → RS485 DI
#define RS485_DE_PIN 4   // ESP32 GPIO4  → RS485 DE (optional)
#define MODBUS_BAUDRATE 9600
#define MODBUS_SLAVE_ID 1

// Meter Configuration
// Format: {register, type, description}
struct Meter {
  uint16_t registerAddress;  // Modbus register address
  const char* meterType;     // "wash", "fresh_water", "chemical"
  const char* description;   // Display name
};

Meter meters[] = {
  {100, "wash", "Wash Counter"},
  {102, "fresh_water", "Fresh Water Liters"},
  {104, "chemical", "Chemical Level"}
};

const int METER_COUNT = 3;

// Send interval (milliseconds)
#define SEND_INTERVAL 300000  // Send every 5 minutes

// ============= GLOBAL VARIABLES =============

ModbusRTU mb;
WiFiClient wifiClient;
unsigned long lastSendTime = 0;
uint32_t lastMeterValues[METER_COUNT] = {0};

// ============= SETUP =============

void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("\n\n=== WashGrid ESP32 Modbus ===");
  Serial.print("Device Key: ");
  Serial.println(DEVICE_KEY);
  
  // Initialize RS485
  Serial.println("Initializing Modbus RTU...");
  if (!mb.begin(MODBUS_BAUDRATE, SERIAL_8N1, RS485_RX_PIN, RS485_TX_PIN, RS485_DE_PIN)) {
    Serial.println("ERROR: Failed to initialize Modbus!");
    while(1) delay(1000);
  }
  
  mb.master();  // Set as Modbus master
  Serial.println("✓ Modbus RTU initialized");
  
  // Connect WiFi
  connectWiFi();
  
  // Set time for HTTPS
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  Serial.println("Waiting for NTP time sync...");
  time_t now = time(nullptr);
  int attempts = 0;
  while (now < 24 * 3600 && attempts < 20) {
    delay(500);
    Serial.print(".");
    now = time(nullptr);
    attempts++;
  }
  Serial.println();
  Serial.println("Time synced");
}

// ============= MAIN LOOP =============

void loop() {
  // Maintain WiFi connection
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi disconnected, reconnecting...");
    connectWiFi();
    return;
  }
  
  // Read Modbus and send at interval
  if (millis() - lastSendTime >= SEND_INTERVAL) {
    lastSendTime = millis();
    
    Serial.println("\n--- Reading Modbus Registers ---");
    
    // Build JSON payload
    DynamicJsonDocument doc(2048);
    JsonArray readings = doc.createNestedArray("readings");
    
    bool hasNewData = false;
    
    // Read each meter
    for (int i = 0; i < METER_COUNT; i++) {
      uint32_t value = readModbusRegister(meters[i].registerAddress);
      
      Serial.print(meters[i].description);
      Serial.print(" (Reg ");
      Serial.print(meters[i].registerAddress);
      Serial.print("): ");
      Serial.println(value);
      
      // Only send if value changed
      if (value != lastMeterValues[i] || i == 0) {  // Always send first meter
        hasNewData = true;
        lastMeterValues[i] = value;
        
        JsonObject reading = readings.createNestedObject();
        reading["device_key"] = DEVICE_KEY;
        reading["value"] = value;
        reading["type"] = "total";  // "total" for absolute counters
        
        // ISO 8601 timestamp
        time_t now = time(nullptr);
        char timestamp[30];
        strftime(timestamp, sizeof(timestamp), "%Y-%m-%dT%H:%M:%SZ", gmtime(&now));
        reading["recorded_at"] = timestamp;
        
        Serial.print("  → Adding to payload");
      }
    }
    
    // Send if we have data
    if (hasNewData) {
      sendToCloud(doc);
    } else {
      Serial.println("No new data to send");
    }
  }
  
  // Handle Modbus communication
  mb.task();
  delay(100);
}

// ============= FUNCTIONS =============

void connectWiFi() {
  Serial.print("Connecting to WiFi: ");
  Serial.println(WIFI_SSID);
  
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n✓ WiFi connected");
    Serial.print("IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\nERROR: WiFi connection failed!");
  }
}

uint32_t readModbusRegister(uint16_t registerAddress) {
  uint32_t value = 0;
  
  // Read holding register (Function 03)
  // Returns: 0xFFFFFFFF if error
  if (!mb.readHreg(MODBUS_SLAVE_ID, registerAddress, &value, 1, nullptr)) {
    Serial.print("  ERROR: Modbus read failed for register ");
    Serial.println(registerAddress);
    return lastMeterValues[registerAddress];  // Return last known value
  }
  
  return value;
}

void sendToCloud(const DynamicJsonDocument& payload) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("ERROR: WiFi not connected");
    return;
  }
  
  HTTPClient http;
  http.setConnectTimeout(5000);
  http.setTimeout(10000);
  
  // Add SSL certificate verification (optional but recommended)
  // http.setInsecure();  // Only for testing!
  
  Serial.println("\n--- Sending to Cloud ---");
  Serial.print("URL: ");
  Serial.println(SERVER_URL);
  
  http.begin(wifiClient, SERVER_URL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-site-api-key", DEVICE_KEY);
  
  String jsonString;
  serializeJson(payload, jsonString);
  
  Serial.print("Payload size: ");
  Serial.print(jsonString.length());
  Serial.println(" bytes");
  
  int httpCode = http.POST(jsonString);
  
  Serial.print("HTTP Status: ");
  Serial.println(httpCode);
  
  if (httpCode == 200 || httpCode == 201) {
    Serial.println("✓ Data sent successfully!");
    String response = http.getString();
    Serial.print("Response: ");
    Serial.println(response);
  } else if (httpCode > 0) {
    Serial.print("ERROR: HTTP ");
    Serial.println(httpCode);
    String response = http.getString();
    Serial.print("Response: ");
    Serial.println(response);
  } else {
    Serial.print("ERROR: Connection failed - ");
    Serial.println(http.errorToString(httpCode));
  }
  
  http.end();
}

// ============= HELPER: Print Debug Info =============

void printDebugInfo() {
  Serial.println("\n=== Debug Info ===");
  Serial.print("WiFi Status: ");
  switch (WiFi.status()) {
    case WL_CONNECTED: Serial.println("CONNECTED"); break;
    case WL_DISCONNECTED: Serial.println("DISCONNECTED"); break;
    case WL_CONNECTING: Serial.println("CONNECTING"); break;
    default: Serial.println("UNKNOWN");
  }
  Serial.print("Modbus Status: ");
  Serial.println(mb.isConnected(MODBUS_SLAVE_ID) ? "OK" : "FAILED");
  Serial.print("Last Send: ");
  Serial.print(millis() - lastSendTime);
  Serial.println(" ms ago");
}
