/***********************
 * USER CONFIGURATION *
 ***********************/

// Time window
let startHour = 15;
let startMinute = 0;

let endHour = 14;
let endMinute = 50;

// Cycle times
let onTime = 5 * 60 * 1000;    // 5 minutes ON
let offTime = 10 * 60 * 1000;  // 10 minutes OFF

// RuuviTag BLE settings
let RUUVI_MAC = "AA:BB:CC:DD:EE:FF"; // <-- CHANGE THIS
let TEMP_ON = 5.0;   // Plug ON below this temperature
let TEMP_OFF = 6.0;  // Plug OFF above this temperature
let BLE_TIMEOUT = 120000; // 2 minutes


/***********************
 * GLOBAL VARIABLES   *
 ***********************/
let cycleTimer = null;
let bleOverride = false;
let lastTemp = null;
let lastSeen = 0;


/***********************
 * TIME WINDOW LOGIC  *
 ***********************/
function isWithinTime() {
  let now = new Date();
  let nowMin = now.getHours() * 60 + now.getMinutes();
  let startMin = startHour * 60 + startMinute;
  let endMin = endHour * 60 + endMinute;

  // Normal same-day window
  if (startMin < endMin) {
    return nowMin >= startMin && nowMin < endMin;
  }

  // Overnight window
  return nowMin >= startMin || nowMin < endMin;
}


/***********************
 * CYCLE CONTROL      *
 ***********************/
function turnOn() {
  if (bleOverride) return;

  if (!isWithinTime()) {
    Shelly.call("Switch.Set", { id: 0, on: false });
    return;
  }

  Shelly.call("Switch.Set", { id: 0, on: true });

  cycleTimer = Timer.set(onTime, false, function () {
    turnOff();
  });
}

function turnOff() {
  if (bleOverride) return;

  Shelly.call("Switch.Set", { id: 0, on: false });

  if (!isWithinTime()) return;

  cycleTimer = Timer.set(offTime, false, function () {
    turnOn();
  });
}


/***********************
 * MAIN SCHEDULER     *
 ***********************/
Timer.set(60 * 1000, true, function () {
  if (bleOverride) return;

  if (isWithinTime()) {
    if (cycleTimer === null) {
      turnOn();
    }
  } else {
    if (cycleTimer !== null) {
      Timer.clear(cycleTimer);
      cycleTimer = null;
    }
    Shelly.call("Switch.Set", { id: 0, on: false });
  }
});


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
  let bytes = data.slice(4); // Skip UUID header

  // RuuviTag format 5 temperature decoding
  let tempRaw = (bytes[0] << 8) | bytes[1];
  if (tempRaw & 0x8000) tempRaw -= 0x10000;
  let temperature = tempRaw / 200.0;

  lastTemp = temperature;
  lastSeen = Date.now();
  bleOverride = true;

  evaluateTemperature();
});


/***********************
 * TEMPERATURE LOGIC  *
 ***********************/
function evaluateTemperature() {
  if (lastTemp === null) return;

  if (lastTemp < TEMP_ON) {
    Shelly.call("Switch.Set", { id: 0, on: true });
  }

  if (lastTemp > TEMP_OFF) {
    Shelly.call("Switch.Set", { id: 0, on: false });
  }
}


/***********************
 * BLE TIMEOUT CHECK  *
 ***********************/
Timer.set(30000, true, function () {
  if (bleOverride && (Date.now() - lastSeen > BLE_TIMEOUT)) {
    bleOverride = false;
    lastTemp = null;
    lastSeen = 0;
    console.log("BLE sensor lost, returning to schedule control");
  }
});
