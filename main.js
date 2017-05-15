var rpio = require("rpio");
var driver = require("./driver");

var temp = new driver.TC74();
var adc = new driver.MCP3204({cs:  11});
var motor = new driver.L293({in1: 33, in2: 35, enable: 13});

var humid = new Object();
var lightInt = new Object();

humid.getHumid = function(){
	adc.settings({sampleMode: "single", ch: 1});
	return (adc.readVolts() - 0.5) * 100 / (2.7 - 0.5);
}

lightInt.getInt = function(){
	adc.settings({sampleMode: "single", ch: 0});
	return -32.143 * adc.readVolts() + 106.07;
}

motor.setSpeed(1, 100, "anti_clockwise");
temp.settings({addr: 0x4C, clk: 100000});

while(1){

	var hum = humid.getHumid().toFixed(2);
	var int = lightInt.getInt().toFixed(2);
	var tem = temp.getTemp();
	var motorSpeed;
	var motorStatus;

	if(hum < 70){
		motorStatus = "COOLING";
		if(tem > 25){
			motor.setSpeed(1, 70, "clockwise");
			motorSpeed = "HIGH";
		}
		else{
			motor.setSpeed(1, 20, "clockwise");
			motorSpeed = "LOW";
		}
	}
	else{
		motor.setSpeed(1, 50, "anti_clockwise");
		motorStatus = "DRYING";
	}

	process.stdout.write("Humidity: " + hum + "% ");
	process.stdout.write("Temperature: " + tem + "\u2103 ");
	process.stdout.write("Light Intensity: " + int + "% ");
	process.stdout.write(motorStatus + " ");
	if(motorStatus == "COOLING"){	
		process.stdout.write(motorSpeed + " ");
	}
	else{
		process.stdout.write("     ");
	}
	process.stdout.write("\r");
	rpio.msleep(500);
}

