var sleep = require("sleep");
var driver = require("./driver");
driver.initSPI({bus: 0, device: 0, clk: 1000000}); // Since ADC uses SPI bus, initialize SPI
driver.initI2C({bus: 1});

var temp = new driver.TC74({addr: 0x4C, bus: 1}); // Attach to i2c-1
var adc = new driver.MCP3204({cs: 13, bus: 0, device: 0, vref: 3.3}); // Attach to spi0.0
//var motor = new driver.L293({in1: 33, in2: 35, enable: 13});

var led = new driver.LED(16);
led.blink(100);

var convertState = "idle"; // A var to indicate whether the ADC is currently busy

var humid = new Object({reading: 0});
humid.getHumid = function(hum){
	convertState = "busy";
	adc.settings({sampleMode: "single", ch: 1});
	//	return (adc.readVolts() - 0.5) * 100 / (2.7 - 0.5);
	adc.readVolts(function(err, result){
		if(err) throw new Error(err);
		humid.reading = (result - 0.5) * 100 / (2.7 - 0.5);
		convertState = "idle";
	});
}

var lightInt = new Object({reading: 0});
lightInt.getInt = function(){
	convertState = "busy";
	adc.settings({sampleMode: "single", ch: 0});
	//	return -32.143 * adc.readVolts() + 106.07;
	adc.readVolts(function(err, result){
		if(err) throw new Error(err);
		lightInt.reading = -32.143 * adc.readVolts() + 106.07;
		convertState = "idle";
	});
}

//motor.setSpeed(1, 100, "anti_clockwise");

var ch = 0; // A var to schedule conversion between the two different channels of the ADC
var tem = 0; // Var to record temperature
var motorSpeed;
var motorStatus;

// A loop for getting sensor data
function sensorLoop(){

	if(convertState == "idle"){	
		if(ch == 0){
			lightInt.getInt();
			// Toggle conversion channel
			ch = ch ^ 0x01;
		}
		else{
			humid.getHumid();
			// Toggle conversion channel
			ch = ch ^ 0x01;
		}
	}

	temp.getTemp(function(err, data){
		if(err) throw new Error(err);
		tem = data;
	});

}

// A loop for printing out sensor data
function msgLoop(){

	if(humid.reading < 70){
		motorStatus = "COOLING";
		if(tem > 25){
			//		motor.setSpeed(1, 70, "clockwise");
			motorSpeed = "HIGH";
		}
		else{
			//		motor.setSpeed(1, 20, "clockwise");
			motorSpeed = "LOW";
		}
	}
	else{
		//	motor.setSpeed(1, 50, "anti_clockwise");
		motorStatus = "DRYING";
	}

	process.stdout.write("Humidity: " + humid.reading.toFixed(2) + "% ");
	process.stdout.write("Temperature: " + tem + "\u2103 ");
	process.stdout.write("Light Intensity: " + lightInt.reading.toFixed(2) + "% ");
	process.stdout.write(motorStatus + " ");
	if(motorStatus == "COOLING"){	
		process.stdout.write(motorSpeed + " ");
	}
	else{
		process.stdout.write("     ");
	}
	process.stdout.write("\r");

}

// Set up async loop to read sensor data
var sensor = setInterval(sensorLoop, 50);
// Set up async loop to print sensor data
var msg = setInterval(msgLoop, 100);

// Listen to exit event
process.stdin.resume();
process.stdin.setEncoding("utf8");
process.stdin.on("data", function(input){
	if(input == "\u0018\n"){ // Gracefully exit
		clearInterval(sensor);
		clearInterval(msg);
		process.stdin.pause();
	}
});
