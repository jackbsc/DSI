# DSI-IoT Javascript and Docker Images

## About this repository
This repository contains build files for Docker images for x86-64 and ARM architecture, they are in the respective folders.

The make file is for compiling the iot-docker program. Just run it using like normal Docker program.

## About iot-docker
It will only do something to the run commands. You can print them out for debugging if necessary. The program will also determine which images to load when comparing the GCC compiler macro definition. You can change the name of image to load in the top macro definiton section as well.

The program will start by creating a shared data volume under ```/usr/local/share/id_sharevol```. It used to store the source files for to run. It is done by running the program like ```iot-docker run [src]```. The program will copy the source file byte by byte to the shared data volume and mount the directy to the container and run the source file there. Once the file is inside the folder, no futher action will be taken to re-copy the source file unless it is a different name or you force to replace it ```iot-docker run -f [src]```. You can combine it with other docker run flags as well.

There are a few more commands to run such as ```--list``` to list the source file in the shared data volume and ```--help``` to show the help page (The actual content is not implemented, only dummy information) etc.

The program will also scan ```/dev/``` to determine which SPI and I2C devices are available and expose to the container using ```--device``` flag.

### Problem with iot-docker
It is a very preliminary form of what is envisioned. The way the code is written might not be suited for further development (add more commands).

There are no checking on the number of source files input. It will always take the first argument as the file name and igonore any input after.

## About driver.js and main.js
Driver.js has the driver software written in JavaScript with third-party library downloaded from npm. You can find them in the build folder.

Main.js has the test program (use-case). It has two async loop for reading and printing out sensor information.
