// ====== SETTINGS ======
let startHour = 15;     // Time range start hour
let startMinute = 20;

let endHour = 15;      // Time range stop hour
let endMinute = 30;

let onTime = 1 * 60 * 1000;   // time minutes * 60 * 1000
let offTime = 2 * 60 * 1000; // time minutes * 60 * 1000
// ======================

let cycleTimer = null;

function isWithinTime() {
  let now = new Date();
  let nowMin = now.getHours() * 60 + now.getMinutes();
  let startMin = startHour * 60 + startMinute;
  let endMin = endHour * 60 + endMinute;

  // Normal timerange (for example 08:00–18:00)
  if (startMin < endMin) {
    return nowMin >= startMin && nowMin < endMin;
  }

  // Timerange over daybreak (for exampl 15:00–14:50)
  return nowMin >= startMin || nowMin < endMin;
}

function turnOn() {
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
  Shelly.call("Switch.Set", { id: 0, on: false });

  if (!isWithinTime()) return;

  cycleTimer = Timer.set(offTime, false, function () {
    turnOn();
  });
}

// Check every minute
Timer.set(60 * 1000, true, function () {
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
