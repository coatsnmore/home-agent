FROM node:22-alpine

WORKDIR /app

# Copy package files from home-page directory
COPY home-page/package.json home-page/package-lock.json ./

# Install dependencies
RUN npm install

# Copy the rest of home-page files
COPY home-page/ .

# The volume mount will override this, but we need it for the build
# The actual command will be run via the volume-mounted script

ENTRYPOINT []