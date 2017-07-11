#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <string.h>

// TODO: dynamically determine the devices?
#define DOCKER_IMAGE "jackbsc/iot:busybox"
#define CONTAINER_NAME "iot"
#define EXPOSED_DEVICE "-v", "/sys/devices:/sys/devices",\
                       "--device=/dev/spidev0.0",\
                       "--device=/dev/i2c-1"

char* iotCmd[] = {
	"--exchange",
	"--attach",
	NULL
};

char* addedCmd[] = {
	"run",
	"--name", CONTAINER_NAME,	
	EXPOSED_DEVICE,
	"-it",
	"--rm",
	DOCKER_IMAGE,
	NULL
};

void printCmd(char* argv[]){
	for(int i = 0; argv[i] != NULL; i++){
		printf("%s ", argv[i]);
	}
	putchar('\n');
}

int getCmdSize(char* argv[]){
	int count = 0;
	for(int i = 0; argv[i] != NULL; i++){
		count++;
	}
	return count;
}

int main(int argc, char* argv[]){

	// Check if commands other than normal docker command are passed in
	for(int i = 0; argv[i] != NULL; i++){
		for(int j = 0; iotCmd[j] != NULL; j++){
			if(strcmp(argv[i], iotCmd[j]) == 0){
				// If found, process them and remove them from the list
				printf("process: %s\n", iotCmd[j]);
				argv[i] = argv[i + 1];
				i--;
			}
		}	
	}

	// Construct all the commands
	char* argvList[getCmdSize(argv) + getCmdSize(addedCmd) + 1];

	for(int i = 0; i < getCmdSize(argv); i++){
		argvList[i] = argv[i];
	}
	for(int i = 0; i < getCmdSize(addedCmd) + 1; i++){
		argvList[getCmdSize(argv) + i] = addedCmd[i];
	}

	// Print argv for debugging
	//printCmd(argvList);

	// Create child process for running docker
	pid_t pid = fork();

	if(pid > 0){
		// In parent process
		wait(NULL);
	}
	else if(pid == 0){
		// In child process, will be running docker code

		// Running docker
		if(execvp("docker", argvList) == -1){
			perror("Error initiating docker");
		}

		// Make sure the child process exit gracefully regardless the situations
		exit(1);
	}
	else{
		// Fork error
		perror("Error creating child process");
		exit(1);
	}

	return 0;
}
