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
#include <ctype.h>

#define VERSION_STRING   "v0.0.1\n"

#define EXIT_ERR_FORK    1
#define EXIT_NO_SRC      2
#define EXIT_ERR_CHILD   3
#define EXIT_ERR_OP      4

typedef enum{
	SHORT_FORCE_REPLACE = 'f',
	SHORT_VERSION = 'v',
	DUMMY_COMMAND
}shortcmd_t;

// Ordering matters from here
char* longCmd[] = {
	// These are for searching
	"help",
	"version",
	"list",
	NULL
};

typedef enum{
	LONG_HELP = 0,
	LONG_VERSION,
	LONG_LIST,
}longcmd_t;

// The ordering here matters for the action_t and the define, they must match each other
typedef union{
	struct{
		bool casualRun    : 1; // (no flag)
		bool forceReplace : 1; // -f
		bool printVersion : 1; // -v or --version
		bool printHelp    : 1; // --help
		bool printRunHelp : 1; // --help (in run)
		bool listSrcFile  : 1; // --list
	};
	int allField;
}action_t;

#define CASUAL_RUN     (1 << 0)
#define FORCE_REPLACE  (1 << 1)
#define PRINT_VERSION  (1 << 2)
#define PRINT_HELP     (1 << 3)
#define PRINT_RUN_HELP (1 << 4)
#define LIST_SRC_FILE  (1 << 5)

#if defined(__aarch64__) || defined(__arm__)
#define DOCKER_IMAGE "jackbsc/iot:io"
#endif

#if defined(__i386__) || defined(__x86_64__)
#define DOCKER_IMAGE "jackbsc/iot:x86"
#endif

#define CONTAINER_NAME "iot"

// These only use in manual exposing the devices
#define EXPOSED_DEVICE "-v", "/sys/devices/:/sys/devices/", \
	"--device=/dev/spidev0.0", \
	"--device=/dev/i2c-1"

// These specify the commands to append after docker run
#define SYS_VOLUME1 "/sys/class/:/sys/class/"
#define SYS_VOLUME2 "/sys/devices/:/sys/devices/"
#define DATA_VOLUME "/usr/local/share/id_sharevol/:/home/iot/src/"
#define APPEND_CMD  "-v", SYS_VOLUME1, "-v", SYS_VOLUME2, "-v", DATA_VOLUME, \
	DOCKER_IMAGE, NULL

// These specify the command to overwrite the one in the Dockerfile
/* mainFile is a variable defined in main */
#define OVERWRITE_CMD "node", mainFile, NULL

// Helper macro to shift a 1D array's elements left by 1, if you keep track of the size
// it is equivalent to delete without reallocating memeory
// array = the memory location starts to shift = array name
// offset = offset from the above memory location = index
// len = length of the legal memory location
// size = size of the underlying data type
#define SHIFT_ARRAY_LEFT_BY_ONE(array, offset, len, size) \
	memmove(array + offset, array + offset + 1, (len - offset) * size)

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

/**
 * @brief     Count the number of entries in a 2D structure ended with NULL
 * @param[in] The structure to read, must be a 2D structure ended with NULL
 * @return    The number of entries
 */
int getCmdSize(char* argv[]){
	int count = 0;

	if(argv == NULL){
		return 0;
	}

	for(int i = 0; argv[i] != NULL; i++){
		count++;
	}

	return count;
}

/**
 * @brief     Append commands to an existing/new 2D structure,
 *            automatically allocate memory
 * @param[in] A pointer to the 2D structure, can be NULL,
 *            a new block of memory will be allocated if NULL
 * @param[in] A va_list to the commands to be appended
 * @return    A pointer to the block of memory holding the appended commands,
 *            may or may not be the same location, always use this
 */
char** appendCmdByList(char* argvList[], ...){

	int count  = 0;
	int len = getCmdSize(argvList);

	va_list vl;

	va_start(vl, argvList);

	char* cmd = "Dummy"; // Dummy pointer location

	while((cmd = va_arg(vl, char*)) != NULL){
		count++;
		argvList = (char**)realloc((argvList == NULL) ? NULL : argvList, sizeof(char*) * (len + count + 1));
		argvList[len + count - 1] = cmd;
	}
	va_end(vl);

	argvList[len + count] = NULL;

	return argvList;
}

/**
 * @brief     Does the same thing as @ref appendCmdByList,
 *            except it uses a 2D structure
 * @param[in] Same as @ref appendCmdByList
 * @param[in] A 2D structure holding the commands to be appended,
 *            must end with NULL
 * @return    Same as @ref appendCmdByList
 */
char** appendCmdByVar(char* argvList[], char* appendCmd[]){

	int count = 0;
	int arglen = getCmdSize(argvList);
	int applen = getCmdSize(appendCmd);

	argvList = (char**)realloc((argvList == NULL) ? NULL : argvList, sizeof(char*) * (arglen + applen + 1));

	while(appendCmd[count] != NULL){
		argvList[arglen + count] = appendCmd[count];
		count++;
	}

	argvList[arglen + count] = NULL;

	return argvList;
}

/**
 * @brief     Looking through the directory /dev and
 *            append any i2c and spi devices to the command list
 * @param[in] Same as @ref appendCmdByList
 * @return    Same as @ref appendCmdByList
 */
char** appendDevices(char* argvList[]){

	char device[] = "--device=/dev/";

	// Find the devices, namely i2c-x, spidevx.x
	DIR* dirstream;

	dirstream = opendir("/dev");
	if(dirstream == NULL){
		perror("Cannot open /dev directory");
	}

	struct dirent* dirp = readdir(dirstream);

	while(dirp != NULL){
		// Check if the directory contains files name in the format i2c-x and spidevx.x
		char i2c[] = "i2c-";
		char spi[] = "spidev";

		// TODO: if use memcmp will cause segmentation fault if the names are shorter?
		if(memcmp(dirp->d_name, i2c, sizeof(i2c) - 1) == 0 || memcmp(dirp->d_name, spi, sizeof(spi) - 1) == 0){
			// Found the device
			char* deviceFlag = (char*)malloc((sizeof(device) + sizeof(spi) + 5) * sizeof(char*));
			strcpy(deviceFlag, device);

			argvList = appendCmdByList(argvList, strcat(deviceFlag, dirp->d_name), NULL);
		}

		dirp = readdir(dirstream);
	}

	closedir(dirstream);

	return argvList;
}

void printHelpPage(void){
	puts("Usage: iot-docker [option]...");
	puts("Wrapper for Docker, enhance Docker for iot.");
	puts("Automatically appends device flags and create data volume.\n");
}

void printRunHelpPage(void){
	puts("This is run help page\n");
}

void printVersion(void){
	puts(VERSION_STRING);
}

void listSrcFile(void){
	char cmd[64] = "ls ";
	char vol[64] = DATA_VOLUME;

	*(strpbrk(vol, ":")) = '\0';
	strcat(cmd, vol);
	system(cmd);
	puts("");	
}

char** runCmdHandler(char* argv[], action_t* action){

	char** fileNames = NULL;

	// Loop for every arguments
	for(int i = 2; argv[i] != NULL; i++){
		if(argv[i][0] == '-'){
			// It is an argument
			if(argv[i][1] != '-'){
				// It is a short argument
				for(int j = 0; argv[i][j] != '\0'; j++){
					switch(argv[i][j]){
						case 'f':
							// Force replace source file
							action->forceReplace = true;
							// Remove force flag from the argument list
							SHIFT_ARRAY_LEFT_BY_ONE(argv[i], j, strlen(argv[i]), sizeof(char));
							break;
						default:
							// Could be a docker command, do nothing
							break;
					}
				}
			}
			else{
				// It is a long argument
				// TODO: binary search through the first character in the long argument list?
				int index = 0;
				for(; longCmd[index] != NULL; index++){
					if(strcmp(longCmd[index], argv[i] + 2) == 0){ // Search beyond --
						break;
					}
				}
				switch(index){
					case LONG_HELP:
						// The --help option will not be removed so it also apply to docker
						action->printRunHelp = true;
						break;
					default:
						// Could be a docker argument do nothing
						break;
				}
			}
		}
		else if(isalpha(argv[i][0])){
			// Treat as file names and end the checking
			// TODO: need to consider multiple file such as passing as *?
			fileNames = argv + i;
			action->casualRun = true;
			break;
		}
		else{
			errno = EINVAL;
			printf("Unrecognize option: %s: %s\n", argv[i], strerror(errno));
			exit(EXIT_ERR_OP);
		}
	}

	return fileNames;
}

void cmdHandler(char* argv[], action_t* action){
	// Loop for every commands
	for(int i = 1; argv[i] != NULL; i++){
		if(argv[i][0] == '-'){
			if(argv[i][1] != '-'){
				// It is a short argument
				switch(argv[i][1]){
					case SHORT_VERSION:
						action->printVersion = true;
						break;
					default:
						// Could be a docker argument, do nothing
						break;
				}
			}
			else{
				// It is a long argument
				int index = 0;
				for(; longCmd[index] != NULL; index++){
					if(strcmp(longCmd[index], argv[i] + 2) == 0){
						break;
					}
				}
				switch(index){
					case LONG_HELP:
						action->printHelp = true;
						break;
					case LONG_VERSION:
						action->printVersion = true;
						break;
					case LONG_LIST:
						action->listSrcFile = true;
						break;
					default:
						// Could be docker argument, do nothing
						break;
				}
			}
		}
		else{
			// Could be a docker command, do nothing
		}
	}
}

void actionHandler(const action_t action, char** fileNames, char* argv[]){

	for(int i = 1; i != 0; i <<= 1){
		if(action.allField & i){
			switch(i){
				case CASUAL_RUN:
				case FORCE_REPLACE:
					{
						// Force replace source files
						// Check if there exist the src files
						// fileName could be path, depends on how the user input
						while(fileNames[0] != NULL){
							FILE* src = fopen(fileNames[0], "rb");
							if(src == NULL){
								// TODO: add in option to use the file directly without copying?
								printf("Unable to duplicate source file: %s: %s\n", fileNames[0], strerror(errno));
								exit(EXIT_NO_SRC);
							}

							// Exist, get ready to copy the file into the share volumes
							char* dir = (char*)malloc(strlen(DATA_VOLUME) - strlen(strpbrk(DATA_VOLUME, ":")) + 1);

							memcpy(dir, DATA_VOLUME, strlen(DATA_VOLUME) - strlen(strpbrk(DATA_VOLUME, ":")));
							dir[strlen(DATA_VOLUME) - strlen(strpbrk(DATA_VOLUME, ":"))] = '\0';

							char* filePath = malloc(strlen(dir) + strlen(argv[i + 1]) + 1);

							// Make sure the first index has the null character
							filePath[0] = '\0';
							// Construct the file path
							strcat(strcat(filePath, dir), argv[i + 1]);

							// Check if the path exist, if not, create
							struct stat st;
							// If force replace flag is set, overwrite any existing file
							if(stat(filePath, &st) == -1 || action.forceReplace){
								if(stat(dir, &st) == -1){
									// Directory not exist, create
									if(mkdir(dir, 0700) == -1){
										// TODO: how to auto create parent directory?
										printf("Error creating data volume: %s: %s\n", dir, strerror(errno));
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
									printf("Error accesing source file: %s: %s\n", filePath, strerror(errno));
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
								// File exist, just use the file
							}

							fclose(src);

							free(dir);
							free(filePath);

							// Remove the name of the file from argv
							SHIFT_ARRAY_LEFT_BY_ONE(fileNames, 0, getCmdSize(argv) + 1, sizeof(char*));
						}
					}
					break;

				case PRINT_HELP:
					printHelpPage();
					exit(EXIT_SUCCESS);
					break;
				case PRINT_RUN_HELP:
					printRunHelpPage();
					exit(EXIT_SUCCESS);
					break;
				case PRINT_VERSION:
					printVersion();
					exit(EXIT_SUCCESS);
				case LIST_SRC_FILE:
					listSrcFile();
					exit(EXIT_SUCCESS);
					break;
			}
		}
	}
}

int main(int argc, char* argv[]){

	char** fileNames = NULL;
	char* mainFile = NULL;

	action_t action = {.allField = 0};

	// Check if user is running run command
	if(strcmp(argv[1], "run") == 0){
		// Check if there is src file specify
		if(argv[2] == NULL){
			// No argument is specify, do nothing
		}
		else{
			fileNames = runCmdHandler(argv, &action);
			mainFile = fileNames[0]; // Record the file name in case later deleted
		}
	}
	// Can add another command you with to modify or add after this line, create another if-else case
	else{
		// If it is not a run command
		cmdHandler(argv, &action);
	}

	// Clean up stray arguments, to clean up any argument in the form "-\0"
	for(int i = 0; argv[i] != NULL; i++){
		if(argv[i][0] == '-' && argv[i][1] == '\0'){
			SHIFT_ARRAY_LEFT_BY_ONE(argv, i, getCmdSize(argv) + 1, sizeof(char*));
		}
	}

	// By separating the analysis and action, this avoid actions to be carry multiple times
	actionHandler(action, fileNames, argv);

	// Mount devices if run command is found
	char** argvList = NULL;

	if(action.casualRun || action.forceReplace){
		argvList = appendCmdByVar(argvList, argv);
		argvList = appendCmdByVar(argvList, addedCmd);
		argvList = appendDevices(argvList);
		// Append data volumes and docker image name
		argvList = appendCmdByList(argvList, APPEND_CMD);
		// Overwrite command in the Dockerfile
		argvList = appendCmdByList(argvList, OVERWRITE_CMD);
	}
	else{
		argvList = argv;
	}

	// Print argv for debugging
	printCmd(argvList);

	// Create child process for running docker
	pid_t pid = vfork();

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

	if(action.casualRun || action.forceReplace){
		// Section to free up the allocated memory
		for(int i = getCmdSize(argv) + getCmdSize(addedCmd); strcmp(argvList[i], "-v") != 0; i++){
			// It is in heap
			free(argvList[i]);
		}
		free(argvList);
	}

	return EXIT_SUCCESS;
}
