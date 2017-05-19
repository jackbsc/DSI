//TODO: check that these can work with multiple device at the same time or multiple instance being initialized

//Check if the board is supported
var cpuinfo = require("fs").readFileSync("/proc/cpuinfo", "utf8");

if(cpuinfo.includes("Hardware") == false){
	throw new Error("Unable To Discover Board");
}
else{
	var cpuPartNum = ["BCM2709", "jetson_tx1"];
	var modelName = ["Raspberry Pi 3", "Jetson TX1"];
	cpuinfo = cpuinfo.slice(cpuinfo.search("Hardware"));
	cpuinfo = cpuinfo.substring(11, cpuinfo.indexOf("\n"));
	//Iterate through the list to find the model name
	for(var i = 0; i < cpuPartNum.length; i++){
		if(cpuinfo === cpuPartNum[i]){
			process.stdout.write("Your Board is: ");
			console.log(modelName[i]);
			break;
		}
	}
	if(i >= cpuPartNum.length){
		throw new Error("Unsupported Board");
	}

}

var Gpio = require("onoff").Gpio;
var spi = new Object(); // To be used as an 2D array of SPI objects, for multiple instance support
var i2c = new Object(); // To be used as an array of I2C objects, for multiple instance support
var driver = new Object();

/* Lookup table for pin mapping across different platform */
// Map from physical pin number to Linux GPIO pin number, user is to give physical pin number
/* TODO: give option to specify in GPIO numbering? */
var piPin = {3:2, 5:3, 7:4, 11:17, 13:27, 15:22, 19:10, 21:9, 23:11, 29:5, 31:6, 33:13, 35:19, 27:26, 12:18, 16:23, 18:24, 22:25, 24:8, 26:7, 32:12, 36:16, 28:20, 40:21};
var tx1Pin = {13:38, 29:219, 31:186, 33:63, 37:187, 16:37, 18:184, 32:36};

/* Generic Data Bus Configuration */

/* SPI*/
// Devices will share common bus configuration, unless different bus is used
driver.initSPI = function(settings){
	/* TODO: Test multiple SPI instances */
	spi[settings.bus, settings.device] = require("spi-device").openSync(settings.bus, settings.device, {mode: 0, maxSpeedHz: settings.clk});
	/* noChipSelect option is not avaialbe in Jetson TX1? */
}

/* I2C */
driver.initI2C = function(settings){
	/* TODO: Test multiple I2C instances */
	if(settings == undefined){
		if(cpuinfo == "BCM2709"){
			i2c[1] = require("i2c-bus").openSync(1);
		}
		else if(cpuinfo == "jetson_tx1"){
			i2c[0] = require("i2c-bus").openSync(0);
		}
	}
	else if(isNaN(settings.bus)){
		throw new Error("Please Specify I2C Bus Number, Leave Empty To Use Platform Specific");
	}
	else{
		if(cpuinfo == "BCM2709" && (settings.bus <= 0 || settings.bus > 1)){
			throw new Error("The I2C Bus i2c-" + settings.bus + " does not exit");
		}
		// TODO: add in jetson check
		i2c[settings.bus] = require("i2c-bus").openSync(settings.bus);
	}
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
		// Pull the cs line high for the async transfer before calling user call-back
		var result = ((message[1] & 0x0F) << 8) | message[2];

		cs.writeSync(1);
		if(callFrom == "readVolts"){
			result = result * Vref / 4096;
		}
		console.log("here");
		userCB(err, result);
	}

	if(isNaN(bus) || isNaN(device)){
		throw new Error("MCP3204: Please specify the spidev to use");
	}

	if(isNaN(Vref)){
		throw new Error("MCP3204: Please specify the reference voltage");
	}

	if(cpuinfo == "BCM2709"){
		if(piPin[settings.cs] == undefined){
			throw new Error("MCP3204: CS pin " + settings.cs + " is unavailable");
		}
		else{
			cs = new Gpio(piPin[settings.cs], 'high');
		}
	}

	if(cpuinfo == "jetson_tx1"){
		if(tx1Pin[settings.cs] == undefined){
			throw new Error("MCP3204: CS pin " + settings.cs + " is unavilable");
		}
		else{
			cs = new Gpio(tx1Pin[settings.cs], 'high');
		}
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

		var txbuf = new Buffer([0x04 | (sampleMode << 1),
				(d1 << 7) | (d0 << 6),
				0xFF]);

		var rxbuf = new Buffer(txbuf.length);

		var message = [{sendBuffer: txbuf,
			receiveBuffer: rxbuf,
			byteLength: txbuf.length}];

		// Pull the cs pin low
		cs.writeSync(0);
		userCB = cb;
		if(userCB == undefined){
			callFrom = "empty";	
			spi[bus, device].transferSync(message);
			// Pull the cs pin back to high
			cs.writeSync(1);
			// Return the read result
			return ((rxbuf[1] & 0x0F) << 8) | rxbuf[2];
		}
		else{
			return spi[bus, device].transfer(message, callBack);
		}
	}

	this.readVolts = function(cb){

		callFrom = "readVolts";

		if(cb == undefined){
			return this.readRaw(cb) * Vref / 4096;
		}
		else{
			return this.readRaw(cb);
		}
	}	
}

/*Texas Instrument L293 motor controller driver*/
driver.L293 = function(config){

	var _enable = config.enable;
	var _in1 = config.in1;
	var _in2 = config.in2;
	var _in3 = config.in3;
	var _in4 = config.in4;
	var _freq = config.freq;

	//TODO: add in generic motor driver, such as stepper
	//TODO: solve the issue that PWM channels are all same value
	//TODO: chang the frequency to specify in terms of Hz

	//DC motor driver, one IC can accomodate 2 DC motors
	//set up PWM pins, leave out the undefined
	if(isNaN(_in1) || isNaN(_in2)){
		throw new Error("L293: Invalid Driver Pin");
	}
	else{
		rpio.open(_in1, rpio.OUTPUT, rpio.LOW);
		rpio.open(_in2, rpio.OUTPUT, rpio.LOW);
	}
	if(isNaN(_freq)){
		_freq = 100;
	}

	if(isNaN(_enable)){
		throw new Error("L293: Invalid Enable Pin");
	}
	else{
		rpio.open(_enable, rpio.OUTPUT, rpio.LOW);
	}

	//set up the pwm frequency
	var divider = 19200 / _freq;
	if(divider > 4096 || divider < 0){
		throw new Error("L293: Incorrect Frequency Setting");
	}

	//find the nearest power of 2	
	for(var i = 1; divider >>= 1; i <<= 1){

	}
	if(19200 / _freq - i > 19200 / _freq / 2){
		i <<= 1;
	}	

	rpio.pwmSetClockDivider(i);

	this.setSpeed = function(motor, percentage = 0, dir){
		switch(motor){
			case 1:
				if(percentage >=0 && percentage <=100){
					switch(dir){
						case "clockwise":
							rpio.mode(_in1, rpio.PWM);
							rpio.pwmSetRange(_in1, 1024);
							rpio.pwmSetData(_in1, 1024 * percentage / 100);
							rpio.mode(_in2, rpio.OUTPUT);
							rpio.write(_in2, rpio.LOW);
							rpio.write(_enable, rpio.HIGH);
							break;
						case "anti_clockwise":
							rpio.mode(_in1, rpio.OUTPUT);
							rpio.write(_in1, rpio.LOW);
							rpio.mode(_in2, rpio.PWM);
							rpio.pwmSetRange(_in2, 1024);
							rpio.pwmSetData(_in2, 1024 * percentage / 100);		
							rpio.write(_enable, rpio.HIGH);
							break;
						case "stop":
							rpio.write(_enable, rpio.LOW);
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

	var mode = "normal";
	var tempReg = 0;
	var configReg = 1;
	var addr = settings.addr; // Need error checking here?
	var bus = settings.bus; 

	this.settings = function(settings){
		// This function can use to do what?
		// Generic settings of the temperature sensor?
	}

	this.getTemp = function(){
		while(!(i2c[bus].readByteSync(addr, configReg) & 0x40));
		return i2c[bus].readByteSync(addr, tempReg);		
	}

	this.standBy = function(){	
		//TODO: check why standby mode cannot work
		if(mode == "normal"){
			mode = "standby";
			rpio.i2cWrite(Buffer([configReg]));
			rpio.i2cWrite(Buffer([0x80]));
		}
	}

}

//export the driver object to use by require()
module.exports = driver;

