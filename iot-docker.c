#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <dirent.h>
#include <string.h>

// Device flags are determine dynamically at runtime
#define DOCKER_IMAGE "jackbsc/iot:busybox"
#define CONTAINER_NAME "iot"

// These only use in manual exposing the devices
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
	"-it",
	"--rm",
	//EXPOSED_DEVICE,
	//DOCKER_IMAGE, // Fields reserved for dynamically mounting devices
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

char** makeDynaMount(char* argv[], char* addedCmd[]){
	
	// Construct part of the commands
	int addedCmdSize = getCmdSize(argv) + getCmdSize(addedCmd);

	char** argvList = (char**)malloc(addedCmdSize * sizeof(char*));

	// Both copying are without the ending NULL pointer
	for(int i = 0; i < getCmdSize(argv); i++){
		argvList[i] = argv[i];
	}
	for(int i = 0; i < getCmdSize(addedCmd); i++){
		argvList[getCmdSize(argv) + i] = addedCmd[i];
	}

	// Find the devices, namely i2c-x, spidevx.x
	DIR* dirstream;
	
	dirstream = opendir("/dev");
	if(dirstream == NULL){
		perror("Cannot open /dev directory");
	}

	struct dirent* dirp = readdir(dirstream);
	int count = 0; // Use to record how many entries are found

	while(dirp != NULL){
		// Check if the directory contains files name in the format i2c-x and spidevx.x
		char i2c[] = "i2c";
		char spi[] = "spidev";
		
		// TODO: if use memcmp will cause segmentation fault if the names are shorter?
		if(memcmp(dirp->d_name, i2c, sizeof(i2c) - 1) == 0 || memcmp(dirp->d_name, spi, sizeof(spi) - 1) == 0){
			// Found the devices
			count++;

			argvList = realloc(argvList, (addedCmdSize + count) * sizeof(char*));
			
			// Added the device to the last entry of the argvList
			char device[] = "--device=/dev/";
			char* deviceFlag = (char*)malloc((sizeof(device) + sizeof(spi) + 5) * sizeof(char*));
			memcpy(deviceFlag, device, sizeof(device)); // Copy the null character also as it is needed next
			argvList[addedCmdSize + count - 1] = strcat(deviceFlag, dirp->d_name);
		}

		dirp = readdir(dirstream);
	}

	closedir(dirstream);

	// Append docker image name and NULL pointer
	int expandedSize = count + addedCmdSize + 1; // Extra 1 is for the NULL
	argvList = realloc(argvList, sizeof(char*) * expandedSize);
	
	argvList[expandedSize - 2] = DOCKER_IMAGE;
	argvList[expandedSize - 1] = NULL;

	return argvList;
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

	// Mount devices
	char** argvList = makeDynaMount(argv, addedCmd);

	// Print argv for debugging
	printCmd(argvList);

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

	// Section to free up and allocated memory
	for(int i = getCmdSize(argv) + getCmdSize(addedCmd); strcmp(argvList[i], DOCKER_IMAGE) != 0; i++){
		// It is in heap
		free(argvList[i]);
	}
	free(argvList);

	return 0;
}
