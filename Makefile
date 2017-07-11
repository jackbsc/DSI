CC = gcc
CFLAG = -Wall -std=gnu11
SRC = iot-docker.c
OBJ = iot-docker

all:
	@$(CC) $(CFLAG) -o $(OBJ) $(SRC)

install:
	@cp $(OBJ) /usr/bin

uninstall:
	@rm -f /usr/bin/$(OBJ)

clean:
	@rm -f $(OBJ)

