var rpio = require("rpio");
var driver = require("./driver");

var adc = new driver.MCP3204({cs: 3});
var motor = new driver.L293({in1: 33, in2: 35, enable: 5});

adc.settings({mode: "single", ch: 0, clk: 1000000});
motor.setSpeed(1, 100, "anti_clockwise");

while(1){
	console.log(adc.read());
	rpio.msleep(500);
}

