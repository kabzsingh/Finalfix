# ESP32 Modbus Setup Guide

## Hardware Requirements

### ESP32 DevKit
- ESP32 Development Board
- USB Cable (for programming)
- Micro SD Card (optional, for logging)

### RS485 Interface
- RS485 TTL Converter Module (MAX485 or similar)
- Twisted pair cable for RS485 A/B lines

### Wiring

```
ESP32           RS485 Module      Modbus Device (PLC)
GPIO16 (RX) --> RO (Receive Out) 
GPIO17 (TX) --> DI (Driver In)
GPIO4 (DE)  --> DE (Driver Enable) [Optional]
GND         --> GND               --> GND
3.3V        --> VCC [if 3.3V]     
                                   
                                   A <-- RS485 A
                                   B <-- RS485 B
                                   GND <-- GND
```

## Software Setup

### 1. Arduino IDE Configuration

1. Install Arduino IDE 2.0+
2. Add ESP32 Board:
   - File → Preferences
   - Add: `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
   - Tools → Board Manager → Search "ESP32" → Install

### 2. Required Libraries

Install via Arduino IDE (Sketch → Include Library → Manage Libraries):

- **ArduinoJson** (by Benoit Blanchon)
  - Version 6.x or 7.x
  - Search: "ArduinoJson"
  
- **ModbusRTU** (by Anatoli Arkhipenko)
  - Search: "ModbusRTU"
  - Version 3.x+

- **WiFi** (built-in)
- **HTTPClient** (built-in)

### 3. Configuration

Edit these values in the sketch:

```cpp
// WiFi
const char* WIFI_SSID = "your_network_name";
const char* WIFI_PASS = "your_password";

// Device Key (Get from Admin panel)
const char* DEVICE_KEY = "your_device_key_here";

// Modbus Slave ID (usually 1 or 247)
#define MODBUS_SLAVE_ID 1

// Meter Registers (adjust to your PLC)
Meter meters[] = {
  {100, "wash", "Wash Counter"},      // Holding register 100
  {102, "fresh_water", "Water Liters"}, // Holding register 102
  {104, "chemical", "Chemical Level"}   // Holding register 104
};
```

## Getting Device Key

1. Go to **Admin Panel** (⚙️ icon)
2. Find your site in **Infrastructure Management**
3. Click site card to expand
4. Scroll to **Active ESP32 Access Keys**
5. Click **"+ New Key"**
6. Copy the key → Paste into sketch as `DEVICE_KEY`

## Upload to ESP32

1. Connect ESP32 via USB
2. Tools → Board → Select "ESP32 Dev Module"
3. Tools → Port → Select COM port
4. Sketch → Upload
5. Open Serial Monitor (115200 baud)

## Verify Connection

Serial monitor should show:

```
=== WashGrid ESP32 Modbus ===
Device Key: abc123...
Initializing Modbus RTU...
✓ Modbus RTU initialized
Connecting to WiFi: YourSSID
...
✓ WiFi connected
IP: 192.168.1.100
Time synced

--- Reading Modbus Registers ---
Wash Counter (Reg 100): 42890
  → Adding to payload
Fresh Water Liters (Reg 102): 156234
  → Adding to payload
Chemical Level (Reg 104): 0
  → Adding to payload

--- Sending to Cloud ---
URL: https://auto.washdashboard.workers.dev/api/public/ingest
Payload size: 285 bytes
HTTP Status: 200
✓ Data sent successfully!
```

## Troubleshooting

### WiFi Connection Failed
- Check SSID and password
- Ensure 2.4GHz WiFi (not 5GHz)
- Check signal strength

### Modbus Read Failed
- Check RS485 wiring
- Verify Modbus Slave ID (usually 1)
- Check baud rate (9600 is common)
- Use Modbus test tool to verify PLC

### HTTP Connection Failed
- Check internet connection
- Verify DEVICE_KEY is correct
- Check server URL is reachable
- Look at response error message

### No Data on Dashboard
- Check Admin → Reports page for errors
- Verify device key matches
- Check Modbus values are being read
- Look for "ERROR" in serial output

## Modbus Register Reference

Common registers for Wash Equipment:

| Register | Data Type | Description | PLC Model |
|----------|-----------|-------------|-----------|
| 100 | UINT32 | Wash counter (total) | Generic |
| 102 | UINT32 | Fresh water total (L) | Generic |
| 104 | INT16 | Chemical level (0=full, 1=low) | Generic |
| 106 | UINT16 | Temperature (°C × 10) | Generic |
| 108 | INT16 | Pressure (bar × 100) | Generic |

**Note:** Adjust register addresses based on your PLC documentation.

## Advanced: Custom Modbus Mapping

For different PLC types, modify the `meters[]` array:

```cpp
Meter meters[] = {
  {40100, "wash", "Wash Counter"},        // Different register
  {40200, "fresh_water", "Water Liters"},
  {40300, "chemical", "Chemical Sensor"}
};
```

## Performance Notes

- **Send Interval:** 5 minutes (300,000 ms)
  - Change in code: `#define SEND_INTERVAL`
  - More frequent = more cloud traffic
  - Less frequent = less responsive
  
- **Data Only Sent When Changed**
  - First meter always sent
  - Other meters only if value changed
  - Reduces unnecessary traffic

## Security

⚠️ **Important:**

- Device Key is like a password - keep it secret
- Don't commit code with real keys to GitHub
- Use environment variables for production
- Consider IP whitelisting in firewall

## Support

If issues persist:
1. Check serial output for error messages
2. Verify Modbus connection with PLC tool
3. Test HTTP endpoint with Postman
4. Check Admin panel for device key validity
