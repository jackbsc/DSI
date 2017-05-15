//TODO: check that these can work with multiple device at the same time or multiple instance being initialized

rpio = require("rpio");

var driver = new Object(rpio.init({gpiomem: false}));

/*Microchip MCP3204 ADC driver*/
driver.MCP3204 = function(pin){

	var cs = pin.cs;
	var Vref = 3.3; //defualt to 3.3V Vref
	var clk = 1000000; //default to 1MHz clk
	var dataMode = 0; //default to mode 0
	var sampleMode;
	var d0, d1;
	var pos, neg;

	//initialize the pin to output
	rpio.open(cs, rpio.OUTPUT, rpio.HIGH);

	this.settings = function(settings){

		//TODO: add in change Vref
		rpio.spiBegin();

		if(settings.clk == undefined){
			//if no clk specify, use the old or default clock setting
			settings.clk = clk;
		}
		else if(isNaN(settings.clk) || settings.clk < 0 || settings.clk > 250000000){
			throw "MCP3204: Incorrect Clock Settings";
		}
		else{
			//correct clock setting, remember it
			clk = settings.clk;
		}
		rpio.spiSetClockDivider(250000000 / settings.clk);

		if(settings.dataMode == undefined){
			//if no data mode specify, use the old or defualt data mode setting
			settings.dataMode = dataMode;
		}
		else if(isNaN(settings.dataMode) || settings.dataMode < 0 || settings.dataMode > 3){
			throw "MCP3204: Incorrect Mode Settings";
		}
		else{
			//correct data mode setting, remember it
			dataMode = settings.dataMode;
		}
		rpio.spiSetDataMode(settings.dataMode);

		sampleMode = settings.sampleMode;
		if(sampleMode == "single"){
			ch = settings.ch;

			if(!(ch >=0 || ch <=3)){
				throw "MCP3204: Error Channel Configuration (0-3)";
			}
			sampleMode = 1;
			d0 = ch & 0x01;
			d1 = ch >> 1;
		}
		else if(sampleMode == "differential"){
			pos = settings.pos;
			neg = settings.neg;

			if (pos - 1 < 0 && pos + 1 > 3){
				throw "MCP3204: Channels Invalid";
			}
			else if (pos % 2 == 0){
				if(neg != (pos + 1)){
					throw "MCP3204: Channels Invalid";
				}
				d1 = (pos == 0) ? (0) : (1);
				d0 = 0;
			}
			else if(pos % 2 != 0){
				if(neg != (pos - 1)){
					throw "MCP3204: Channels Invalid";
				}
				d1 = (pos == 1) ? (0) : (1);
				d0 = 1;	
			}
			sampleMode = 0;	
		}
		else{
			throw "MCP3204: Unrecognized Channel Configuration";
		}	
	}

	this.readRaw = function(){
		var cmd = 0x04 | (sampleMode << 1);
		var txbuf = new Buffer([cmd]);
		var rxbuf = new Buffer(txbuf.length);

		//pull the CS pin low
		rpio.write(cs, rpio.LOW);	

		//send start command
		rpio.spiWrite(txbuf, txbuf.length);
		//send rest of the command
		cmd = (d1 << 7) | (d0 << 6);
		txbuf = new Buffer([cmd, 0xff]);
		rxbuf = new Buffer(txbuf.length);
		rpio.spiTransfer(txbuf, rxbuf, txbuf.length);

		//pull the CS pin high to end the transaction
		rpio.write(cs, rpio.HIGH);

		//return the read result
		return ((rxbuf[0] & 0x0F) << 8) | rxbuf[1];
	}

	this.readVolts = function(){
		return this.readRaw() * Vref / 4096;
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
		throw "L293: Invalid Driver Pin";
	}
	else{
		rpio.open(_in1, rpio.OUTPUT, rpio.LOW);
		rpio.open(_in2, rpio.OUTPUT, rpio.LOW);
	}
	if(isNaN(_freq)){
		_freq = 100;
	}

	if(isNaN(_enable)){
		throw "L293: Invalid Enable Pin";
	}
	else{
		rpio.open(_enable, rpio.OUTPUT, rpio.LOW);
	}

	//set up the pwm frequency
	var divider = 19200 / _freq;
	if(divider > 4096 || divider < 0){
		throw "L293: Incorrect Frequency Setting";
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
driver.TC74 = function(){
	//TODO: check the clk speed limit of the i2c bus

	var mode = "normal";
	var tempReg = 0;
	var configReg = 1;

	rpio.i2cBegin();
	this.settings = function(settings){
		if(isNaN(settings.addr) || settings.addr < 0 || settings.addr > 127){
			throw "TC74: Error Slave Address";
		}
		rpio.i2cSetSlaveAddress(settings.addr);
		if(isNaN(settings.clk) || settings.clk > 100000 || settings.clk < 0){
			throw "TC74: Error I2C Clock Rate (~100kHz)";
		}
		rpio.i2cSetBaudRate(settings.clk);
	}

	this.getTemp = function(){
		var rxbuf = new Buffer(1);
		do{		
			rpio.i2cWrite(Buffer([configReg]));
			rpio.i2cRead(rxbuf, 1);
		}while(!(rxbuf[0] & 0x40));
		rpio.i2cWrite(Buffer([tempReg]));
		rpio.i2cRead(rxbuf, 1);
		return rxbuf[0];		
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

