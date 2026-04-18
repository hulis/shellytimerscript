/***********************
 * USER CONFIGURATION *
 ***********************/

// RuuviTag BLE
let RUUVI_MAC = "xx:xx:xx:xx:xx:xx"; 

// Ajastettu puhallus
let SCHEDULED_TIMES = ["08:00", "12:00", "18:00"]; // <--- Lisää tähän haluamasi ajat
let SCHEDULED_DURATION = 15 * 60 * 1000;          // Puhalluksen kesto millisekunteina (esim. 15min)

// Temperature (°C)
let TEMP_ALWAYS_ON = 27.0;  
let HUMIDITY_THRESHOLD = 60.0;  
let HUMIDITY_ON_TIME = 1 * 60 * 1000; 

// Fallback
let FALLBACK_ON_TIME = 1 * 60 * 1000; 
let FALLBACK_OFF_TIME = 4 * 60 * 1000; 
let BLE_TIMEOUT = 1 * 60 * 1000; 

let RUUVI_MFD_ID = 0x0499;
let RUUVI_DATA_FMT = 5;

/***********************
 * GLOBAL VARIABLES    *
 ***********************/
let mode = "INIT"; 
let bleAvailable = false;
let lastSeen = 0;
let temperature = null;
let humidity = null;

let fallbackTimer = null;
let fallbackState = false;
let humidityTimer = null;

// UUSI: Ajastimen muuttuja
let scheduledTimer = null; 

let lastLogTime = 0; 

/***********************
 * SWITCH HELPERS      *
 ***********************/
function fanOn()  { Shelly.call("Switch.Set", { id: 0, on: true }); }
function fanOff() { Shelly.call("Switch.Set", { id: 0, on: false }); }

/***********************
 * FALLBACK CYCLE      *
 ***********************/
// (Tämä osa pysyy samana)
function startFallbackCycle() {
  if (fallbackTimer) return;
  fallbackState = true;
  fanOn();
  fallbackTimer = Timer.set(FALLBACK_ON_TIME, false, fallbackStep);
  logModeChange("FALLBACK");
}

function fallbackStep() {
  if (mode !== "FALLBACK") { stopFallbackCycle(); return; }
  if (fallbackState) {
    fanOff();
    fallbackState = false;
    fallbackTimer = Timer.set(FALLBACK_OFF_TIME, false, fallbackStep);
  } else {
    fanOn();
    fallbackState = true;
    fallbackTimer = Timer.set(FALLBACK_ON_TIME, false, fallbackStep);
  }
}

function stopFallbackCycle() {
  if (fallbackTimer) { Timer.clear(fallbackTimer); fallbackTimer = null; }
  fallbackState = false;
}

/***********************
 * RUUVI PARSER        *
 ***********************/
// (Pysyy samana)
let packedStruct = {
  buffer: '',
  setBuffer: function(buffer){ this.buffer = buffer; },
  utoi: function(u16){ return (u16 & 0x8000) ? u16 - 0x10000 : u16; },
  getUInt8: function(){ return this.buffer.at(0); },
  getInt8: function(){ let int = this.getUInt8(); if(int & 0x80) int -= 0x100; return int; },
  getUInt16LE: function(){ return 0xffff & (this.buffer.at(1)<<8 | this.buffer.at(0)); },
  getInt16LE: function(){ return this.utoi(this.getUInt16LE()); },
  getUInt16BE: function(){ return 0xffff & (this.buffer.at(0)<<8 | this.buffer.at(1)); },
  getInt16BE: function(){ return this.utoi(this.getUInt16BE()); },
  unpack: function(fmt,keyArr){
    let b='<>!', le=fmt[0]==='<'; if(b.indexOf(fmt[0])>=0) fmt=fmt.slice(1);
    let pos=0,jmp,res={}; while(pos<fmt.length && pos<keyArr.length && this.buffer.length>0){
      jmp=0; if(fmt[pos]=='b'||fmt[pos]=='B') jmp=1; if(fmt[pos]=='h'||fmt[pos]=='H') jmp=2;
      if(fmt[pos]=='b') res[keyArr[pos]] = this.getInt8();
      else if(fmt[pos]=='B') res[keyArr[pos]] = this.getUInt8();
      else if(fmt[pos]=='h') res[keyArr[pos]] = le?this.getInt16LE():this.getInt16BE();
      else if(fmt[pos]=='H') res[keyArr[pos]] = le?this.getUInt16LE():this.getUInt16BE();
      this.buffer=this.buffer.slice(jmp); pos++;
    } return res;
  }
};

let RuuviParser = {
  getData: function(res){
    let data = BLE.GAP.ParseManufacturerData(res.advData);
    if(typeof data!=='string' || data.length<26) return null;
    packedStruct.setBuffer(data);
    let hdr = packedStruct.unpack('<HB',['mfd_id','data_fmt']);
    if(hdr.mfd_id!==RUUVI_MFD_ID) return null;
    if(hdr.data_fmt!==RUUVI_DATA_FMT) return null;
    let rm = packedStruct.unpack('>hHHhhhHBHBBBBBB',[
      'temp','humidity','pressure','acc_x','acc_y','acc_z','pwr','cnt',
      'sequence','mac_0','mac_1','mac_2','mac_3','mac_4','mac_5'
    ]);
    rm.temp = rm.temp*0.005;
    rm.humidity = rm.humidity*0.0025;
    return rm;
  }
};

/***********************
 * SENSOR EVALUATION   *
 ***********************/
function evaluateSensor() {
  if(!bleAvailable){
    if(mode!=="FALLBACK"){ mode="FALLBACK"; startFallbackCycle(); }
    return;
  }

  if(mode!=="SENSOR"){ mode="SENSOR"; stopFallbackCycle(); logModeChange("SENSOR"); }

  if(Date.now()-lastLogTime>10000){
    console.log("Sensor: temp=" + temperature.toFixed(1) + "°C, hum=" + humidity.toFixed(1) + "%");
    lastLogTime=Date.now();
  }

  if(temperature > TEMP_ALWAYS_ON){ fanOn(); return; }
  
  if(humidity > HUMIDITY_THRESHOLD && !humidityTimer){
    fanOn();
    humidityTimer = Timer.set(HUMIDITY_ON_TIME, false, function(){ humidityTimer=null; });
    return;
  }

  // Muutos tässä: Tarkistetaan, ettei kumpikaan timer ole päällä
  if(!humidityTimer && !scheduledTimer) fanOff();
}

/***********************
 * SCHEDULED CHECKING  *
 ***********************/
Timer.set(60000, true, function() {
  let d = new Date();
  let timeStr = ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
  
  for (let i = 0; i < SCHEDULED_TIMES.length; i++) {
    if (SCHEDULED_TIMES[i] === timeStr) {
      if (!scheduledTimer) {
        console.log("Scheduled ventilation start: " + timeStr);
        fanOn();
        scheduledTimer = Timer.set(SCHEDULED_DURATION, false, function(){ 
            scheduledTimer = null; 
            evaluateSensor(); // Tarkistetaan pitääkö puhaltimen jäädä päälle sensorin takia
        });
      }
    }
  }
});

/***********************
 * BLE CALLBACK        *
 ***********************/
function scanCB(ev,res){
  if(ev !== BLE.Scanner.SCAN_RESULT) return;
  if(!res.addr || res.addr.toLowerCase() !== RUUVI_MAC) return;
  let measurement = RuuviParser.getData(res);
  if(!measurement) return;

  temperature = measurement.temp;
  humidity = measurement.humidity;
  lastSeen = Date.now();
  bleAvailable = true;

  evaluateSensor();
}

/***********************
 * BLE INIT            *
 ***********************/
function initBLE(){
  const BLEConfig = Shelly.getComponentConfig("ble");
  if(!BLEConfig.enable){ console.log("Error: Bluetooth not enabled"); return; }
  if(!BLE.Scanner.isRunning()){ BLE.Scanner.Start({ duration_ms: BLE.Scanner.INFINITE_SCAN, active: false }); }
  BLE.Scanner.Subscribe(scanCB);
}
initBLE();

/***********************
 * BLE TIMEOUT CHECK   *
 ***********************/
Timer.set(30000,true,function(){
  if(bleAvailable && (Date.now()-lastSeen>BLE_TIMEOUT)){
    bleAvailable=false; temperature=null; humidity=null;
    evaluateSensor();
  }
});

/***********************
 * MODE INIT CHECK     *
 ***********************/
Timer.set(3000,true,function(){
  if(mode==="INIT"){ evaluateSensor(); }
});

/***********************
 * LOG HELPER          *
 ***********************/
function logModeChange(newMode){
  console.log("Mode changed: " + newMode);
}
