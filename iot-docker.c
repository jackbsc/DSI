#include <stdio.h>
#include <stdlib.h>
#include <stdbool.h>
#include <stdarg.h>
#include <errno.h>
#include <unistd.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <dirent.h>
#include <string.h>

#define EXIT_ERR_FORK    1
#define EXIT_NO_SRC      2
#define EXIT_ERR_CHILD   3

#if __aarch64__ || __arm__
#define DOCKER_IMAGE "jackbsc/iot:io"
#endif

#if __i386__ || __x86_64__
#define DOCKER_IMAGE "jackbsc/iot:x86"
#endif

#define CONTAINER_NAME "iot"

// These only use in manual exposing the devices
#define EXPOSED_DEVICE "-v", "/sys/devices/:/sys/devices/",\
                       "--device=/dev/spidev0.0",\
                       "--device=/dev/i2c-1"

#define SYS_VOLUME "/sys/devices/:/sys/devices/"
#define DATA_VOLUME "/usr/local/share/id_sharevol/:/home/iot/src/"

#define OVERWRITE_CMD  NULL
/* 'fileName' is a variable defined in main */

char* iotCmd[] = {
	"--exchange",
	"--attach",
	NULL
};

// TODO: should not use so many flags?
char* addedCmd[] = {
	"--name", CONTAINER_NAME,
	"-it",
	"--rm",
	//EXPOSED_DEVICE, // Device flags are determine dynamically at runtime
	//DOCKER_IMAGE, // Fields are reserved for dynamically mounting devices
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
		char i2c[] = "i2c-";
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

	// Append data volumes
	// Append docker image name and NULL pointer
	int expandedSize = count + addedCmdSize + 6;
	argvList = realloc(argvList, sizeof(char*) * expandedSize);

	argvList[expandedSize - 6] = "-v";
	argvList[expandedSize - 5] = SYS_VOLUME;
	argvList[expandedSize - 4] = "-v";
	argvList[expandedSize - 3] = DATA_VOLUME;
	argvList[expandedSize - 2] = DOCKER_IMAGE;
	argvList[expandedSize - 1] = NULL;

	return argvList;
}

void overwriteCmd(char* argvList[], ...){

	int count  = 0;
	int len = getCmdSize(argvList);
	
	va_list vl;

	va_start(vl, argvList);
		
	char* cmd = "Dummy"; // Dummy pointer location

	while((cmd = va_arg(vl, char*)) != NULL){
		argvList = realloc(argvList, sizeof(char*) * (len + count + 1));
		argvList[len + count] = cmd;
		count++;
	}

	argvList[len + count] = NULL;

	va_end(vl);

}

int main(int argc, char* argv[]){

	bool appendFlags = false;
	char* fileName = NULL;

	// Check if commands other than normal docker command are passed in
	for(int i = 0; argv[i] != NULL; i++){
		if(appendFlags == false && strcmp(argv[i], "run") == 0){
			// If found run command, append the necessary device flags
			appendFlags = true;
			// Check if there is src file specify
			if(argv[i + 1] == NULL){
				// Exit with error if not found
				errno = EBADF;
				perror("Cannot find source file");
				exit(EXIT_NO_SRC);
			}
			else{
				fileName = argv[i + 1];
				// Exist, copy the file into the share volumes
				FILE* src = fopen(argv[i + 1], "rb");
				if(src == NULL){
					// TODO: add in option to use the file directly without copying?
					perror("Unable to duplicate source file");
					exit(EXIT_NO_SRC);
				}

				char* dir = (char*)malloc(strlen(DATA_VOLUME) - strlen(strpbrk(DATA_VOLUME, ":")) + 1);

				memcpy(dir, DATA_VOLUME, strlen(DATA_VOLUME) - strlen(strpbrk(DATA_VOLUME, ":")));
				dir[strlen(DATA_VOLUME) - strlen(strpbrk(DATA_VOLUME, ":"))] = '\0';

				char* filePath = malloc(strlen(dir) + strlen(argv[i + 1]) + 1);

				// Make sure the first index has the null character
				filePath[0] = '\0';
				// Construct the file name
				strcat(strcat(filePath, dir), argv[i + 1]);

				// Check if the file exist, if not, create
				struct stat st;
				if(stat(filePath, &st) == -1){

					if(stat(dir, &st) == -1){
						// Directory not exist, create
						if(mkdir(dir, 0700) == -1){
							perror("Unable to duplicate source file");
							fclose(src);
							free(dir);
							free(filePath);
							exit(EXIT_NO_SRC);
						}
					}
					else{
						// Directory exist, just copy file
					}

					FILE* dest = fopen(filePath, "wb");
					if(dest == NULL){
						perror("Unable to duplicate source file");
						fclose(src);
						free(dir);
						free(filePath);
						exit(EXIT_NO_SRC);
					}

					// Copy the file byte by byte
					char buf[1];
					while(!feof(src)){
						fread(buf, sizeof(char), sizeof(buf), src);
						fwrite(buf, sizeof(char), sizeof(buf), dest);
					}

					fclose(dest);
				}
				else{
					// Exist, does nothing, use the file directly
				}

				fclose(src);

				free(dir);
				free(filePath);

				// Remove the name of the file from argv
				for(int k = i + 1; argv[k] != NULL; k++){
					argv[k] = argv[k + 1];
				}
			}
		}

		// Check if custom command exist
		for(int j = 0; iotCmd[j] != NULL; j++){
			if(strcmp(argv[i], iotCmd[j]) == 0){
				// If found, process them and remove them from the list
				for(int k = i; argv[k] != NULL; k++){
					argv[k] = argv[k + 1];
				}
			}
		}	
	}

	// Mount devices if run command is found
	char** argvList = NULL;

	if(appendFlags == true){
		argvList = makeDynaMount(argv, addedCmd);
		// Overwrite command in the Dockerfile
		overwriteCmd(argvList, OVERWRITE_CMD);
	}
	else{
		argvList = argv;
	}
	
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
		exit(EXIT_ERR_CHILD);
	}
	else{
		// Fork error
		perror("Error creating child process");
		exit(EXIT_ERR_FORK);
	}

	if(appendFlags == true){
		// Section to free up the allocated memory
		for(int i = getCmdSize(argv) + getCmdSize(addedCmd); strcmp(argvList[i], "-v") != 0; i++){
			// It is in heap
			free(argvList[i]);
		}
		free(argvList);
	}

	return EXIT_SUCCESS;
}
