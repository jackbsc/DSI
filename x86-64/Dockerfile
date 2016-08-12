FROM busybox

# Copy the node executable and its include files
COPY ./node/bin/ /bin/
COPY ./node/include/ /include/ 

# Copy the third party node modules
COPY ./node_modules/ /node_modules

# Copy the dependency libraries
COPY ./lib/ /lib/

# Make a symbolic link to the dependency libraries
RUN ln -s /lib /lib64

CMD ["sh"]
