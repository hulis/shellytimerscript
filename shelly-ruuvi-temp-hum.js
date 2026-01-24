/***********************
 * USER CONFIGURATION *
 ***********************/

// RuuviTag BLE
let RUUVI_MAC = "AA:BB:CC:DD:EE:FF"; // <-- Ruuvitab bluetooth MAC

// Temperature (°C)
let TEMP_ALWAYS_ON = 24.0;   // Fan on always if temperature over this limit

// Humidity (%)
let HUMIDITY_THRESHOLD = 70.0;  // Fan starts if this humidity value is exceeded
let HUMIDITY_ON_TIME = 5 * 60 * 1000; // Runtime after starting 5 min

// Fallback (If ruuvitag disconnected run based on these values)
let FALLBACK_ON_TIME = 3 * 60 * 1000; // 3 min päällä
let FALLBACK_OFF_TIME = 10 * 60 * 1000; // 10 min pois

// BLE timeout
let BLE_TIMEOUT = 2 * 60 * 1000; // 2 min

/***********************
 * GLOBAL VARIABLES   *
 ***********************/
let bleAvailable = false;
let lastSeen = 0;
let temperature = null;
let humidity = null;

let fallbackTimer = null;
let humidityTimer = null;


/***********************
 * SWITCH HELPERS     *
 ***********************/
function fanOn() {
  Shelly.call("Switch.Set", { id: 0, on: true });
}

function fanOff() {
  Shelly.call("Switch.Set", { id: 0, on: false });
}


/***********************
 * FALLBACK CYCLE     *
 ***********************/
function startFallbackCycle() {
  if (fallbackTimer) return;

  fanOn();
  fallbackTimer = Timer.set(FALLBACK_ON_TIME, false, function () {
    fanOff();
    fallbackTimer = Timer.set(FALLBACK_OFF_TIME, false, function () {
      fallbackTimer = null;
      startFallbackCycle();
    });
  });
}

function stopFallbackCycle() {
  if (fallbackTimer) {
    Timer.clear(fallbackTimer);
    fallbackTimer = null;
  }
}


/***********************
 * SENSOR EVALUATION  *
 ***********************/
function evaluateSensor() {
  if (!bleAvailable) {
    startFallbackCycle();
    return;
  }

  stopFallbackCycle();

  // 1) Lämpötila aina päällä
  if (temperature !== null && temperature > TEMP_ALWAYS_ON) {
    fanOn();
    return;
  }

  // 2) Kosteusajastus
  if (
    temperature !== null &&
    humidity !== null &&
    temperature <= TEMP_ALWAYS_ON &&
    humidity > HUMIDITY_THRESHOLD
  ) {
    if (!humidityTimer) {
      fanOn();
      humidityTimer = Timer.set(HUMIDITY_ON_TIME, false, function () {
        humidityTimer = null;
        fanOff();
      });
    }
    return;
  }

  // 3) Muulloin pois
  if (!humidityTimer) {
    fanOff();
  }
}


/***********************
 * BLE SCANNER        *
 ***********************/
BLE.Scanner.Start({
  duration_ms: 0,
  active: true
});

BLE.Scanner.onScan(function (res) {
  if (!res.addr || res.addr !== RUUVI_MAC) return;
  if (!res.service_data || !res.service_data["FEAA"]) return;

  let data = res.service_data["FEAA"];
  let bytes = data.slice(4);

  // Temperature
  let tRaw = (bytes[0] << 8) | bytes[1];
  if (tRaw & 0x8000) tRaw -= 0x10000;
  temperature = tRaw / 200.0;

  // Humidity
  let hRaw = (bytes[2] << 8) | bytes[3];
  humidity = hRaw / 400.0;

  lastSeen = Date.now();
  bleAvailable = true;

  evaluateSensor();
});


/***********************
 * BLE TIMEOUT CHECK  *
 ***********************/
Timer.set(30000, true, function () {
  if (bleAvailable && Date.now() - lastSeen > BLE_TIMEOUT) {
    bleAvailable = false;
    temperature = null;
    humidity = null;
    console.log("BLE sensor lost -> fallback cycle active");
    evaluateSensor();
  }
});
