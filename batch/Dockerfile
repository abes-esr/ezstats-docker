FROM node:18.16.0
LABEL maintainer="ezPAARSE Team <ezpaarse@couperin.org>"

ENV DEBIAN_FRONTEND noninteractive
ENV NODE_ENV production
ENV DOCKER_ENV 1
ENV PATH /opt/ezpaarse/bin:/opt/ezpaarse/node_modules/.bin:/usr/local/bin:/usr/bin:/bin:/sbin:/usr/sbin:/usr/local/sbin:$PATH

RUN npm install -g @ezpaarse-project/ezpaarse
RUN npm install -g @ezpaarse-project/ezmesure
