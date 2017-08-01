//TODO: check that these can work with multiple device at the same time or multiple instance being initialized
var sleep = require("sleep");

function getBoard(){
	//Check if the board is supported
	var cpuinfo = require("fs").readFileSync("/proc/cpuinfo", "utf8");

	if(cpuinfo.includes("Hardware") == false){
		// If fail to get in Hardware field, get using model name field
		if(cpuinfo.includes("model name") == false){
			throw new Error("Unable To Discover Board");
		}
		cpuinfo = cpuinfo.slice(cpuinfo.search("model name"));
		cpuinfo = cpuinfo.substring(13, cpuinfo.indexOf("@"));
	}
	else{
		cpuinfo = cpuinfo.slice(cpuinfo.search("Hardware"));
		cpuinfo = cpuinfo.substring(11, cpuinfo.indexOf("\n"));
	}

	var modelJSON = require("fs").readFileSync("/home/iot/node_modules/iot-driver/board.json", "utf8");
	var modelObj = JSON.parse(modelJSON);
	var name = null;
	var index = null;

	modelObj.forEach(function(object, idx){
		object.CPU.forEach(function(cpuName){
			if(cpuinfo == cpuName){
				name = object.BoardName;
				index = idx;
			}
		});
	});

	return {cpuinfo, name, index};
	// Index is the index in model.json file
}

/* Things to do after running the driver */
var board = getBoard();

if(board.name == null){
	throw new Error("Unsupported Board");
}
else{
	console.log("Your board is " + board.name);
}

/* =================================================================================
 *                               LINE OF SEPARATION
 * =================================================================================*/

var Gpio = require("onoff").Gpio;
var spi = new Object(); // To be used as 2D array like SPI object, for multiple instance support
var i2c = new Object(); // To be used as array like I2C object, for multiple instance support
var driver = new Object(); // Place holder for all the driver objects

/* Generic Data Bus Configuration */

/* SPI*/
// Devices will share common bus configuration, unless different bus is used
driver.initSPI = function(settings){
	if(settings == undefined){
		settings = new Object();
		// Read the first SPI entry in model.json
		var modelJSON = require("fs").readFileSync("/home/iot/node_modules/iot-driver/board.json", "utf8");
		var modelObj = JSON.parse(modelJSON);
		var spiDev = modelObj[board.index].SPIDevices[0];
		
		settings.bus = parseInt(spiDev[spiDev.indexOf(".") - 1]);
		settings.device = parseInt(spiDev[spiDev.indexOf(".") + 1]);
		settings.clk = 1000000; // SPI clock default to 1MHz
	}
	else if(isNaN(settings.bus) || isNaN(settings.device)){
		throw new Error("Please specify the correct spidev to use");
	}	
	/* TODO: Test multiple SPI instances */
	spi[settings.bus, settings.device] = require("spi-device").openSync(settings.bus, settings.device, {mode: 0, maxSpeedHz: settings.clk});
	/* FIXME: noChipSelect option is not avaialbe in Jetson TX1? */
}

/* I2C */
driver.initI2C = function(settings){
	/* TODO: Test multiple I2C instances */
	if(settings == undefined){
		settings = new Object();
		// Read the first I2C entry in model.json
		var modelJSON = require("fs").readFileSync("/home/iot/node_modules/iot-driver/board.json", "utf8");
		var modelObj = JSON.parse(modelJSON);
		var i2cDev = modelObj[board.index].I2CDevices[0];
		
		settings.bus = parseInt(i2cDev[i2cDev.indexOf("-") + 1]);
	}
	else if(isNaN(settings.bus)){
		throw new Error("Please Specify I2C Bus Number, Leave Empty To Use System Default");
	}

	i2c[settings.bus] = require("i2c-bus").openSync(settings.bus);
}

/*Microchip MCP3204 ADC driver*/
driver.MCP3204 = function(settings){

	var cs;
	var sampleMode;
	var d0, d1;
	var pos, neg;
	var callFrom = "empty";
	var userCB;

	var bus = settings.bus, device = settings.device;
	var Vref = settings.vref;

	// This is to coordinate async transfer
	var callBack = function(err, message){

		var result = ((message[0].receiveBuffer[1] & 0x0F) << 8) | message[0].receiveBuffer[2];

		// Pull the cs line high for the async transfer before calling user call-back
		cs.writeSync(1);
		if(callFrom == "readVolts"){
			result = result * Vref / 4096;
		}
		userCB(err, result);
	}

	if(isNaN(bus) || isNaN(device)){
		throw new Error("MCP3204: Please specify the spidev to use");
	}

	if(isNaN(Vref)){
		throw new Error("MCP3204: Please specify the reference voltage");
	}

	if(driver.getMappedPin(settings.cs) == null){
		throw new Error("MCP3204: CS pin " + settings.cs + " is unavailable");
	}
	else{
		cs = new Gpio(driver.getMappedPin(settings.cs), 'high');
	}

	this.settings = function(settings){

		sampleMode = settings.sampleMode;

		if(sampleMode == "single"){
			ch = settings.ch;

			if(!(ch >=0 || ch <=3)){
				throw new Error("MCP3204: Error Channel Configuration (0-3)");
			}
			sampleMode = 1;
			d0 = ch & 0x01;
			d1 = ch >> 1;
		}
		else if(sampleMode == "differential"){
			pos = settings.pos;
			neg = settings.neg;

			if (pos - 1 < 0 && pos + 1 > 3){
				throw new Error("MCP3204: Channels Invalid");
			}
			else if (pos % 2 == 0){
				if(neg != (pos + 1)){
					throw new Error("MCP3204: Channels Invalid");
				}
				d1 = (pos == 0) ? (0) : (1);
				d0 = 0;
			}
			else if(pos % 2 != 0){
				if(neg != (pos - 1)){
					throw new Error("MCP3204: Channels Invalid");
				}
				d1 = (pos == 1) ? (0) : (1);
				d0 = 1;	
			}
			sampleMode = 0;	
		}
		else{
			throw new Error("MCP3204: Unrecognized Channel Confguration");
		}	
	}

	this.readRaw = function(cb){

		if(callFrom != "readVolts"){
			callFrom = "readRaw";
		}

		var cmd = 0x04 | (sampleMode << 1);

		var txbuf = new Buffer([
				0x04 | (sampleMode << 1),
				(d1 << 7) | (d0 << 6),
				0xFF
		]);

		var rxbuf = new Buffer(txbuf.length);

		var message = [{
			sendBuffer: txbuf,
			receiveBuffer: rxbuf,
			byteLength: txbuf.length
		}];

		userCB = cb;
		// Pull the cs pin low
		cs.writeSync(0);
		if(typeof(cb) != "function"){
			callFrom = "empty";	
			spi[bus, device].transferSync(message);
			// Pull the cs pin back to high
			cs.writeSync(1);
			// Return the read result
			return ((rxbuf[1] & 0x0F) << 8) | rxbuf[2];
		}
		else{
			spi[bus, device].transfer(message, callBack);
			return 0;
		}
	}

	this.readVolts = function(cb){
		callFrom = "readVolts";
		return this.readRaw(cb) * Vref / 4096;
	}	
}

/*Texas Instrument L293 motor controller driver*/
driver.L293 = function(config){

	var enable = config.enable;
	var in1 = config.in1;
	var in2 = config.in2;
	var in3 = config.in3;
	var in4 = config.in4;
	var freq = config.freq;
	var period;
	var duty_cycle;

	var fs = require("fs");
	var pwmchip0 = "/sys/class/pwm/pwmchip0/";

	// Export PWM0
	fs.writeFileSync(pwmchip0 + "export", "0");
	// Export PWM1
	fs.writeFileSync(pwmchip0 + "export", "1");

	//TODO: add in generic motor driver, such as stepper
	//TODO: solve the issue that PWM channels are all same value
	//TODO: change the frequency to specify in terms of Hz

	//DC motor driver, one IC can accomodate 2 DC motors, but onboard pwm can only support one
	if(isNaN(in1) || isNaN(in2)){
		throw new Error("L293: Invalid Driver Pin");
	}
	else{

	}

	if(isNaN(freq)){
		throw new Error("L293: Invalid Operating Frequency");
	}
	else{
		// Convert to nanoseconds
		period = 1 / freq * Math.pow(10, 9);
		fs.writeFileSync(pwmchip0 + "/pwm0/period", period.toString());
		fs.writeFileSync(pwmchip0 + "/pwm1/period", period.toString());
		fs.writeFileSync(pwmchip0 + "/pwm0/duty_cycle", "0");
		fs.writeFileSync(pwmchip0 + "/pwm1/duty_cycle", "0");
		fs.writeFileSync(pwmchip0 + "/pwm0/enable", "1");
		fs.writeFileSync(pwmchip0 + "/pwm1/enable", "1");
	}

	if(!isNaN(enable) || enable == null){
		if(enable != null){
			enable = new Gpio(driver.getMappedPin(enable), "low");
		}
	}
	else{
		throw new Error("L293: Invalid Enable Pin");
	}

	this.setSpeed = function(motor, percentage, dir){
		switch(motor){
			case 1:
				if(percentage >=0 && percentage <=100){
					if(enable != null){
						enable.writeSync(1);
					}
					duty_cycle = percentage / 100 * period;
					switch(dir){
						case "clockwise":
							fs.writeFileSync(pwmchip0 + "/pwm0/duty_cycle", duty_cycle.toString());
							fs.writeFileSync(pwmchip0 + "/pwm1/duty_cycle", "0");
							break;
						case "anti_clockwise":		
							fs.writeFileSync(pwmchip0 + "/pwm0/duty_cycle", "0");
							fs.writeFileSync(pwmchip0 + "/pwm1/duty_cycle", duty_cycle.toString());	
							break;
						case "stop":
							if(enable != null){
								enable.writeSync(0);
							}					
							fs.writeFileSync(pwmchip0 + "/pwm0/duty_cycle", "0");
							fs.writeFileSync(pwmchip0 + "/pwm1/duty_cycle", "0");
							break;
					}
				}
				break;
			case 2:
			default: ;
		}
	}
}

/*Microchip TC74 temerature sensor driver*/
driver.TC74 = function(settings){
	//TODO: check the clk speed limit of the i2c bus
	var tempReg = 0;
	var configReg = 1;
	var addr = settings.addr; // Need error checking here?
	var bus = settings.bus;

	this.getTemp = function(cb){
		if(typeof(cb) == "function"){
			return i2c[bus].readByte(addr, tempReg, cb);
		}
		else{
			// Waiting for ready necessary?
			//while(!(i2c[bus].readByteSync(addr, configReg) & 0x40));
			return i2c[bus].readByteSync(addr, tempReg);
		}
	}

	this.standBy = function(){
		// Set 8th bit to 1	
		return i2c[bus].writeByteSync(addr, configReg, 0x80);
	}

	this.wakeUp = function(){
		// Set 8th bit to 0
		return i2c[bus].writeByteSync(addr, configReg, 0x00);
	}

}

/* Get pin mapping of differnt platform */
driver.getMappedPin = function(pin){
	/* Lookup table for pin mapping across different platform, array like object */
	// Map from physical pin number to Linux GPIO pin number, user is to give physical pin number
	/* TODO: give option to specify in GPIO numbering? */
	var piPin = {
		3:2, 5:3, 7:4, 11:17, 13:27, 15:22, 19:10, 21:9, 23:11,
		29:5, 31:6, 33:13, 35:19, 27:26, 12:18, 16:23, 18:24, 22:25, 24:8,
		26:7, 32:12, 36:16, 28:20, 40:21
	};
	var tx1Pin = {
		7:216, 11:162, 13:38, 19:16, 21:17, 23:18, 29:219,
		31:186, 33:63, 35:8, 37:187, 8:160, 10:161, 12:11, 16:37, 18:184,
		24:19, 26:20, 32:36, 36:163, 38:9, 40:10
	};

	switch(board.cpuinfo){
		case "BCM2709":
		case "BCM2835":
			return piPin[pin];
			break;
		case "jetson_tx1":
			return tx1Pin[pin];
			break;
		default:
			return null;
	}
}

/* General purpose LED driver */
driver.LED = function(_pin, _activeLow){

	// FIXME: softblink
	var blinkHandle;
	var softBlinkIntervalHandle;
	var nextBlinkState = 1; // 0 = off, 1 = on
	var softBlinkDir = "incr"; // Incr = increment, decr = decrement
	var softBlinkVar;
	var activeLow = _activeLow;
	if(activeLow == undefined){
		activeLow = false;
	}

	var pin = new Gpio(driver.getMappedPin(_pin), 'out');

	// Time is the on time
	function softTimeoutHandler(blinkState, time){
		pin.writeSync(activeLow ? (blinkState ^ 0x01) : blinkState);
		// Check if the next blink state is on
		// Assign the new on value if it is
		setTimeout(softTimeoutHandler(blinkState ^ 0x01, blinkState ? (100 - time) : softBlinkVar), time / 10);
		console.log("fwf");
	}

	function softIntervalHandler(maxVar, minVar){
		// At each step, plus one percentage until it reaches max
		if(softBlinkDir == "incr"){
			softBlinkVar++
				if(softBlinkVar == maxVar){
					softBlinkDir = "decr";
				}
		}
		else{
			softBlinkVar--;
			if(softBlinkVar == minVar){
				softBlinkDir = "incr";
			}
		}
	}

	this.on = function(){
		pin.writeSync(activeLow ? 0 : 1);
	}

	this.off = function(){
		pin.writeSync(activeLow ? 1 : 0);
	}

	// Start to blink the LED
	this.blink = function(interval){
		blinkHandle = setInterval(function(){
			// Toggle the LED every at every 'interval'
			pin.writeSync(pin.readSync() ^ 0x01);
		}, interval);
	}

	// Softblink LED, blink at a fixed frequency of 100Hz
	// Interval is the time that goes from max to min and back and forth
	// Max and min are specified in percentage
	this.softBlink = function(interval, maxVar, minVar){
		if(maxVar < minVar){
			throw new Error("LED: max cannot less than min: " + maxVar + "<" + minVar);
		}
		// Set up the LED to blink at min first
		pin.writeSync(activeLow ? 0 : 1);
		nextBlinkState = 0; // Next state is off
		// Next blink time will be 100 - minVar for off
		softBlinkVar = minVar;
		setTimeout(softTimeoutHandler(nextBlinkState, (100 - softBlinkVar), softBlinkVar / 10));
		// Set up anoter timer to change the blinking time
		softBlinkHandle = setInterval(softIntervalHandler(maxVar, minVar), (maxVar - minVar) / interval * 1000); // Specify in miliseconds
	}

	// Stop the LED from blinking and reset back to 0
	this.stop = function(){
		clearInterval(blinkHandle);
		//clearInterval(softBlinkHandle);
		pin.writeSync(activeLow ? 1 : 0);
	}
}

/* Unexport every GPIO pins in the system */
driver.unexportGPIO = function(){
	var fs = require("fs");
	var gpioDir = fs.readdirSync("/sys/class/gpio");

	gpioDir.forEach(file =>{
		if(file.startsWith("gpio") && !file.includes("chip")){
			fs.writeFileSync("/sys/class/gpio/unexport", file.substr("gpio".length));
		}
	});
}

/* Close every I2C bus in the system */
/* FIXME:The bus does not shutdown properly, maybe because of system need to use? */
driver.uninitI2C = function(){
	Object.keys(i2c).forEach(bus =>{
		i2c[bus].closeSync();
	});
}

/* Close every SPI bus in the system */
driver.uninitSPI = function(){
	Object.keys(spi).forEach(bus =>{
		Object.keys(bus).forEach(device =>{
			spi[bus, device].closeSync();
		});
	});
}

/* Unexport every PWM pins in the system */
driver.unexportPWM = function(){
	var fs = require("fs");
	var pwmDir = fs.readdirSync("/sys/class/pwm/pwmchip0");

	pwmDir.forEach(file =>{
		if(file.startsWith("pwm")){
			fs.writeFileSync("/sys/class/pwm/pwmchip0/unexport", file.substr("pwm".length));
		}
	});
}

driver.uninitAll = function(){
	driver.unexportGPIO();
	driver.uninitI2C();
	driver.uninitSPI();
	driver.unexportPWM();
}

// Export the driver object to use by require()
module.exports = driver;

