CC = gcc
CFLAG = -Wall -std=gnu11
SRC = iot-docker.c
OBJ = iot-docker

all:
	@$(CC) $(CFLAG) -o $(OBJ) $(SRC)

install:
	@# Copy the executable to the folder
	@cp $(OBJ) /usr/local/bin/

	@# Shared data volume is created under /usr/local/share/id_sharevol
	@# TODO: would it be better if put under the default docker volume? It would be a named volume, but require sudo access

uninstall:
	@rm -f /usr/local/bin/$(OBJ)

clean:
	@rm -f $(OBJ)

