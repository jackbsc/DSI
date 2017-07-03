#!/bin/bash
docker run -it --rm \
           -v /sys/devices:/sys/devices \
           --device=/dev/spidev0.0 \
           --device=/dev/i2c-1 \
           --cap-add=ALL \
		   --privileged \
           jackbsc/iot:io
